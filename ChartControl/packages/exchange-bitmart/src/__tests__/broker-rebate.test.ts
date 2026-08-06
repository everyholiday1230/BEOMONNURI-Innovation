import { describe, it, expect, vi } from 'vitest';
import {
  BITMART_SPOT_REST_BASE,
  BROKER_REBATE_PATH,
  BROKER_ID_HEADER,
  BitMartBrokerRebateClient,
  BrokerRebateError,
  parseRebateRecords,
  summarizeRebates,
  type RebateRecord,
} from '../index';

/**
 * Broker rebate retrieval.
 *
 * These are money figures used for reconciliation against BitMart's own statement, so the tests focus
 * on the ways a number could come out wrong rather than only on the happy path: float drift in
 * summation, a malformed row being coerced to 0, an application-level error arriving with HTTP 200,
 * and futures numbers appearing when no futures endpoint exists.
 */

const KEY = { accessKey: 'operator-access-key' };

const res = (status: number, body: unknown, ok = status >= 200 && status < 300) =>
  ({ status, ok, json: async () => body }) as unknown as Response;

/** The exact response body from the BitMart reference. */
const DOC_RESPONSE = {
  message: 'OK',
  code: 1000,
  trace: 'f7f74924-14da-42a6-b7f2-d3799dd9a612',
  data: {
    rebates: {
      '2022-10-22': [
        { currency: 'USDT', rebate_amount: '10.238' },
        { currency: 'BMX', rebate_amount: '5.68' },
      ],
      '2022-10-23': [{ currency: 'USDT', rebate_amount: '21.9895' }],
    },
  },
};

describe('RBT-01 response parsing', () => {
  it('[1] flattens the documented response into sorted records', () => {
    const recs = parseRebateRecords(DOC_RESPONSE);
    expect(recs).toEqual([
      { date: '2022-10-22', currency: 'BMX', amount: '5.68', source: 'spot' },
      { date: '2022-10-22', currency: 'USDT', amount: '10.238', source: 'spot' },
      { date: '2022-10-23', currency: 'USDT', amount: '21.9895', source: 'spot' },
    ]);
  });

  it('[2] an empty or missing payload yields no records rather than throwing', () => {
    expect(parseRebateRecords({ code: 1000, data: { rebates: {} } })).toEqual([]);
    expect(parseRebateRecords({ code: 1000, data: {} })).toEqual([]);
    expect(parseRebateRecords({})).toEqual([]);
    expect(parseRebateRecords(null)).toEqual([]);
    expect(parseRebateRecords(undefined)).toEqual([]);
  });

  it('[3] unusable rows are dropped, never coerced to a number', () => {
    const recs = parseRebateRecords({
      code: 1000,
      data: {
        rebates: {
          '2026-08-01': [
            { currency: 'USDT', rebate_amount: '1.5' }, // good
            { currency: 'USDT', rebate_amount: 'abc' }, // not a decimal
            { currency: '', rebate_amount: '2.0' }, // no currency
            { currency: 'BMX' }, // no amount
            { rebate_amount: '3.0' }, // no currency
          ],
          'not-a-date': [{ currency: 'USDT', rebate_amount: '99' }],
        },
      },
    });
    // Only the one usable row survives. A dropped row shows up as a discrepancy against BitMart's
    // statement, which is discoverable; a silent 0 would not be.
    expect(recs).toEqual([{ date: '2026-08-01', currency: 'USDT', amount: '1.5', source: 'spot' }]);
  });

  it('[4] currency is upper-cased so USDT and usdt do not become two buckets', () => {
    const recs = parseRebateRecords({
      code: 1000,
      data: { rebates: { '2026-08-01': [{ currency: 'usdt', rebate_amount: '1' }] } },
    });
    expect(recs[0]!.currency).toBe('USDT');
  });
});

describe('RBT-02 summation', () => {
  it('[1] sums per currency exactly, without float drift', () => {
    const s = summarizeRebates(parseRebateRecords(DOC_RESPONSE));
    expect(s.byCurrency).toEqual({ USDT: '32.2275', BMX: '5.68' });
    // 10.238 + 21.9895 in IEEE-754 doubles is 32.227499999999996; a float implementation fails here.
    expect(s.byCurrency['USDT']).not.toContain('99999');
  });

  it('[2] classic float-error operands add exactly', () => {
    const recs: RebateRecord[] = [
      { date: '2026-08-01', currency: 'USDT', amount: '0.1', source: 'spot' },
      { date: '2026-08-02', currency: 'USDT', amount: '0.2', source: 'spot' },
    ];
    expect(summarizeRebates(recs).byCurrency['USDT']).toBe('0.3');
  });

  it('[3] mixed scales and negatives are handled', () => {
    const recs: RebateRecord[] = [
      { date: '2026-08-01', currency: 'USDT', amount: '1', source: 'spot' },
      { date: '2026-08-02', currency: 'USDT', amount: '2.500', source: 'spot' },
      { date: '2026-08-03', currency: 'USDT', amount: '-0.25', source: 'spot' },
    ];
    expect(summarizeRebates(recs).byCurrency['USDT']).toBe('3.25');
  });

  it('[4] spot and futures stay separable — the open eligibility question', () => {
    const recs: RebateRecord[] = [
      { date: '2026-08-01', currency: 'USDT', amount: '10', source: 'spot' },
      { date: '2026-08-01', currency: 'USDT', amount: '4', source: 'futures' },
    ];
    const s = summarizeRebates(recs);
    expect(s.bySource.spot).toEqual({ USDT: '10' });
    expect(s.bySource.futures).toEqual({ USDT: '4' });
    expect(s.byCurrency).toEqual({ USDT: '14' });
  });

  it('[5] no fiat grand total is invented', () => {
    const s = summarizeRebates(parseRebateRecords(DOC_RESPONSE)) as unknown as Record<string, unknown>;
    // Converting BMX+USDT into one figure needs FX rates this layer does not have.
    expect('totalUsd' in s).toBe(false);
    expect('total' in s).toBe(false);
  });

  it('[6] reports the covered date range and record count', () => {
    const s = summarizeRebates(parseRebateRecords(DOC_RESPONSE));
    expect(s.from).toBe('2022-10-22');
    expect(s.to).toBe('2022-10-23');
    expect(s.recordCount).toBe(3);
    expect(s.currencies).toEqual(['BMX', 'USDT']);
  });

  it('[7] an empty set summarizes to empty, not to zeroes', () => {
    const s = summarizeRebates([]);
    expect(s.byCurrency).toEqual({});
    expect(s.from).toBeNull();
    expect(s.recordCount).toBe(0);
  });
});

describe('RBT-03 HTTP client', () => {
  it('[1] calls the documented URL with KEYED auth and the broker id', async () => {
    const fetchImpl = vi.fn(async () => res(200, DOC_RESPONSE)) as unknown as typeof fetch;
    const c = new BitMartBrokerRebateClient({ fetchImpl, brokerId: 'BEOMONNURI12345' });

    const recs = await c.getSpotRebates(KEY);
    expect(recs).toHaveLength(3);

    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    const url = String(mock.mock.calls[0]?.[0]);
    expect(url).toBe(`${BITMART_SPOT_REST_BASE}${BROKER_REBATE_PATH}`);

    const headers = (mock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers['X-BM-KEY']).toBe(KEY.accessKey);
    expect(headers[BROKER_ID_HEADER]).toBe('BEOMONNURI12345');
    // KEYED endpoints are unsigned — sending a signature would be wrong, not merely redundant.
    expect('X-BM-SIGN' in headers).toBe(false);
  });

  it('[2] omitting both bounds sends no query string (BitMart then returns 180 days)', async () => {
    const fetchImpl = vi.fn(async () => res(200, DOC_RESPONSE)) as unknown as typeof fetch;
    await new BitMartBrokerRebateClient({ fetchImpl }).getSpotRebates(KEY);
    const url = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(url.includes('?')).toBe(false);
  });

  it('[3] bounds are passed through as integer seconds', async () => {
    const fetchImpl = vi.fn(async () => res(200, DOC_RESPONSE)) as unknown as typeof fetch;
    await new BitMartBrokerRebateClient({ fetchImpl }).getSpotRebates(KEY, {
      startTime: 1683365678.9,
      endTime: 1683367993,
    });
    const url = String((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]);
    expect(url).toContain('start_time=1683365678');
    expect(url).toContain('end_time=1683367993');
  });

  it('[4] an application error arriving with HTTP 200 is still an error', async () => {
    // 53005 = key has no broker-interface permission. HTTP is 200, so status alone would pass.
    const fetchImpl = vi.fn(async () =>
      res(200, { code: 53005, message: 'You do not have permission to access the interface' }),
    ) as unknown as typeof fetch;

    await expect(new BitMartBrokerRebateClient({ fetchImpl }).getSpotRebates(KEY)).rejects.toThrow(
      /53005/u,
    );
  });

  it('[5] the 53005 message explains what to fix', async () => {
    const fetchImpl = vi.fn(async () => res(200, { code: 53005 })) as unknown as typeof fetch;
    const err = await new BitMartBrokerRebateClient({ fetchImpl })
      .getSpotRebates(KEY)
      .catch((e: unknown) => e as BrokerRebateError);
    expect(err).toBeInstanceOf(BrokerRebateError);
    expect((err as BrokerRebateError).code).toBe(53005);
    expect((err as BrokerRebateError).message).toContain('broker-interface permission');
  });

  it('[6] out-of-range window (50041) is reported distinctly', async () => {
    const fetchImpl = vi.fn(async () => res(200, { code: 50041 })) as unknown as typeof fetch;
    const err = await new BitMartBrokerRebateClient({ fetchImpl })
      .getSpotRebates(KEY, { startTime: 1, endTime: 2 })
      .catch((e: unknown) => e as BrokerRebateError);
    expect((err as BrokerRebateError).message).toContain('out of the allowed window');
  });

  it('[7] an HTTP failure carries the status', async () => {
    const fetchImpl = vi.fn(async () => res(403, {}, false)) as unknown as typeof fetch;
    const err = await new BitMartBrokerRebateClient({ fetchImpl })
      .getSpotRebates(KEY)
      .catch((e: unknown) => e as BrokerRebateError);
    expect((err as BrokerRebateError).httpStatus).toBe(403);
  });

  it('[8] a network failure is wrapped, not leaked raw', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const err = await new BitMartBrokerRebateClient({ fetchImpl })
      .getSpotRebates(KEY)
      .catch((e: unknown) => e as BrokerRebateError);
    expect(err).toBeInstanceOf(BrokerRebateError);
    expect((err as BrokerRebateError).httpStatus).toBe(0);
  });

  it('[9] a missing operator key fails before any request is made', async () => {
    const fetchImpl = vi.fn(async () => res(200, DOC_RESPONSE)) as unknown as typeof fetch;
    await expect(
      new BitMartBrokerRebateClient({ fetchImpl }).getSpotRebates({ accessKey: '' }),
    ).rejects.toThrow(/operator access key is required/u);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('[10] futures retrieval throws instead of returning an empty set', async () => {
    // An empty array would render as a real zero on a revenue dashboard. Until BitMart confirms
    // eligibility and an endpoint, the only honest answer is a refusal.
    const c = new BitMartBrokerRebateClient({});
    await expect(c.getFuturesRebates()).rejects.toThrow(/not implemented/u);
    await expect(c.getFuturesRebates()).rejects.toThrow(/unconfirmed/u);
  });
});
