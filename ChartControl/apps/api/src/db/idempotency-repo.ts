import type { Pool } from 'pg';

import type { IdempotencyStore } from '../trading/idempotency';

/* ============================================================
   주문 멱등성 저장소 (PostgreSQL)
   ------------------------------------------------------------
   왜 DB 여야 하는가

   전에는 실주문 경로가 MemoryIdempotencyStore(프로세스 메모리)를 썼다. 그러면
   멱등성이 **그 프로세스가 살아 있는 동안만** 유지된다:

     · 배포·재시작 직후 같은 키로 재시도가 오면 기록이 없으므로 다시 실행된다.
     · 인스턴스가 둘 이상이면 서로의 기록을 못 본다 — 로드밸런서가 다른
       인스턴스로 보낸 재시도가 그대로 거래소로 나간다.

   그 결과가 **중복 주문**이다. 거래소의 clientOid 중복 검사가 마지막 방어선이지만,
   그때 우리는 REJECTED 를 받고 이용자에게 "실패" 라고 말한다. 이용자는 다시
   주문하고, 그게 진짜 두 번째 포지션이 된다.

   테이블은 이미 있었다(0003_phase3_trading: idempotency_records, PK=idempotency_key).
   PK 가 UNIQUE 이므로 동시 삽입은 DB 가 직렬화한다.

   ★ 실패 시 정책: get() 이 실패하면 **던진다.** 조회 실패를 "기록 없음" 으로
     처리하면 재시도가 그대로 실행돼 중복 주문이 된다 — 멱등성을 확인할 수 없으면
     주문을 내지 않는 쪽이 맞다.
   ============================================================ */
export class PgIdempotencyStore implements IdempotencyStore {
  constructor(private readonly pool: Pool) {}

  async get(key: string): Promise<{ result: unknown } | null> {
    const { rows } = await this.pool.query<{ result: unknown }>(
      'SELECT result FROM idempotency_records WHERE idempotency_key = $1',
      [key],
    );
    if (rows.length === 0) return null;
    // JSONB 는 pg 가 이미 객체로 준다. 문자열이면(구버전 행) 한 번 파싱한다.
    const raw = rows[0]!.result;
    if (typeof raw === 'string') {
      try {
        return { result: JSON.parse(raw) };
      } catch {
        return { result: raw };
      }
    }
    return { result: raw ?? null };
  }

  async put(key: string, result: unknown, meta?: { userId?: string; scope?: string }): Promise<void> {
    /*
       ★ user_id 는 NOT NULL + users(id) FK 다. 없으면 기록할 수 없다.

         이때 조용히 넘기면 멱등성이 사라진 채로 주문이 성공한다. 그래서 던진다 —
         호출자가 반드시 userId 를 주게 만든다.
    */
    if (!meta?.userId) {
      throw new Error('PgIdempotencyStore.put: userId is required (idempotency_records.user_id is NOT NULL)');
    }
    await this.pool.query(
      `INSERT INTO idempotency_records (idempotency_key, user_id, scope, result)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [key, meta.userId, meta.scope ?? 'trading', JSON.stringify(result ?? null)],
    );
  }
}
