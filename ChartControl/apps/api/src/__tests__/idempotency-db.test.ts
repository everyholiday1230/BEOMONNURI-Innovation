/* ============================================================
   주문 멱등성 저장소 — 중복 주문을 막는 마지막 우리 쪽 장치
   ------------------------------------------------------------
   ★★ 왜 중요한가

     실주문 경로는 프로세스 메모리 저장소를 쓰고 있었다. 그러면 멱등성이 그
     프로세스가 살아 있는 동안만 유지된다:
       · 배포·재시작 뒤 같은 키로 재시도가 오면 기록이 없어 **다시 실행**된다.
       · 인스턴스가 둘이면 서로의 기록을 못 봐서 재시도가 그대로 거래소로 간다.
     결과는 중복 포지션이다.

   여기서는 (a) 계약이 지켜지는지, (b) 조회 실패를 '기록 없음' 으로 위장하지
   않는지, (c) 동시 호출이 한 번만 실행되는지를 고정한다.
   ============================================================ */

import { describe, it, expect, vi } from 'vitest';

import { IdempotencyService, MemoryIdempotencyStore, type IdempotencyStore } from '../trading/idempotency';
import { PgIdempotencyStore } from '../db/idempotency-repo';

/** INSERT ... ON CONFLICT DO NOTHING 을 흉내내는 최소 가짜 Pool. */
function fakePool() {
  const rows = new Map<string, { user_id: string; scope: string; result: unknown }>();
  const calls: { sql: string; params: unknown[] }[] = [];
  const pool = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });
      if (/^\s*SELECT/i.test(sql)) {
        const hit = rows.get(String(params[0]));
        return { rows: hit ? [{ result: hit.result }] : [] };
      }
      if (/^\s*INSERT/i.test(sql)) {
        const key = String(params[0]);
        // PK 충돌 → DO NOTHING
        if (!rows.has(key)) {
          rows.set(key, { user_id: String(params[1]), scope: String(params[2]), result: JSON.parse(String(params[3])) });
        }
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  return { pool: pool as unknown as import('pg').Pool, rows, calls };
}

describe('IDEM-DB PgIdempotencyStore', () => {
  it('[1] 결과를 저장하고 같은 키로 다시 읽는다', async () => {
    const { pool } = fakePool();
    const store = new PgIdempotencyStore(pool);
    expect(await store.get('u1:k1')).toBeNull();
    await store.put('u1:k1', { transmitted: true, orderId: 'o1' }, { userId: 'u1', scope: 'trading.orders.submit' });
    expect(await store.get('u1:k1')).toEqual({ result: { transmitted: true, orderId: 'o1' } });
  });

  it('[2] ★★ 같은 키를 두 번 넣어도 첫 결과가 유지된다 (재시도가 결과를 덮지 않는다)', async () => {
    const { pool } = fakePool();
    const store = new PgIdempotencyStore(pool);
    await store.put('u1:k1', { attempt: 1 }, { userId: 'u1' });
    await store.put('u1:k1', { attempt: 2 }, { userId: 'u1' });
    // 재시도가 다른 결과를 보고하면 멱등성이 의미를 잃는다.
    expect(await store.get('u1:k1')).toEqual({ result: { attempt: 1 } });
  });

  it('[3] user_id 없이 저장하려 하면 던진다 (조용히 멱등성을 잃지 않는다)', async () => {
    const { pool } = fakePool();
    const store = new PgIdempotencyStore(pool);
    await expect(store.put('u1:k1', { a: 1 })).rejects.toThrow(/userId is required/);
  });

  it('[4] 사용자와 용도를 컬럼으로 남긴다 (키에서 파싱하지 않는다)', async () => {
    const { pool, rows } = fakePool();
    const store = new PgIdempotencyStore(pool);
    await store.put('u-abc:k9', { ok: true }, { userId: 'u-abc', scope: 'trading.orders.submit' });
    expect(rows.get('u-abc:k9')).toMatchObject({ user_id: 'u-abc', scope: 'trading.orders.submit' });
  });

  it('[5] ★★ 조회가 실패하면 던진다 — "기록 없음" 으로 위장하면 중복 주문이 된다', async () => {
    const store = new PgIdempotencyStore({
      async query() { throw new Error('connection reset'); },
    } as unknown as import('pg').Pool);
    await expect(store.get('u1:k1')).rejects.toThrow(/connection reset/);
  });
});

describe('IDEM-SVC IdempotencyService', () => {
  it('[6] ★★ 같은 키의 재시도는 한 번만 실행된다', async () => {
    const store = new MemoryIdempotencyStore();
    const svc = new IdempotencyService(store);
    const fn = vi.fn(async () => ({ orderId: 'o1' }));

    const first = await svc.run('u1:k1', fn, { userId: 'u1' });
    const second = await svc.run('u1:k1', fn, { userId: 'u1' });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    // 재시도는 **같은 결과**를 받아야 한다. 다른 결과면 사용자가 다시 주문한다.
    expect(second.result).toEqual(first.result);
  });

  it('[7] ★★ 동시 호출도 한 번만 실행된다 (경합에서 두 주문이 나가지 않는다)', async () => {
    const svc = new IdempotencyService(new MemoryIdempotencyStore());
    let running = 0;
    let maxConcurrent = 0;
    const fn = async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((r) => setTimeout(r, 20));
      running -= 1;
      return { orderId: 'o1' };
    };
    const [a, b, c] = await Promise.all([
      svc.run('u1:same', fn, { userId: 'u1' }),
      svc.run('u1:same', fn, { userId: 'u1' }),
      svc.run('u1:same', fn, { userId: 'u1' }),
    ]);
    expect(maxConcurrent).toBe(1);
    expect(a.result).toEqual(b.result);
    expect(b.result).toEqual(c.result);
  });

  it('[8] 저장소에 userId/scope 를 그대로 전달한다', async () => {
    const seen: { key: string; meta: unknown }[] = [];
    const store: IdempotencyStore = {
      async get() { return null; },
      async put(key, _result, meta) { seen.push({ key, meta }); },
    };
    await new IdempotencyService(store).run('u7:k7', async () => ({ ok: true }), { userId: 'u7', scope: 'trading.orders.submit' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.meta).toEqual({ userId: 'u7', scope: 'trading.orders.submit' });
  });

  it('[9] 다른 키는 각각 실행된다', async () => {
    const svc = new IdempotencyService(new MemoryIdempotencyStore());
    const fn = vi.fn(async () => ({ ok: true }));
    await svc.run('u1:k1', fn, { userId: 'u1' });
    await svc.run('u1:k2', fn, { userId: 'u1' });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
