import { describe, it, expect } from 'vitest';
import {
  InMemorySharedState, readKillSwitchFailClosed, LIVE_TRADING_SCOPES,
  InMemoryPubSub, EventDeduper,
} from '../index';

describe('shared state (in-memory) — versioned CAS', () => {
  it('creates with expected version 0 and increments', async () => {
    const s = new InMemorySharedState();
    expect(await s.cas('k', 'a', 0)).toBe(true);
    expect(await s.get('k')).toEqual({ value: 'a', version: 1 });
  });
  it('rejects a stale-version write (optimistic conflict)', async () => {
    const s = new InMemorySharedState();
    await s.cas('k', 'a', 0); // version → 1
    expect(await s.cas('k', 'b', 0)).toBe(false); // stale
    expect(await s.cas('k', 'b', 1)).toBe(true); // correct
    expect((await s.get('k'))!.version).toBe(2);
  });
  it('fires invalidation callbacks (cache invalidation hook)', async () => {
    const seen: string[] = [];
    const s = new InMemorySharedState((k) => seen.push(k));
    await s.cas('flag:x', '1', 0);
    await s.publishInvalidation('flag:x');
    expect(seen).toEqual(['flag:x', 'flag:x']);
  });
});

describe('fail-closed kill switch', () => {
  it('unset live scope defaults to BLOCKED, non-live defaults open', async () => {
    const s = new InMemorySharedState();
    expect(await readKillSwitchFailClosed(s, 'global_live_trading')).toEqual({ active: true, degraded: false });
    expect(await readKillSwitchFailClosed(s, 'ai_provider')).toEqual({ active: false, degraded: false });
  });
  it('reads explicit values', async () => {
    const s = new InMemorySharedState();
    await s.cas('killswitch:ai_provider', '1', 0);
    expect((await readKillSwitchFailClosed(s, 'ai_provider')).active).toBe(true);
  });
  it('fails closed for live scopes when the store throws (Redis outage)', async () => {
    const broken: any = { get: async () => { throw new Error('redis down'); } };
    const live = await readKillSwitchFailClosed(broken, 'bitmart_live_trading');
    expect(live).toEqual({ active: true, degraded: true });
    const nonLive = await readKillSwitchFailClosed(broken, 'ai_signal_generation');
    expect(nonLive).toEqual({ active: false, degraded: true });
    expect(LIVE_TRADING_SCOPES.has('bitmart_live_trading')).toBe(true);
  });
});

describe('in-memory pub/sub + dedup', () => {
  it('delivers messages to subscribers', async () => {
    const bus = new InMemoryPubSub();
    const got: string[] = [];
    await bus.subscribe('chan', (m) => got.push(m));
    await bus.publish('chan', 'hello');
    expect(got).toEqual(['hello']);
  });
  it('deduplicates events within the ttl window', () => {
    let now = 0;
    const d = new EventDeduper(1000, () => now);
    expect(d.isDuplicate('e1')).toBe(false);
    expect(d.isDuplicate('e1')).toBe(true);
    now = 2000;
    expect(d.isDuplicate('e1')).toBe(false); // expired
  });
});
