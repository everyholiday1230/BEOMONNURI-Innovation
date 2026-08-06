import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RedisClient, RedisSharedState, RedisPubSub, parseRedisUrl } from '../index';

/**
 * REAL Redis integration (Phase 6 §4). Connects to REDIS_URL (default redis://127.0.0.1:16379) and
 * proves cross-node versioned CAS + pub/sub cache-invalidation propagation, and measures propagation
 * latency. Self-skips (recorded Not Executed) when Redis is unreachable.
 */
const URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:16379';
const { host, port } = parseRedisUrl(URL);
let reachable = false;
let nodeA: RedisClient;
let nodeB: RedisClient;

beforeAll(async () => {
  try {
    nodeA = new RedisClient({ host, port, connectTimeoutMs: 1500 });
    await nodeA.connect();
    await nodeA.command('PING');
    nodeB = new RedisClient({ host, port, connectTimeoutMs: 1500 });
    await nodeB.connect();
    reachable = true;
  } catch {
    reachable = false;
  }
});

afterAll(async () => {
  try { await nodeA?.quit(); } catch { /* ignore */ }
  try { await nodeB?.quit(); } catch { /* ignore */ }
});

describe('Redis shared state (real)', () => {
  it('versioned CAS is visible across two node connections', async (ctx) => {
    if (!reachable) return ctx.skip();
    const key = `qt:test:cas:${Date.now()}`;
    const a = new RedisSharedState(nodeA);
    const b = new RedisSharedState(nodeB);
    await nodeA.command('DEL', key);
    expect(await a.cas(key, 'v1', 0)).toBe(true); // create
    const fromB = await b.get(key);
    expect(fromB).toEqual({ value: 'v1', version: 1 }); // node B sees node A's write
    expect(await b.cas(key, 'stale', 0)).toBe(false); // stale version rejected
    expect(await b.cas(key, 'v2', 1)).toBe(true); // correct version
    expect((await a.get(key))!.version).toBe(2);
    await nodeA.command('DEL', key);
  });

  it('pub/sub invalidation propagates across nodes with measured latency', async (ctx) => {
    if (!reachable) return ctx.skip();
    const channel = `qt:test:invalidate:${Date.now()}`;
    const pub = new RedisPubSub({ host, port });
    const sub = new RedisPubSub({ host, port });
    try {
      const received: { msg: string; at: number }[] = [];
      await sub.subscribe(channel, (m) => received.push({ msg: m, at: Date.now() }));
      await new Promise((r) => setTimeout(r, 100)); // let SUBSCRIBE settle
      const sentAt = Date.now();
      await pub.publish(channel, 'flag:ai_enabled');
      await new Promise((r) => setTimeout(r, 200));
      expect(received.length).toBeGreaterThanOrEqual(1);
      expect(received[0]!.msg).toBe('flag:ai_enabled');
      const latency = received[0]!.at - sentAt;
      console.log(`[phase6] redis pub/sub propagation latency ≈ ${latency}ms`);
      expect(latency).toBeLessThan(1000);
    } finally {
      await pub.close();
      await sub.close();
    }
  });
});
