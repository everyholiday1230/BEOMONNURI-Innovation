import { describe, it, expect } from 'vitest';
import {
  backoffDelay, DEFAULT_BACKOFF, CircuitBreaker,
  SequenceTracker,
  SubscriptionManager, subKey, type UpstreamController,
  RequestCoalescer, CandleCache,
  OrderBook,
  BoundedQueue, Fanout, TokenBucket, PerUserRateLimiter,
} from '../index';

describe('backoff + circuit breaker', () => {
  it('full-jitter backoff stays within the capped bound and grows', () => {
    const rng = () => 1; // max jitter
    expect(backoffDelay(0, DEFAULT_BACKOFF, rng)).toBe(DEFAULT_BACKOFF.baseMs);
    expect(backoffDelay(1, DEFAULT_BACKOFF, rng)).toBe(1000);
    expect(backoffDelay(100, DEFAULT_BACKOFF, rng)).toBe(DEFAULT_BACKOFF.maxMs); // capped
    expect(backoffDelay(3, DEFAULT_BACKOFF, () => 0)).toBe(0); // min jitter
  });
  it('opens after threshold, blocks, then half-opens after cooldown', () => {
    let now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 }, () => now);
    cb.onFailure(); cb.onFailure(); expect(cb.current).toBe('closed');
    cb.onFailure(); expect(cb.current).toBe('open');
    expect(cb.canRequest()).toBe(false);
    now = 1000;
    expect(cb.canRequest()).toBe(true); // half_open trial
    cb.onSuccess(); expect(cb.current).toBe('closed');
  });
});

describe('sequence tracker', () => {
  it('classifies ok / duplicate / out-of-order / gap', () => {
    const s = new SequenceTracker();
    expect(s.accept(10)).toEqual({ kind: 'ok', seq: 10 });
    expect(s.accept(11)).toEqual({ kind: 'ok', seq: 11 });
    expect(s.accept(11)).toEqual({ kind: 'duplicate', seq: 11 });
    expect(s.accept(9)).toEqual({ kind: 'out_of_order', seq: 9, expected: 12 });
    expect(s.accept(15)).toEqual({ kind: 'gap', from: 12, to: 14 });
    expect(s.accept(16)).toEqual({ kind: 'ok', seq: 16 });
  });
  it('detects stale feeds', () => {
    let now = 0;
    const s = new SequenceTracker(1000, () => now);
    s.accept(1);
    now = 500; expect(s.isStale()).toBe(false);
    now = 2000; expect(s.isStale()).toBe(true);
  });
});

describe('subscription manager (upstream dedup + refcount)', () => {
  it('opens ONE upstream for many consumers of the same symbol/channel', async () => {
    const opened: string[] = []; const closed: string[] = [];
    const upstream: UpstreamController = { open: (k) => { opened.push(k); }, close: (k) => { closed.push(k); } };
    const mgr = new SubscriptionManager(upstream);
    expect(await mgr.subscribe('u1', 'BTCUSDT', 'trade')).toBe(true); // opened upstream
    expect(await mgr.subscribe('u2', 'BTCUSDT', 'trade')).toBe(false); // shared, no new upstream
    expect(await mgr.subscribe('u3', 'BTCUSDT', 'trade')).toBe(false);
    expect(mgr.refCount('BTCUSDT', 'trade')).toBe(3);
    expect(mgr.upstreamCount()).toBe(1);
    expect(opened).toEqual([subKey('BTCUSDT', 'trade')]);
    // last unsubscribe cleans up upstream
    await mgr.unsubscribe('u1', 'BTCUSDT', 'trade');
    await mgr.unsubscribe('u2', 'BTCUSDT', 'trade');
    expect(await mgr.unsubscribe('u3', 'BTCUSDT', 'trade')).toBe(true); // closed upstream
    expect(closed).toEqual([subKey('BTCUSDT', 'trade')]);
    expect(mgr.upstreamCount()).toBe(0);
  });
  it('dropConsumer closes only now-empty upstreams', async () => {
    const closed: string[] = [];
    const mgr = new SubscriptionManager({ open() {}, close: (k) => { closed.push(k); } });
    await mgr.subscribe('u1', 'BTCUSDT', 'trade');
    await mgr.subscribe('u1', 'ETHUSDT', 'trade');
    await mgr.subscribe('u2', 'BTCUSDT', 'trade'); // shared BTC
    const c = await mgr.dropConsumer('u1');
    expect(c).toEqual([subKey('ETHUSDT', 'trade')]); // only ETH became empty
    expect(mgr.refCount('BTCUSDT', 'trade')).toBe(1);
  });
});

describe('REST coalescing + candle cache', () => {
  it('coalesces concurrent identical requests into one', async () => {
    const c = new RequestCoalescer<number>();
    let calls = 0;
    const fn = async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return 42; };
    const [a, b, d] = await Promise.all([c.do('k', fn), c.do('k', fn), c.do('k', fn)]);
    expect([a, b, d]).toEqual([42, 42, 42]);
    expect(calls).toBe(1);
    expect(c.coalescedCount).toBe(2);
  });
  it('candle cache upserts, bounds size, and finds gaps', () => {
    const cache = new CandleCache(3);
    const mk = (t: number) => ({ openTime: t, open: 1, high: 2, low: 0, close: 1, volume: 1 });
    cache.upsert('BTCUSDT', '1m', mk(0));
    cache.upsert('BTCUSDT', '1m', mk(60_000));
    cache.upsert('BTCUSDT', '1m', mk(180_000)); // gap at 120000
    expect(cache.missingRanges('BTCUSDT', '1m', 60_000)).toEqual([{ from: 120_000, to: 120_000 }]);
    cache.upsert('BTCUSDT', '1m', mk(240_000)); // exceeds max 3 → oldest evicted
    expect(cache.size('BTCUSDT', '1m')).toBe(3);
  });
});

describe('order book snapshot + delta', () => {
  it('applies snapshot then sequenced deltas; flags resync on gap', () => {
    const ob = new OrderBook();
    ob.applySnapshot({ seq: 100, bids: [{ price: '10', size: '1' }], asks: [{ price: '11', size: '2' }] });
    expect(ob.best()).toEqual({ bid: 10, ask: 11 });
    expect(ob.applyDelta({ prevSeq: 100, seq: 101, bids: [{ price: '10', size: '0' }, { price: '9', size: '5' }], asks: [] }))
      .toEqual({ kind: 'applied', seq: 101 });
    expect(ob.best().bid).toBe(9); // 10 removed (size 0), 9 added
    expect(ob.applyDelta({ prevSeq: 101, seq: 101, bids: [], asks: [] })).toEqual({ kind: 'duplicate' });
    expect(ob.applyDelta({ prevSeq: 105, seq: 106, bids: [], asks: [] })).toEqual({ kind: 'resync_required', expected: 101, got: 105 });
  });
});

describe('backpressure + slow-consumer isolation + rate limit', () => {
  it('bounded queue drops oldest and counts drops', () => {
    const q = new BoundedQueue<number>(2);
    expect(q.push(1)).toBe(true);
    expect(q.push(2)).toBe(true);
    expect(q.push(3)).toBe(false); // full → drop oldest(1)
    expect(q.droppedCount).toBe(1);
    expect(q.drain()).toEqual([2, 3]);
  });
  it('a slow consumer is isolated (only its own drops)', () => {
    const f = new Fanout<number>(2);
    f.add('fast'); f.add('slow');
    // fast drains after every publish (keeps up); slow never drains.
    for (let i = 0; i < 10; i++) { f.publish(i); f.queueFor('fast')!.drain(); }
    expect(f.queueFor('slow')!.droppedCount).toBeGreaterThan(0);
    expect(f.queueFor('fast')!.droppedCount).toBe(0);
  });
  it('per-user token bucket limits and refills', () => {
    let now = 0;
    const rl = new PerUserRateLimiter(2, 1, () => now);
    expect(rl.allow('u')).toBe(true);
    expect(rl.allow('u')).toBe(true);
    expect(rl.allow('u')).toBe(false); // empty
    expect(rl.allow('other')).toBe(true); // per-user isolation
    now = 1000; // +1 token
    expect(rl.allow('u')).toBe(true);
  });
  it('token bucket caps at capacity', () => {
    let now = 0;
    const b = new TokenBucket(3, 10, () => now);
    now = 100000;
    expect(b.available).toBeLessThanOrEqual(3);
    b.tryRemove(1);
  });
});
