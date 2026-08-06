import { describe, it, expect } from 'vitest';
import {
  CandleBuffer,
  TradeBuffer,
  normalizeBitmartKline,
  OrderBookState,
  TokenBucket,
  CircuitBreaker,
  backoffMs,
  retryAfterMs,
} from '../index';
import type { Candle, Trade } from '@quantumtrade/schemas';
import { _internal } from '../bitmart-public';

const mk = (time: number, close: string, closed = true): Candle => ({
  time,
  open: '100',
  high: '110',
  low: '90',
  close,
  volume: '10',
  closed,
});

describe('CandleBuffer merge rules', () => {
  it('appends newer timestamps and keeps ascending order', () => {
    const b = new CandleBuffer();
    expect(b.ingest(mk(3000, '101'))).toBe('appended');
    expect(b.ingest(mk(1000, '102'))).toBe('appended'); // older gap-fill still stored
    expect(b.ingest(mk(2000, '103'))).toBe('appended');
    expect(b.toArray().map((c) => c.time)).toEqual([1000, 2000, 3000]);
  });

  it('replaces a candle with the same timestamp (latest wins)', () => {
    const b = new CandleBuffer([mk(1000, '100')]);
    expect(b.ingest(mk(1000, '105'))).toBe('replaced');
    expect(b.toArray()[0]!.close).toBe('105');
    expect(b.size).toBe(1);
  });

  it('rejects invalid OHLC as invalid', () => {
    const bad = { ...mk(1000, '100'), high: '10', low: '99' };
    const b = new CandleBuffer();
    expect(b.ingest(bad as Candle)).toBe('invalid');
    expect(b.size).toBe(0);
  });

  it('bounds memory to max', () => {
    const b = new CandleBuffer([], 3);
    for (let i = 0; i < 10; i++) b.ingest(mk(i * 1000, '100'));
    expect(b.size).toBe(3);
    expect(b.toArray().map((c) => c.time)).toEqual([7000, 8000, 9000]);
  });
});

describe('TradeBuffer dedup + order', () => {
  const t = (id: string, ts: number): Trade => ({ id, price: '100', size: '1', side: 'buy', ts });
  it('dedups by id', () => {
    const b = new TradeBuffer();
    expect(b.ingest(t('a', 1))).toBe(true);
    expect(b.ingest(t('a', 1))).toBe(false);
    expect(b.size).toBe(1);
  });
  it('orders by timestamp and bounds size (keeps newest)', () => {
    const b = new TradeBuffer(2);
    b.ingest(t('a', 3));
    b.ingest(t('b', 1));
    b.ingest(t('c', 2));
    expect(b.toArray().map((x) => x.id)).toEqual(['c', 'a']); // oldest (b, ts1) trimmed
  });
});

describe('normalizeBitmartKline (isolated parsing)', () => {
  it('parses array-of-arrays rows [t,o,h,l,c,v] with seconds timestamp', () => {
    const raw = { code: 1000, data: [[1700000000, '100', '110', '95', '105', '12.5']] };
    const out = normalizeBitmartKline(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.time).toBe(1700000000000); // converted to ms
    expect(out[0]!.close).toBe('105');
  });
  it('parses object rows and dedups by time', () => {
    const raw = {
      data: [
        { timestamp: 1700000060, open: '1', high: '2', low: '0.5', close: '1.5', volume: '3' },
        { timestamp: 1700000060, open: '1', high: '2', low: '0.5', close: '1.9', volume: '3' },
      ],
    };
    const out = normalizeBitmartKline(raw);
    expect(out).toHaveLength(1);
    expect(out[0]!.close).toBe('1.9'); // last wins
  });
  it('drops malformed rows without throwing', () => {
    const raw = { data: [[/* too short */ 1700000000, '100']] };
    expect(normalizeBitmartKline(raw)).toHaveLength(0);
  });
});

describe('BitMart details shape + precision mapping (real API shape)', () => {
  it('extractRows reads { data: { symbols: [...] } } from /contract/public/details', () => {
    const raw = { code: 1000, data: { symbols: [{ symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' }] } };
    expect(_internal.extractRows(raw)).toHaveLength(2);
  });
  it('extractRows still reads kline { data: [...] } array form', () => {
    const raw = { code: 1000, data: [[1700000000, '1', '2', '0.5', '1.5', '3']] };
    expect(_internal.extractRows(raw)).toHaveLength(1);
  });
  it('decimalsOf derives precision from tick/step size strings', () => {
    expect(_internal.decimalsOf('0.1')).toBe(1);
    expect(_internal.decimalsOf('0.01')).toBe(2);
    expect(_internal.decimalsOf('1')).toBe(0);
    expect(_internal.decimalsOf('0.0010')).toBe(3);
  });
});

describe('OrderBookState sequence/gap', () => {
  const snap = { symbol: 'BTCUSDT', sequence: 100, bids: [['100', '1']] as [string, string][], asks: [['101', '1']] as [string, string][], asOf: 0, isSnapshot: true };

  it('applies in-order incremental updates', () => {
    const ob = new OrderBookState();
    ob.applySnapshot({ ...snap });
    const r = ob.applyIncremental({ symbol: 'BTCUSDT', sequence: 101, bids: [['100', '2']], asks: [], asOf: 0, isSnapshot: false });
    expect(r.status).toBe('applied');
    expect(ob.snapshot().bids[0]).toEqual(['100', '2']);
  });

  it('detects a forward gap and asks for resync', () => {
    const ob = new OrderBookState();
    ob.applySnapshot({ ...snap });
    const r = ob.applyIncremental({ symbol: 'BTCUSDT', sequence: 103, bids: [], asks: [], asOf: 0, isSnapshot: false });
    expect(r.status).toBe('gap');
  });

  it('ignores stale/old sequences', () => {
    const ob = new OrderBookState();
    ob.applySnapshot({ ...snap });
    const r = ob.applyIncremental({ symbol: 'BTCUSDT', sequence: 100, bids: [], asks: [], asOf: 0, isSnapshot: false });
    expect(r.status).toBe('stale');
  });

  it('removes zero-quantity levels and sorts book', () => {
    const ob = new OrderBookState();
    ob.applySnapshot({ symbol: 'X', sequence: 1, bids: [['99', '1'], ['100', '2']], asks: [['101', '1'], ['102', '0']], asOf: 0, isSnapshot: true });
    const s = ob.snapshot();
    expect(s.bids[0]).toEqual(['100', '2']); // highest bid first
    expect(s.asks.find((a) => a[0] === '102')).toBeUndefined(); // zero removed
    expect(ob.bestBid()).toBe('100');
    expect(ob.bestAsk()).toBe('101');
  });
});

describe('rate limiter', () => {
  it('token bucket empties then refills over time', () => {
    const bucket = new TokenBucket({ maxRps: 10, burst: 2, backoffBaseMs: 100, backoffMaxMs: 1000, jitterRatio: 0, circuitBreakerThreshold: 3, circuitBreakerResetMs: 1000 });
    const t0 = 1_000_000;
    expect(bucket.tryRemove(t0)).toBe(true);
    expect(bucket.tryRemove(t0)).toBe(true);
    expect(bucket.tryRemove(t0)).toBe(false); // empty
    expect(bucket.tryRemove(t0 + 200)).toBe(true); // refilled ~2 tokens after 200ms @10rps
  });

  it('backoff grows and is bounded', () => {
    const cfg = { maxRps: 1, burst: 1, backoffBaseMs: 100, backoffMaxMs: 800, jitterRatio: 0, circuitBreakerThreshold: 3, circuitBreakerResetMs: 1000 };
    expect(backoffMs(0, cfg)).toBe(100);
    expect(backoffMs(1, cfg)).toBe(200);
    expect(backoffMs(10, cfg)).toBe(800); // capped
  });

  it('parses Retry-After seconds and ms', () => {
    expect(retryAfterMs('2')).toBe(2000);
    expect(retryAfterMs('1500')).toBe(1500);
    expect(retryAfterMs(null)).toBeUndefined();
  });

  it('circuit breaker opens after threshold and resets after cooldown', () => {
    const cfg = { maxRps: 1, burst: 1, backoffBaseMs: 100, backoffMaxMs: 800, jitterRatio: 0, circuitBreakerThreshold: 2, circuitBreakerResetMs: 500 };
    const cb = new CircuitBreaker(cfg);
    const t0 = 2_000_000;
    expect(cb.canRequest(t0)).toBe(true);
    cb.onFailure(t0);
    cb.onFailure(t0);
    expect(cb.state).toBe('open');
    expect(cb.canRequest(t0 + 100)).toBe(false);
    expect(cb.canRequest(t0 + 600)).toBe(true); // half-open after cooldown
  });
});
