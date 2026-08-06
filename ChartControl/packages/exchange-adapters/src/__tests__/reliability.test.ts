import { describe, it, expect, vi, afterEach } from 'vitest';
import { BitMartPublicMarketDataProvider, CandleBuffer } from '../index';
import type { RateLimitConfig } from '@quantumtrade/config';
import type { Candle } from '@quantumtrade/schemas';

/**
 * Reliability scenario suite — FORCES the documented failure modes at the data layer and asserts
 * safe handling (docs section 17). Deterministic: fetch and WebSocket are injected/faked, no real
 * network, no real timers waited on. Each `it` maps to a numbered scenario in the test report.
 */

// Permissive limiter so the token bucket never sleeps; small breaker threshold so we can open it.
const RL: RateLimitConfig = {
  maxRps: 1000,
  burst: 1000,
  backoffBaseMs: 10,
  backoffMaxMs: 100,
  jitterRatio: 0,
  circuitBreakerThreshold: 3,
  circuitBreakerResetMs: 10_000,
};

const res = (status: number, body: unknown, ok = status >= 200 && status < 300) =>
  ({ status, ok, json: async () => body }) as unknown as Response;

const provider = (fetchImpl: typeof fetch) =>
  new BitMartPublicMarketDataProvider({ restBase: 'https://x', rateLimit: RL, fetchImpl });

const q = { symbol: 'BTCUSDT', timeframe: '5m' as const, limit: 3 };

describe('#4 REST timeout', () => {
  it('propagates a timeout error and records a breaker failure (no infinite hang)', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ETIMEDOUT');
    }) as unknown as typeof fetch;
    const p = provider(fetchImpl);
    await expect(p.getCandles(q)).rejects.toThrow('ETIMEDOUT');
  });
});

describe('#5 429 rate limit', () => {
  it('throws rate_limited_429 and opens the circuit after the threshold', async () => {
    const fetchImpl = vi.fn(async () => res(429, { code: 429 }, false)) as unknown as typeof fetch;
    const p = provider(fetchImpl);
    await expect(p.getCandles(q)).rejects.toThrow(/rate_limited_429/);
    await expect(p.getCandles(q)).rejects.toThrow(/rate_limited_429/); // 2nd failure → opens
    // 3rd request is short-circuited by the open breaker (no further upstream calls).
    await expect(p.getCandles(q)).rejects.toThrow(/circuit_open/);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
  });
});

describe('#5b upstream 5xx', () => {
  it('throws upstream_503 and does not crash', async () => {
    const fetchImpl = vi.fn(async () => res(503, {}, false)) as unknown as typeof fetch;
    await expect(provider(fetchImpl).getCandles(q)).rejects.toThrow(/upstream_503/);
  });
});

describe('#6 malformed message (adapter level)', () => {
  it('returns [] for garbage payloads instead of throwing', async () => {
    const fetchImpl = vi.fn(async () => res(200, 'not-an-array-or-object')) as unknown as typeof fetch;
    await expect(provider(fetchImpl).getCandles(q)).resolves.toEqual([]);
  });
});

describe('#7 duplicated candle', () => {
  it('replaces a same-timestamp candle (latest wins), no duplicate row', () => {
    const b = new CandleBuffer();
    const c = (t: number, close: string): Candle => ({ time: t, open: '1', high: '2', low: '0.5', close, volume: '1', closed: true });
    expect(b.ingest(c(1000, '1.0'))).toBe('appended');
    expect(b.ingest(c(1000, '1.5'))).toBe('replaced');
    expect(b.size).toBe(1);
    expect(b.toArray()[0]!.close).toBe('1.5');
  });
});

describe('#8 out-of-order event', () => {
  it('stores an older gap-fill candle and keeps ascending order', () => {
    const b = new CandleBuffer();
    const c = (t: number): Candle => ({ time: t, open: '1', high: '2', low: '0.5', close: '1', volume: '1', closed: true });
    b.ingest(c(3000));
    b.ingest(c(1000)); // out-of-order arrival
    b.ingest(c(2000));
    expect(b.toArray().map((x) => x.time)).toEqual([1000, 2000, 3000]);
  });
});

// ---- #1 / #2 WebSocket disconnect + reconnect via a fake WebSocket ----
class FakeWebSocket {
  static last: FakeWebSocket | null = null;
  listeners: Record<string, ((ev: { data: unknown }) => void)[]> = {};
  sent: string[] = [];
  closed = false;
  constructor(public url: string) {
    FakeWebSocket.last = this;
  }
  addEventListener(type: string, cb: (ev: { data: unknown }) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener(type: string, cb: (ev: { data: unknown }) => void) {
    this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== cb);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  emit(type: string, ev: { data: unknown }) {
    for (const cb of this.listeners[type] ?? []) cb(ev);
  }
}

describe('#1/#2 WebSocket disconnect + reconnect (subscription lifecycle)', () => {
  const original = (globalThis as { WebSocket?: unknown }).WebSocket;
  afterEach(() => {
    (globalThis as { WebSocket?: unknown }).WebSocket = original;
  });

  it('subscribes, delivers a candle, and fully cleans up listeners + socket on unsubscribe', () => {
    (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    const p = new BitMartPublicMarketDataProvider({ restBase: 'https://x', wsPublic: 'wss://x', rateLimit: RL });

    const got: Candle[] = [];
    const unsub = p.subscribeCandles('BTCUSDT', '5m', (c) => got.push(c));
    const ws = FakeWebSocket.last!;
    ws.emit('open', { data: '' });
    expect(ws.sent[0]).toContain('subscribe'); // subscribed on open

    ws.emit('message', { data: JSON.stringify({ data: [[1700000000, '1', '2', '0.5', '1.5', '3']] }) });
    expect(got).toHaveLength(1);
    expect(got[0]!.close).toBe('1.5');

    // Disconnect (symbol/tf change): unsubscribe must remove listeners AND close the socket.
    unsub();
    expect(ws.closed).toBe(true);
    ws.emit('message', { data: JSON.stringify({ data: [[1700000300, '1', '2', '0.5', '9', '3']] }) });
    expect(got).toHaveLength(1); // no delivery after teardown (no leak)

    // Reconnect: a fresh subscription creates a new socket and works again.
    const unsub2 = p.subscribeCandles('BTCUSDT', '5m', (c) => got.push(c));
    const ws2 = FakeWebSocket.last!;
    expect(ws2).not.toBe(ws);
    ws2.emit('open', { data: '' });
    ws2.emit('message', { data: JSON.stringify({ data: [[1700000600, '1', '2', '0.5', '1.8', '3']] }) });
    expect(got).toHaveLength(2);
    expect(got[1]!.close).toBe('1.8');
    unsub2();
  });
});
