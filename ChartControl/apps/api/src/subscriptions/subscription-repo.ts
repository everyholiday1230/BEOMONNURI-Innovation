import type { Pool } from 'pg';

import { DEFAULT_PLAN, PLAN_BY_CODE, isPlanCode, type PlanCode } from './plans';

/*
   구독 저장소.

   ★★ 이 파일이 지키는 규칙 두 개

     1. **모르는 것을 유료로 읽지 않는다.** 행이 없거나 플랜 코드가 낯설거나 조회가
        실패하면 무료로 떨어뜨린다. 반대로 하면 돈을 받지 않고 원가를 쓴다.

     2. **충전은 멱등이다.** 갱신 처리가 두 번 돌면 포인트가 두 배 들어간다.
        last_grant_period 로 같은 주기에 두 번 충전하지 않는다.
*/

export interface SubscriptionRow {
  planCode: PlanCode;
  status: 'active' | 'canceled' | 'expired';
  currentPeriodStart: number;
  currentPeriodEnd: number;
  provider: string | null;
  /** 지금 유료 기능을 쓸 수 있는가. canceled 라도 기간이 남았으면 true. */
  entitled: boolean;
}

/** 조회 결과. 실패를 '무료'와 구별해 돌려준다. */
export type SubscriptionRead =
  | { ok: true; row: SubscriptionRow }
  | { ok: false; reason: string; row: SubscriptionRow };

const freeRow = (): SubscriptionRow => ({
  planCode: DEFAULT_PLAN,
  status: 'expired',
  currentPeriodStart: 0,
  currentPeriodEnd: 0,
  provider: null,
  entitled: false,
});

const ms = (v: unknown): number => (v instanceof Date ? v.getTime() : 0);

export class PgSubscriptionRepo {
  constructor(private readonly pool: Pool) {}

  /**
   * 현재 구독. 없으면 무료.
   *
   * ★ 실패도 무료로 돌려주지만 ok:false 를 붙인다 — 호출자가 "무료 고객" 과
   *   "읽지 못했다" 를 구별할 수 있어야 한다. 화면이 그 차이를 말해야 한다.
   */
  async get(userId: string, now = Date.now()): Promise<SubscriptionRead> {
    try {
      const r = await this.pool.query(
        `SELECT plan_code, status, current_period_start, current_period_end, provider
           FROM subscriptions WHERE user_id = $1`,
        [userId],
      );
      if (!r.rowCount) return { ok: true, row: freeRow() };
      const x = r.rows[0]!;
      const code = isPlanCode(x.plan_code) ? x.plan_code : DEFAULT_PLAN;
      const end = ms(x.current_period_end);
      const status = String(x.status) as SubscriptionRow['status'];
      /*
         ★ 유료 여부는 상태가 아니라 **기간**으로 정한다. 해지했어도 이미 낸 달은
           끝까지 쓸 수 있어야 한다 — 즉시 끊으면 돈을 받고 서비스를 멈추는 것이다.
      */
      const entitled = code !== 'free' && status !== 'expired' && end > now;
      return {
        ok: true,
        row: {
          planCode: code,
          status,
          currentPeriodStart: ms(x.current_period_start),
          currentPeriodEnd: end,
          provider: x.provider === null ? null : String(x.provider),
          entitled,
        },
      };
    } catch (e) {
      /* ★ 실패를 유료로 읽지 않는다. */
      return { ok: false, reason: (e as Error).message, row: freeRow() };
    }
  }

  /**
   * 구독을 시작하거나 플랜을 바꾼다.
   *
   * ★ 한 사람에 한 행이므로 UPSERT 다. 이전 플랜 이력은 point_ledger 의 충전 기록과
   *   결제 주문에 남는다.
   * ★ 기간을 여기서 계산하지 않고 받는다 — 결제 대행사가 알려주는 주기와 어긋나면
   *   고객은 결제됐는데 만료된 것으로 보인다.
   */
  async upsert(input: {
    userId: string;
    planCode: PlanCode;
    periodStart: number;
    periodEnd: number;
    provider?: string | null;
    providerRef?: string | null;
  }): Promise<boolean> {
    try {
      await this.pool.query(
        `INSERT INTO subscriptions
           (user_id, plan_code, status, current_period_start, current_period_end, provider, provider_ref, updated_at)
         VALUES ($1, $2, 'active', to_timestamp($3 / 1000.0), to_timestamp($4 / 1000.0), $5, $6, now())
         ON CONFLICT (user_id) DO UPDATE SET
           plan_code = EXCLUDED.plan_code,
           status = 'active',
           current_period_start = EXCLUDED.current_period_start,
           current_period_end = EXCLUDED.current_period_end,
           provider = EXCLUDED.provider,
           provider_ref = EXCLUDED.provider_ref,
           updated_at = now()`,
        [input.userId, input.planCode, input.periodStart, input.periodEnd,
          input.provider ?? null, input.providerRef ?? null],
      );
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 해지 요청. **즉시 끊지 않는다** — 기간 끝까지 유효하다.
   *
   * ★ 결제 대행사 쪽 정기결제도 함께 멈춰야 한다. 이 함수는 우리 기록만 바꾼다 —
   *   호출자가 그 사실을 알고 있어야 하고, 화면도 그렇게 말해야 한다.
   */
  async cancel(userId: string): Promise<boolean> {
    try {
      const r = await this.pool.query(
        `UPDATE subscriptions SET status = 'canceled', updated_at = now()
          WHERE user_id = $1 AND status = 'active'`,
        [userId],
      );
      return (r.rowCount ?? 0) > 0;
    } catch {
      return false;
    }
  }

  /**
   * 이 주기의 포인트를 아직 충전하지 않았는지 표시하고 예약한다.
   *
   * ★★ 멱등의 핵심. 먼저 표시를 선점하고(조건부 UPDATE), 성공한 호출만 충전한다.
   *   두 번째 호출은 rowCount 0 을 받아 충전하지 않는다. 순서를 뒤집으면(충전 후 표시)
   *   중간에 죽었을 때 두 번 충전된다.
   *
   * @returns 충전해야 할 포인트. 0 이면 이미 충전됐거나 대상이 아니다.
   */
  async claimMonthlyGrant(userId: string): Promise<number> {
    try {
      const r = await this.pool.query(
        `UPDATE subscriptions
            SET last_grant_period = current_period_start, updated_at = now()
          WHERE user_id = $1
            AND status IN ('active', 'canceled')
            AND current_period_end > now()
            AND (last_grant_period IS NULL OR last_grant_period <> current_period_start)
          RETURNING plan_code`,
        [userId],
      );
      if (!r.rowCount) return 0;
      const code = r.rows[0]!.plan_code;
      if (!isPlanCode(code)) return 0;
      return PLAN_BY_CODE[code].monthlyPoints;
    } catch {
      return 0;
    }
  }
}
