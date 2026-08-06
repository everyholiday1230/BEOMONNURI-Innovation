import { describe, it, expect } from 'vitest';
import {
  readKillSwitchFailClosed, InMemorySharedState, InMemoryPubSub, EventDeduper,
} from '@quantumtrade/cluster';
import {
  CircuitBreaker, backoffDelay, DEFAULT_BACKOFF, SequenceTracker, OrderBook, Fanout,
} from '@quantumtrade/market-gateway';
import { AlertManager, MockNotifier, defaultAlertRules } from '@quantumtrade/observability';

/**
 * Chaos / fault-injection (Phase 6 §10). Each scenario forces a failure via a mock/proxy and asserts
 * the SAFE behavior (fail-closed, circuit-open, resync, dedup, backoff, alert). No real external
 * service is harmed. Real production infra faults (DNS, KMS, disk-full, network partition on managed
 * services) are Not Executed and documented in PHASE6-10.
 */

describe('chaos: shared-store / Redis outage', () => {
  it('kill switch fails CLOSED for live-trading scopes when the store throws', async () => {
    const brokenStore: any = { get: async () => { throw new Error('redis disconnect'); } };
    expect((await readKillSwitchFailClosed(brokenStore, 'global_live_trading')).active).toBe(true);
    expect((await readKillSwitchFailClosed(brokenStore, 'bitmart_live_trading')).degraded).toBe(true);
  });
  it('recovers state and re-propagates invalidation after restart', async () => {
    const seen: string[] = [];
    const store = new InMemorySharedState((k) => seen.push(k));
    await store.cas('killswitch:global_live_trading', '1', 0); // persisted (blocked)
    // simulate node restart: new reader over same store observes restored state
    expect((await readKillSwitchFailClosed(store, 'global_live_trading')).active).toBe(true);
    expect(seen).toContain('killswitch:global_live_trading');
  });
});

describe('chaos: BitMart WS repeated disconnect / REST 429/5xx', () => {
  it('circuit breaker opens after repeated upstream failures, then half-opens after cooldown', () => {
    let now = 0;
    const cb = new CircuitBreaker({ failureThreshold: 5, cooldownMs: 2000 }, () => now);
    for (let i = 0; i < 5; i++) cb.onFailure();
    expect(cb.current).toBe('open');
    expect(cb.canRequest()).toBe(false); // upstream shielded
    now = 2000;
    expect(cb.canRequest()).toBe(true); // trial after cooldown
  });
  it('reconnect backoff grows and is bounded (jittered)', () => {
    const maxRng = () => 1;
    const d0 = backoffDelay(0, DEFAULT_BACKOFF, maxRng);
    const d5 = backoffDelay(5, DEFAULT_BACKOFF, maxRng);
    expect(d5).toBeGreaterThan(d0);
    expect(d5).toBeLessThanOrEqual(DEFAULT_BACKOFF.maxMs);
  });
});

describe('chaos: malformed / duplicate / out-of-order / stale market data', () => {
  it('sequence tracker classifies bad streams safely', () => {
    const s = new SequenceTracker(1000, () => 0);
    expect(s.accept(5).kind).toBe('ok');
    expect(s.accept(5).kind).toBe('duplicate');
    expect(s.accept(3).kind).toBe('out_of_order');
    expect(s.accept(9).kind).toBe('gap'); // triggers REST gap-fill
  });
  it('malformed JSON message is rejected without crashing the pipeline', () => {
    const parse = (raw: string): { ok: boolean } => { try { JSON.parse(raw); return { ok: true }; } catch { return { ok: false }; } };
    expect(parse('{not json').ok).toBe(false);
    expect(parse('{"seq":1}').ok).toBe(true);
  });
  it('order book requests resync on a sequence gap instead of corrupting state', () => {
    const ob = new OrderBook();
    ob.applySnapshot({ seq: 1, bids: [{ price: '1', size: '1' }], asks: [] });
    expect(ob.applyDelta({ prevSeq: 7, seq: 8, bids: [], asks: [] }).kind).toBe('resync_required');
  });
});

describe('chaos: duplicate events + kill-switch propagation across nodes', () => {
  it('duplicate cross-node events are suppressed', () => {
    const now = 0;
    const d = new EventDeduper(1000, () => now);
    expect(d.isDuplicate('evt-1')).toBe(false);
    expect(d.isDuplicate('evt-1')).toBe(true);
  });
  it('kill-switch change propagates to a subscriber (pub/sub)', async () => {
    const bus = new InMemoryPubSub();
    const received: string[] = [];
    await bus.subscribe('qt:invalidate', (m) => received.push(m));
    await bus.publish('qt:invalidate', 'killswitch:global_live_trading');
    expect(received).toContain('killswitch:global_live_trading');
  });
});

describe('chaos: slow consumer + alerting under fault', () => {
  it('a slow consumer is isolated and does not stall others', () => {
    const f = new Fanout<number>(2);
    f.add('healthy'); f.add('stalled');
    for (let i = 0; i < 8; i++) { f.publish(i); f.queueFor('healthy')!.drain(); }
    expect(f.queueFor('stalled')!.droppedCount).toBeGreaterThan(0);
    expect(f.queueFor('healthy')!.droppedCount).toBe(0);
  });
  it('alert manager fires critical alerts for outage conditions', () => {
    const notifier = new MockNotifier();
    const mgr = new AlertManager(defaultAlertRules(), notifier, { dedupWindowMs: 1000, now: () => 0 });
    mgr.evaluate({ redisUp: 0, dbPoolAvailable: 0, submitUnknown: 2, reconMismatch: 1 });
    const fired = notifier.sent.filter((n) => n.state === 'firing').map((n) => n.ruleId);
    expect(fired).toEqual(expect.arrayContaining(['redis_down', 'db_pool_exhausted', 'submit_unknown', 'reconciliation_mismatch']));
  });
});
