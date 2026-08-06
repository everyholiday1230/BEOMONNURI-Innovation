import { describe, it, expect, vi } from 'vitest';
import {
  sign,
  buildSigningPayload,
  buildSignedHeaders,
  normalizeQuery,
  serializeBody,
  driftAcceptable,
  timestampDriftMs,
  evaluateLiveTradingGate,
  isOrderMutationAllowed,
  normalizeOrder,
  BitMartFuturesAdapter,
  PrivateEventDedup,
  type ExchangeContext,
} from '../index';

const CRED = { accessKey: 'ak', secretKey: 'mySecret', memo: 'myMemo' };

describe('BitMart signature', () => {
  it('matches a known HMAC-SHA256 test vector', () => {
    const payload = buildSigningPayload('1700000000000', 'myMemo', 'symbol=BTCUSDT&size=1');
    expect(payload).toBe('1700000000000#myMemo#symbol=BTCUSDT&size=1');
    expect(sign('mySecret', payload)).toBe('b2574adb845e56c725ac689b86659f6ad5beacdf0ba25145110292b7d279d5b0');
  });
  it('builds X-BM-* headers; signing string == transmitted payload', () => {
    const query = normalizeQuery({ size: 1, symbol: 'BTCUSDT' }); // sorted → symbol first
    expect(query).toBe('size=1&symbol=BTCUSDT');
    const h = buildSignedHeaders(CRED, '1700000000000', query);
    expect(h['X-BM-KEY']).toBe('ak');
    expect(h['X-BM-TIMESTAMP']).toBe('1700000000000');
    expect(h['X-BM-SIGN']).toBe(sign('mySecret', `1700000000000#myMemo#${query}`));
  });
  it('deterministic body serialization (stable key order)', () => {
    expect(serializeBody({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
  it('detects timestamp drift outside tolerance', () => {
    expect(driftAcceptable(timestampDriftMs(1_000_000, 1_000_100))).toBe(true);
    expect(driftAcceptable(timestampDriftMs(1_000_000, 1_010_000))).toBe(false);
  });
});

describe('live trading gate', () => {
  const base = {
    mode: 'BITMART_LIVE_TRADE' as const, liveTradingEnabled: true, emergencyKillSwitch: false,
    credentialStatus: 'VERIFIED', futureTradePermissionVerified: true, userStatus: 'active',
    riskCheckPassed: true, previewExpired: false, confirmationTokenValid: true, idempotencyKeyValid: true,
    marketDataStale: false, exchangeConnectivityHealthy: true, symbol: 'BTCUSDT', allowedSymbols: ['BTCUSDT'],
  };
  it('allows only when every protection passes', () => {
    expect(evaluateLiveTradingGate(base).allowed).toBe(true);
  });
  it('DEFAULT config (flag off / kill switch on) blocks', () => {
    expect(evaluateLiveTradingGate({ ...base, liveTradingEnabled: false }).allowed).toBe(false);
    expect(evaluateLiveTradingGate({ ...base, emergencyKillSwitch: true }).allowed).toBe(false);
    expect(evaluateLiveTradingGate({ ...base, mode: 'BITMART_LIVE_SHADOW' }).allowed).toBe(false);
    expect(evaluateLiveTradingGate({ ...base, symbol: 'DOGEUSDT' }).allowed).toBe(false);
  });
  it('read-only/shadow never permit mutation transmission', () => {
    expect(isOrderMutationAllowed('BITMART_LIVE_READ_ONLY')).toBe(false);
    expect(isOrderMutationAllowed('BITMART_LIVE_SHADOW')).toBe(false);
    expect(isOrderMutationAllowed('BITMART_LIVE_TRADE')).toBe(true);
  });
});

const res = (status: number, body: unknown, ok = status >= 200 && status < 300) => ({ status, ok, json: async () => body }) as unknown as Response;
const ctx = (mode: ExchangeContext['mode']): ExchangeContext => ({ mode, credential: CRED });

describe('Futures adapter (mock fetch)', () => {
  it('READ_ONLY balances via signed GET', async () => {
    const fetchImpl = vi.fn(async () => res(200, { data: [{ currency: 'USDT', available_balance: '1000', equity: '1200', frozen_balance: '200' }] })) as unknown as typeof fetch;
    const a = new BitMartFuturesAdapter({ restBase: 'https://x', fetchImpl });
    const bal = await a.getBalances(ctx('BITMART_LIVE_READ_ONLY'));
    expect(bal[0]!.available).toBe('1000');
  });

  it('SHADOW submitOrder does NOT transmit (REJECTED, fetch never called)', async () => {
    const fetchImpl = vi.fn(async () => res(200, { data: {} })) as unknown as typeof fetch;
    const a = new BitMartFuturesAdapter({ restBase: 'https://x', fetchImpl });
    const out = await a.submitOrder(ctx('BITMART_LIVE_SHADOW'), { clientOrderId: 'c1', symbol: 'BTCUSDT', side: 'long', type: 'limit', price: '68000', quantity: '0.001' });
    expect(out.status).toBe('REJECTED');
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('TRADE 4xx → REJECTED (terminal, no reconcile)', async () => {
    const fetchImpl = vi.fn(async () => res(400, { message: 'bad' }, false)) as unknown as typeof fetch;
    const a = new BitMartFuturesAdapter({ restBase: 'https://x', fetchImpl });
    const out = await a.submitOrder(ctx('BITMART_LIVE_TRADE'), { clientOrderId: 'c2', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.001' });
    expect(out.status).toBe('REJECTED');
  });

  it('TRADE timeout → SUBMIT_UNKNOWN (never auto-retry)', async () => {
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {})) as unknown as typeof fetch; // never resolves
    const a = new BitMartFuturesAdapter({ restBase: 'https://x', fetchImpl, timeoutMs: 30 });
    const out = await a.submitOrder(ctx('BITMART_LIVE_TRADE'), { clientOrderId: 'c3', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.001' });
    expect(out.status).toBe('SUBMIT_UNKNOWN');
    if (out.status === 'SUBMIT_UNKNOWN') expect(out.clientOrderId).toBe('c3');
  });

  it('TRADE 429 → SUBMIT_UNKNOWN (ambiguous, reconcile)', async () => {
    const fetchImpl = vi.fn(async () => res(429, {}, false)) as unknown as typeof fetch;
    const a = new BitMartFuturesAdapter({ restBase: 'https://x', fetchImpl });
    const out = await a.submitOrder(ctx('BITMART_LIVE_TRADE'), { clientOrderId: 'c4', symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.001' });
    expect(out.status).toBe('SUBMIT_UNKNOWN');
  });

  it('getOrderByClientId reconciles a SUBMIT_UNKNOWN order', async () => {
    const fetchImpl = vi.fn(async () => res(200, { data: { client_order_id: 'c3', order_id: '999', symbol: 'BTCUSDT', state: 4, size: '0.001', filled_size: '0.001' } })) as unknown as typeof fetch;
    const a = new BitMartFuturesAdapter({ restBase: 'https://x', fetchImpl });
    const o = await a.getOrderByClientId(ctx('BITMART_LIVE_READ_ONLY'), 'c3');
    expect(o?.exchangeOrderId).toBe('999');
    expect(o?.status).toBe('FILLED');
  });
});

describe('normalizeOrder + private event dedup', () => {
  it('maps BitMart order fields + status', () => {
    const o = normalizeOrder({ client_order_id: 'x', order_id: '1', symbol: 'BTCUSDT', state: 5, size: '1', filled_size: '0.5' });
    expect(o.status).toBe('PARTIALLY_FILLED');
    expect(o.filledQuantity).toBe('0.5');
  });
  it('drops duplicate and out-of-order events', () => {
    const d = new PrivateEventDedup();
    expect(d.accept('order:c1', 1, 'e1')).toBe(true);
    expect(d.accept('order:c1', 1, 'e1')).toBe(false); // duplicate id
    expect(d.accept('order:c1', 3, 'e3')).toBe(true);
    expect(d.accept('order:c1', 2, 'e2')).toBe(false); // stale/out-of-order
  });
});
