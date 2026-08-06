import { describe, it, expect } from 'vitest';
import {
  TRANSACTION_FLOW_TYPES,
  TRANSACTION_HISTORY_LIMITS,
  TRANSACTION_HISTORY_PATH,
  buildTransactionParams,
  parseExchangeTransactions,
  sumDecimals,
  summarizeTransactions,
} from '../transaction-history';

/**
 * BitMart futures transaction history — the data behind `/wallet/transactions` (gap G5).
 *
 * We are non-custodial, so there is no QuantumTrade ledger; the only real record of money movement is the
 * exchange's, readable with the Read-only key the user already granted. Two upstream details are easy to
 * get wrong in ways that produce plausible-but-false money figures: `amount` is signed, and `time` is a
 * STRING of milliseconds while the kline endpoints use seconds.
 */

// Payload shape taken from the endpoint's documented response.
const BODY = {
  code: 1000,
  message: 'Ok',
  data: [
    { symbol: '', type: 'Transfer', amount: '-0.37500000', asset: 'USDT', account: 'futures', time: '1570608000000', tran_id: '9689322392' },
    { symbol: 'BTCUSDT', type: 'Commission Fee', amount: '-0.01000000', asset: 'USDT', account: 'futures', time: '1570636800000', tran_id: '9689322393' },
    { symbol: 'BTCUSDT', type: 'Realized PNL', amount: '12.50000000', asset: 'USDT', account: 'futures', time: '1570640000000', tran_id: '9689322394' },
  ],
};

describe('TXH-01 parsing', () => {
  it('[1] milliseconds are NOT re-scaled', () => {
    const txs = parseExchangeTransactions(BODY);
    // `time` here is a string of epoch ms. Treating it as seconds (as klines are) puts every row in 1970.
    const t = txs.find((x) => x.id === '9689322392')!;
    expect(t.time).toBe(1570608000000);
    expect(new Date(t.time).getUTCFullYear()).toBe(2019);
  });

  it('[2] the sign on amount is preserved', () => {
    const txs = parseExchangeTransactions(BODY);
    // Fees and losses arrive negative. Dropping the sign would show a fee as income.
    expect(txs.find((x) => x.kind === 'COMMISSION_FEE')!.amount).toBe('-0.01000000');
    expect(txs.find((x) => x.kind === 'REALIZED_PNL')!.amount).toBe('12.50000000');
  });

  it('[3] labels map to kinds and the raw label is kept', () => {
    const txs = parseExchangeTransactions(BODY);
    expect(txs.map((x) => x.kind).sort()).toEqual(['COMMISSION_FEE', 'REALIZED_PNL', 'TRANSFER']);
    expect(txs.find((x) => x.kind === 'TRANSFER')!.rawType).toBe('Transfer');
  });

  it('[4] an unmapped label becomes UNKNOWN rather than being dropped', () => {
    const txs = parseExchangeTransactions({
      data: [{ symbol: 'X', type: 'Some New Type', amount: '1', asset: 'USDT', time: '1570608000000', tran_id: 'a' }],
    });
    // A row we cannot classify is still real money; hiding it would understate the ledger.
    expect(txs).toHaveLength(1);
    expect(txs[0]!.kind).toBe('UNKNOWN');
    expect(txs[0]!.rawType).toBe('Some New Type');
  });

  it('[5] an empty symbol becomes null, not an empty string', () => {
    const txs = parseExchangeTransactions(BODY);
    expect(txs.find((x) => x.kind === 'TRANSFER')!.symbol).toBeNull();
    expect(txs.find((x) => x.kind === 'REALIZED_PNL')!.symbol).toBe('BTCUSDT');
  });

  it('[6] rows are newest first', () => {
    const txs = parseExchangeTransactions(BODY);
    expect(txs.map((x) => x.time)).toEqual([1570640000000, 1570636800000, 1570608000000]);
  });

  it('[7] unusable rows are DROPPED, never coerced to zero', () => {
    const txs = parseExchangeTransactions({
      data: [
        { type: 'Transfer', amount: '1', asset: 'USDT', time: '1570608000000' },
        { type: 'Transfer', amount: null, asset: 'USDT', time: '1570608000000' },
        { type: 'Transfer', amount: '1', asset: null, time: '1570608000000' },
        { type: 'Transfer', amount: '1', asset: 'USDT', time: '0' },
        { type: 'Transfer', amount: 'abc', asset: 'USDT', time: '1570608000000' },
        null,
        'nope',
      ],
    });
    // A zero-amount row on a money screen reads as an event that happened for nothing.
    expect(txs).toHaveLength(1);
  });

  it('[8] a row without tran_id still gets a stable non-empty id', () => {
    const txs = parseExchangeTransactions({
      data: [{ type: 'Transfer', amount: '1', asset: 'USDT', time: '1570608000000' }],
    });
    // An empty key collapses React list identity, silently merging rows in the table.
    expect(txs[0]!.id).not.toBe('');
    expect(txs[0]!.id).toContain('1570608000000');
  });

  it('[9] a malformed body yields no rows rather than throwing', () => {
    for (const b of [null, undefined, {}, { data: null }, { data: 'x' }, { code: 40012, message: 'System error' }]) {
      expect(() => parseExchangeTransactions(b)).not.toThrow();
      expect(parseExchangeTransactions(b)).toEqual([]);
    }
  });
});

describe('TXH-02 decimal summation', () => {
  it('[1] exact, not floating point', () => {
    // 0.1 + 0.2 is 0.30000000000000004 as floats.
    expect(sumDecimals(['0.1', '0.2'])).toBe('0.3');
    // A fee and its refund must cancel exactly.
    expect(sumDecimals(['-0.00027', '0.00027'])).toBe('0.00000');
    expect(sumDecimals(['10.238', '21.9895'])).toBe('32.2275');
  });

  it('[2] mixed scales align to the widest', () => {
    expect(sumDecimals(['1', '0.005'])).toBe('1.005');
    expect(sumDecimals(['-1.5', '0.25'])).toBe('-1.25');
  });

  it('[3] integers stay integers', () => {
    expect(sumDecimals(['3', '4'])).toBe('7');
    expect(sumDecimals([])).toBe('0');
  });

  it('[4] a negative total keeps its sign', () => {
    expect(sumDecimals(['-0.375', '-0.01'])).toBe('-0.385');
  });

  it('[5] unparseable entries are skipped rather than poisoning the total', () => {
    expect(sumDecimals(['1.00', 'abc', '2.00'])).toBe('3.00');
  });
});

describe('TXH-03 per-asset per-kind totals', () => {
  it('[1] grouped and summed exactly', () => {
    const totals = summarizeTransactions(parseExchangeTransactions(BODY));
    const fee = totals.find((t) => t.kind === 'COMMISSION_FEE')!;
    expect(fee).toMatchObject({ asset: 'USDT', total: '-0.01000000', count: 1 });
    const pnl = totals.find((t) => t.kind === 'REALIZED_PNL')!;
    expect(pnl.total).toBe('12.50000000');
    // Three distinct kinds, all in USDT.
    expect(totals).toHaveLength(3);
  });

  it('[2] kinds are not merged across assets', () => {
    const totals = summarizeTransactions(
      parseExchangeTransactions({
        data: [
          { type: 'Realized PNL', amount: '1', asset: 'USDT', time: '1', symbol: 'X' },
          { type: 'Realized PNL', amount: '2', asset: 'BTC', time: '2', symbol: 'Y' },
        ],
      }),
    );
    // Adding 1 USDT to 2 BTC would be a fabricated number; no exchange rate is available.
    expect(totals).toHaveLength(2);
    expect(totals.map((t) => t.asset)).toEqual(['BTC', 'USDT']);
  });

  it('[3] no transactions yields no totals, not zeros', () => {
    expect(summarizeTransactions([])).toEqual([]);
  });
});

describe('TXH-04 upstream query parameters', () => {
  it('[1] only provided filters are sent', () => {
    expect(buildTransactionParams({})).toEqual({});
    expect(buildTransactionParams({ symbol: 'BTCUSDT' })).toEqual({ symbol: 'BTCUSDT' });
  });

  it('[2] flowType 0 means all and is omitted', () => {
    // Sending flow_type=0 is not documented as "all"; omitting it is.
    expect(buildTransactionParams({ flowType: 0 })).toEqual({});
    expect(buildTransactionParams({ flowType: 2 })).toEqual({ flow_type: 2 });
  });

  it('[3] times pass through as milliseconds', () => {
    // This endpoint takes ms while the kline endpoints take seconds; converting here would break it.
    expect(buildTransactionParams({ startTime: 1570608000000, endTime: 1570636800000 })).toEqual({
      start_time: 1570608000000,
      end_time: 1570636800000,
    });
  });

  it('[4] page size passes through', () => {
    expect(buildTransactionParams({ pageSize: 500 })).toEqual({ page_size: 500 });
  });

  it('[5] constants match the documented endpoint', () => {
    expect(TRANSACTION_HISTORY_PATH).toBe('/contract/private/transaction-history');
    expect(TRANSACTION_HISTORY_LIMITS.defaultWindowDays).toBe(7);
    expect(TRANSACTION_HISTORY_LIMITS.maxPageSize).toBe(1000);
    expect(Object.values(TRANSACTION_FLOW_TYPES)).toContain('FUNDING_FEE');
  });
});
