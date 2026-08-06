import { describe, it, expect, vi } from 'vitest';
import { BitMartFuturesAdapter, CircuitBreaker, type ExchangeContext } from '@quantumtrade/exchange-bitmart';
import { LiveOrderService } from '../trading/live-order-service';
import { IdempotencyService, MemoryIdempotencyStore, newClientOrderId } from '../trading/idempotency';

const CRED = { accessKey: 'ak', secretKey: 'sk', memo: 'm' };
const ctx = (mode: ExchangeContext['mode']): ExchangeContext => ({ mode, credential: CRED });
const res = (status: number, body: unknown, ok = status >= 200 && status < 300) => ({ status, ok, json: async () => body }) as unknown as Response;

/** Build an adapter whose fetch is scripted by URL/method. */
function adapterWith(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetchImpl = vi.fn((url: string, init?: RequestInit) => handler(url, init)) as unknown as typeof fetch;
  const a = new BitMartFuturesAdapter({ restBase: 'https://x', fetchImpl, timeoutMs: 30 });
  return { a, fetchImpl };
}
const svc = (a: BitMartFuturesAdapter) => new LiveOrderService(a, a, new IdempotencyService(new MemoryIdempotencyStore()));

describe('Phase 3 trading — forced scenarios (mock adapter)', () => {
  it('SHADOW submit is never transmitted (adapter REJECTED, order not placed)', async () => {
    const { a, fetchImpl } = adapterWith(async () => res(200, { data: {} }));
    const s = svc(a);
    const coid = newClientOrderId();
    const rec = await s.submit(ctx('BITMART_LIVE_SHADOW'), 'userA', { clientOrderId: coid, symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.001' }, 'idem-shadow');
    expect(rec.state).toBe('REJECTED');
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  it('timeout BEFORE definite submit → SUBMIT_UNKNOWN → reconcile finds nothing → REJECTED (safe, no resubmit)', async () => {
    const { a, fetchImpl } = adapterWith(async (url) => {
      if (url.includes('submit-order')) return new Promise<Response>(() => {}); // hang → timeout
      if (url.includes('/contract/private/order')) return res(200, { data: null }); // reconcile: not found
      return res(200, {});
    });
    const s = svc(a);
    const coid = newClientOrderId();
    const rec = await s.submit(ctx('BITMART_LIVE_TRADE'), 'userA', { clientOrderId: coid, symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.001' }, 'idem-t1');
    expect(rec.events.map((e) => e.to)).toContain('SUBMIT_UNKNOWN');
    expect(rec.events.map((e) => e.to)).toContain('RECONCILING');
    expect(rec.state).toBe('REJECTED');
    // submit attempted once; NO second submit-order call (no blind resubmit).
    const submitCalls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes('submit-order'));
    expect(submitCalls.length).toBe(1);
  });

  it('timeout AFTER a real submit → reconcile finds FILLED → FILLED', async () => {
    const { a } = adapterWith(async (url) => {
      if (url.includes('submit-order')) return new Promise<Response>(() => {});
      if (url.includes('/contract/private/order')) return res(200, { data: { client_order_id: 'x', order_id: '555', symbol: 'BTCUSDT', state: 4, size: '0.001', filled_size: '0.001' } });
      return res(200, {});
    });
    const s = svc(a);
    const coid = newClientOrderId();
    const rec = await s.submit(ctx('BITMART_LIVE_TRADE'), 'userA', { clientOrderId: coid, symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.001' }, 'idem-t2');
    expect(rec.state).toBe('FILLED');
    expect(rec.exchangeOrderId).toBe('555');
  });

  it('429 on submit → SUBMIT_UNKNOWN → reconcile OPEN', async () => {
    const { a } = adapterWith(async (url) => {
      if (url.includes('submit-order')) return res(429, {}, false);
      if (url.includes('/contract/private/order')) return res(200, { data: { client_order_id: 'x', order_id: '7', symbol: 'BTCUSDT', state: 2, size: '0.001', filled_size: '0' } });
      return res(200, {});
    });
    const s = svc(a);
    const rec = await s.submit(ctx('BITMART_LIVE_TRADE'), 'userA', { clientOrderId: newClientOrderId(), symbol: 'BTCUSDT', side: 'long', type: 'market', quantity: '0.001' }, 'idem-429');
    expect(rec.state).toBe('OPEN');
  });

  it('duplicate submit (same idempotency key) does not place a second order', async () => {
    let submits = 0;
    const { a } = adapterWith(async (url) => {
      if (url.includes('submit-order')) { submits++; return res(200, { data: { order_id: String(submits) } }); }
      return res(200, {});
    });
    const s = svc(a);
    const coid = newClientOrderId();
    const req = { clientOrderId: coid, symbol: 'BTCUSDT', side: 'long' as const, type: 'market' as const, quantity: '0.001' };
    const r1 = await s.submit(ctx('BITMART_LIVE_TRADE'), 'userA', req, 'idem-dup');
    const r2 = await s.submit(ctx('BITMART_LIVE_TRADE'), 'userA', req, 'idem-dup');
    expect(submits).toBe(1);
    expect(r1).toBe(r2);
  });

  it('partial fill then full fill via private-WS events (dedup + ordering)', async () => {
    const { a } = adapterWith(async (url) => (url.includes('submit-order') ? res(200, { data: { order_id: '9' } }) : res(200, {})));
    const s = svc(a);
    const coid = newClientOrderId();
    await s.submit(ctx('BITMART_LIVE_TRADE'), 'userA', { clientOrderId: coid, symbol: 'BTCUSDT', side: 'long', type: 'limit', price: '68000', quantity: '0.002' }, 'idem-pf');
    // ACCEPTED → OPEN → PARTIALLY_FILLED → FILLED
    expect(s.applyOrderEvent(coid, 1, 'e1', 'OPEN')).toBe(true);
    expect(s.applyOrderEvent(coid, 2, 'e2', 'PARTIALLY_FILLED', '0.001')).toBe(true);
    expect(s.applyOrderEvent(coid, 2, 'e2', 'PARTIALLY_FILLED', '0.001')).toBe(false); // duplicate id
    expect(s.applyOrderEvent(coid, 1, 'e-old', 'OPEN')).toBe(false); // out-of-order (stale seq)
    expect(s.applyOrderEvent(coid, 3, 'e3', 'FILLED', '0.002')).toBe(true);
    expect(s.get(coid)!.state).toBe('FILLED');
    expect(s.get(coid)!.filledQuantity).toBe('0.002');
  });

  it('cancel/fill race: a FILLED event after CANCEL_PENDING is applied (fill wins)', async () => {
    const { a } = adapterWith(async (url) => (url.includes('submit-order') ? res(200, { data: { order_id: '10' } }) : res(200, {})));
    const s = svc(a);
    const coid = newClientOrderId();
    await s.submit(ctx('BITMART_LIVE_TRADE'), 'userA', { clientOrderId: coid, symbol: 'BTCUSDT', side: 'long', type: 'limit', price: '68000', quantity: '0.001' }, 'idem-race');
    s.applyOrderEvent(coid, 1, 'e1', 'OPEN');
    // cancel requested locally
    s.get(coid)!.state = 'CANCEL_PENDING';
    // fill arrives → CANCEL_PENDING → FILLED is legal
    expect(s.applyOrderEvent(coid, 2, 'e2', 'FILLED', '0.001')).toBe(true);
    expect(s.get(coid)!.state).toBe('FILLED');
  });

  it('§15 circuit breaker opens after repeated 5xx on submit → fails fast (no network, SUBMIT_UNKNOWN-safe)', async () => {
    const breaker = new CircuitBreaker(3, 10_000); // open after 3 consecutive failures
    let submitAttempts = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('submit-order')) { submitAttempts++; return res(500, {}, false); } // always 5xx
      return res(200, {});
    }) as unknown as typeof fetch;
    const a = new BitMartFuturesAdapter({ restBase: 'https://x', fetchImpl, timeoutMs: 50, breaker });
    const req = { clientOrderId: newClientOrderId(), symbol: 'BTCUSDT', side: 'long' as const, type: 'market' as const, quantity: '0.001' };
    // 3 failing submits (5xx) → each is ambiguous SUBMIT_UNKNOWN and trips the breaker one step.
    for (let i = 0; i < 3; i++) {
      const out = await a.submitOrder(ctx('BITMART_LIVE_TRADE'), req);
      expect(out.status).toBe('SUBMIT_UNKNOWN'); // 5xx is ambiguous — never assumed failed, never blind-resubmit
    }
    expect(breaker.canRequest()).toBe(false); // circuit OPEN
    const attemptsBefore = submitAttempts;
    // Next submit fails fast via the open circuit — NO network call — and is still SUBMIT_UNKNOWN (safe).
    const out = await a.submitOrder(ctx('BITMART_LIVE_TRADE'), req);
    expect(out.status).toBe('SUBMIT_UNKNOWN');
    expect(submitAttempts).toBe(attemptsBefore); // fail-fast: no new network submit attempt
  });
});
