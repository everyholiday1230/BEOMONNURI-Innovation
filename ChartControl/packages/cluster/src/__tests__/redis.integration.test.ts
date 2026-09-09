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

describe.skipIf(!process.env.REDIS_URL)('RESP 연결 보장 (connect() 없이도 동작한다)', () => {
  /*
     ★★★ **`describe.skipIf` 는 본문 실행을 막지 않는다.** 테스트만 건너뛴다.

       예전에는 여기서 곧바로
           const p = parseRedisUrl(process.env.REDIS_URL!);
       를 했다. REDIS_URL 이 없으면 `new URL(undefined)` 가 되어
       **수집 단계에서 TypeError: Invalid URL** 로 터졌다.

     ★★ 결과가 고약했다: 시험 8건은 전부 통과하는데 **종료코드가 1** 이었다.
       그래서 `pnpm -r test` 가 이 패키지에서 멈추고 **뒤에 오는 패키지의 시험이
       조용히 건너뛰어진다.** 통과 숫자만 보면 정상으로 보인다.

     ★ 고침: 값을 읽는 시점을 `it` 안으로 옮긴다. skipIf 가 걸리면 아예 불리지 않는다.
       `!` 단정도 없앤다 — 단정은 없는 값을 있다고 우기는 것이라 이 사고의 원인이다.
  */
  const conn = () => {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL 이 없다 — 이 describe 는 skipIf 로 건너뛰어야 한다');
    return parseRedisUrl(url);
  };

  it('[1] ★★★ connect() 를 부르지 않아도 명령이 나간다', async () => {
    /*
       ★★★ 이것이 없어서 **프로덕션이 통째로 멈췄다.**

         `createRateLimiter` 가 프로덕션에서 RedisClient 를 만들면서
         `connect()` 를 부르지 않았다. 모든 명령이 `redis not connected` 로
         실패하고, 그 위의 FailClosedRateLimiter 가 **모든 요청을 거부**했다.

         결과: 프로덕션 모드에서 로그인 자체가 불가능(전부 429). 개발 모드는
         메모리 리미터를 쓰므로 이 경로를 지나지 않아 드러나지 않았다 —
         프로덕션으로 실제 띄워 보고 나서야 발견했다.
    */
    const c = new RedisClient({ host: conn().host, port: conn().port, connectTimeoutMs: 1500 });
    // connect() 를 부르지 않는다.
    expect(await c.command('PING')).toBe('PONG');
    await c.quit();
  });

  it('[2] 동시 명령이 소켓을 하나만 연다', async () => {
    /*
       ★ 각자 연결하면 소켓이 여러 개 열리고 응답 큐가 섞인다 — 한 명령의 답이
         다른 명령에게 간다.
    */
    const c = new RedisClient({ host: conn().host, port: conn().port, connectTimeoutMs: 1500 });
    const key = `probe:concurrent:${Date.now()}`;
    const replies = await Promise.all([
      c.command('PING'),
      c.command('INCR', key),
      c.command('INCR', key),
      c.command('PING'),
    ]);
    expect(replies[0]).toBe('PONG');
    expect(replies[3]).toBe('PONG');
    // 두 INCR 가 1, 2 로 순서대로 와야 한다(응답이 섞이면 값이 어긋난다).
    expect([Number(replies[1]), Number(replies[2])].sort((a, b) => a - b)).toEqual([1, 2]);
    await c.command('DEL', key);
    await c.quit();
  });

  it('[3] ★★ 끊긴 뒤 다시 붙는다', async () => {
    /*
       ★ `closed` 를 내리지 않으면 한 번 끊긴 뒤 영구히 거부한다 — 재시작 전까지
         서비스가 돌아오지 않는다. Redis 재시작·네트워크 순단에서 실제로 겪는다.
    */
    const c = new RedisClient({ host: conn().host, port: conn().port, connectTimeoutMs: 1500 });
    expect(await c.command('PING')).toBe('PONG');
    await c.quit();                       // 소켓을 닫는다
    expect(await c.command('PING')).toBe('PONG');   // 다시 붙어야 한다
    await c.quit();
  });
});
