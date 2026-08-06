import { describe, it, expect, vi } from 'vitest';
import { BITMART_BROKER_ID } from '@quantumtrade/config';
import {
  BROKER_ID_HEADER,
  BitMartFuturesAdapter,
  buildKeyedHeaders,
  buildSignedHeaders,
  normalizeQuery,
  sign,
  type ExchangeContext,
} from '../index';

/**
 * BitMart API Broker attribution (`X-BM-BROKER-ID`).
 *
 * Two things must hold, and both are easy to break silently:
 *
 *  1. The header actually reaches BitMart on every authenticated request. If it does not, orders fill
 *     normally and earn no rebate — a revenue loss with no error anywhere. So the assertions read the
 *     headers off a spied `fetch` rather than testing the builder alone.
 *  2. Adding the header does not change the signature. BitMart computes `X-BM-SIGN` over
 *     `timestamp#memo#queryString` only; if the broker id ever leaked into the signing payload every
 *     authenticated call would start returning 30005 "Header X-BM-SIGN is wrong".
 */

const CRED = { accessKey: 'ak', secretKey: 'mySecret', memo: 'myMemo' };
const BROKER = 'BEOMONNURI12345';

const res = (status: number, body: unknown, ok = status >= 200 && status < 300) =>
  ({ status, ok, json: async () => body }) as unknown as Response;
const ctx = (mode: ExchangeContext['mode']): ExchangeContext => ({ mode, credential: CRED });

/** Headers of the Nth fetch call, normalized to a plain record. */
function headersOf(fetchImpl: unknown, call = 0): Record<string, string> {
  const mock = fetchImpl as ReturnType<typeof vi.fn>;
  const init = mock.mock.calls[call]?.[1] as RequestInit | undefined;
  return (init?.headers ?? {}) as Record<string, string>;
}

describe('BRK-01 broker id constant', () => {
  it('[1] is the id BitMart issued to us', () => {
    expect(BITMART_BROKER_ID).toBe(BROKER);
  });

  it('[2] header name matches the BitMart spec exactly (case included)', () => {
    expect(BROKER_ID_HEADER).toBe('X-BM-BROKER-ID');
  });
});

describe('BRK-02 header construction', () => {
  it('[1] signed headers carry the broker id when configured', () => {
    const h = buildSignedHeaders(CRED, '1700000000000', 'size=1', BROKER);
    expect(h[BROKER_ID_HEADER]).toBe(BROKER);
    expect(h['X-BM-KEY']).toBe('ak');
    expect(h['X-BM-TIMESTAMP']).toBe('1700000000000');
  });

  it('[2] the signature is byte-identical with and without the broker id', () => {
    const query = normalizeQuery({ size: 1, symbol: 'BTCUSDT' });
    const withBroker = buildSignedHeaders(CRED, '1700000000000', query, BROKER);
    const without = buildSignedHeaders(CRED, '1700000000000', query);

    expect(withBroker['X-BM-SIGN']).toBe(without['X-BM-SIGN']);
    // And it still equals the documented payload, so the check cannot pass by both being wrong.
    expect(withBroker['X-BM-SIGN']).toBe(sign('mySecret', `1700000000000#myMemo#${query}`));
  });

  it('[3] the header is omitted, not blank, when no broker id is configured', () => {
    const h = buildSignedHeaders(CRED, '1700000000000', 'size=1');
    expect(BROKER_ID_HEADER in h).toBe(false);
  });

  it('[4] a blank or whitespace-only id is treated as absent', () => {
    for (const bad of ['', '   ', '\t']) {
      const h = buildSignedHeaders(CRED, '1700000000000', 'size=1', bad);
      expect(BROKER_ID_HEADER in h, `input=${JSON.stringify(bad)}`).toBe(false);
    }
  });

  it('[5] surrounding whitespace is trimmed rather than transmitted', () => {
    const h = buildSignedHeaders(CRED, '1700000000000', 'size=1', `  ${BROKER}\n`);
    expect(h[BROKER_ID_HEADER]).toBe(BROKER);
  });

  it('[6] KEYED headers carry the broker id and still send no signature', () => {
    const h = buildKeyedHeaders('ak', BROKER);
    expect(h['X-BM-KEY']).toBe('ak');
    expect(h[BROKER_ID_HEADER]).toBe(BROKER);
    expect('X-BM-SIGN' in h).toBe(false);
    expect('X-BM-TIMESTAMP' in h).toBe(false);
  });

  it('[7] KEYED headers omit the broker id when unconfigured', () => {
    expect(BROKER_ID_HEADER in buildKeyedHeaders('ak')).toBe(false);
  });
});

describe('BRK-03 the adapter transmits the header', () => {
  it('[1] signed GET (balances) sends the broker id', async () => {
    const fetchImpl = vi.fn(async () => res(200, { data: [] })) as unknown as typeof fetch;
    const a = new BitMartFuturesAdapter({ restBase: 'https://x', fetchImpl, brokerId: BROKER });
    await a.getBalances(ctx('BITMART_LIVE_READ_ONLY'));
    expect(headersOf(fetchImpl)[BROKER_ID_HEADER]).toBe(BROKER);
  });

  it('[2] signed POST (submitOrder) sends the broker id — the request that earns the rebate', async () => {
    const fetchImpl = vi.fn(async () =>
      res(200, { data: { order_id: '1', state: 4 } }),
    ) as unknown as typeof fetch;
    const a = new BitMartFuturesAdapter({ restBase: 'https://x', fetchImpl, brokerId: BROKER });

    const out = await a.submitOrder(ctx('BITMART_LIVE_TRADE'), {
      clientOrderId: 'c1',
      symbol: 'BTCUSDT',
      side: 'long',
      type: 'limit',
      price: '68000',
      quantity: '0.001',
    });

    expect(out.status).toBe('ACCEPTED');
    const h = headersOf(fetchImpl);
    expect(h[BROKER_ID_HEADER]).toBe(BROKER);
    // content-type must survive the header merge that adds the broker id.
    expect(h['content-type']).toBe('application/json');
  });

  it('[3] cancelOrder also carries attribution', async () => {
    const fetchImpl = vi.fn(async () => res(200, { data: {} })) as unknown as typeof fetch;
    const a = new BitMartFuturesAdapter({ restBase: 'https://x', fetchImpl, brokerId: BROKER });
    await a.cancelOrder(ctx('BITMART_LIVE_TRADE'), 'BTCUSDT', 'c1');
    expect(headersOf(fetchImpl)[BROKER_ID_HEADER]).toBe(BROKER);
  });

  it('[4] an adapter with no broker id sends no such header', async () => {
    const fetchImpl = vi.fn(async () => res(200, { data: [] })) as unknown as typeof fetch;
    const a = new BitMartFuturesAdapter({ restBase: 'https://x', fetchImpl });
    await a.getBalances(ctx('BITMART_LIVE_READ_ONLY'));
    expect(BROKER_ID_HEADER in headersOf(fetchImpl)).toBe(false);
  });

  it('[5] the transmitted signature matches the transmitted query exactly', async () => {
    // Guards the invariant the whole adapter rests on: signing string == bytes actually sent. The
    // broker id must not disturb it.
    const fetchImpl = vi.fn(async () => res(200, { data: [] })) as unknown as typeof fetch;
    const now = () => 1_700_000_000_000;
    const a = new BitMartFuturesAdapter({ restBase: 'https://x', fetchImpl, brokerId: BROKER, now });

    await a.getOpenOrders(ctx('BITMART_LIVE_READ_ONLY'), 'BTCUSDT');

    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    const url = String(mock.mock.calls[0]?.[0]);
    const query = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
    expect(headersOf(fetchImpl)['X-BM-SIGN']).toBe(
      sign('mySecret', `1700000000000#myMemo#${query}`),
    );
  });

  it('[6] a mode that does not transmit sends nothing at all', async () => {
    const fetchImpl = vi.fn(async () => res(200, { data: {} })) as unknown as typeof fetch;
    const a = new BitMartFuturesAdapter({ restBase: 'https://x', fetchImpl, brokerId: BROKER });
    const out = await a.submitOrder(ctx('BITMART_LIVE_SHADOW'), {
      clientOrderId: 'c9',
      symbol: 'BTCUSDT',
      side: 'long',
      type: 'market',
      quantity: '0.001',
    });
    expect(out.status).toBe('REJECTED');
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });
});
