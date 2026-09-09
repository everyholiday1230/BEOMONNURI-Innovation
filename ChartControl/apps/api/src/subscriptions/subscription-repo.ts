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
  /*
     ★ 'pending' 은 승인 대기다 — **접근권이 없다.** 목록에 넣는 이유는 화면이
       "결제를 마치지 않았습니다" 를 말할 수 있어야 하기 때문이다. 상태를 숨기면
       고객은 왜 안 되는지 알 수 없다.
  */
  status: 'pending' | 'active' | 'canceled' | 'expired';
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
      /*
         ★★★ **허용 목록**으로 판단한다. 예전에는 `status !== 'expired'` 였다.

           그 방식이면 새로 생긴 상태가 자동으로 **접근권을 얻는다.** 실제로
           'pending'(승인 대기)을 추가하면서 그 구멍이 열렸다 — 결제하지 않은
           사람이 유료 기능을 쓸 수 있게 된다. 지금은 기간(period_end)이 현재와
           같아서 우연히 막혔을 뿐, 규칙이 막은 것이 아니었다.

         ★ 'canceled' 는 포함한다 — 이미 낸 기간까지는 쓸 수 있어야 한다.
           'pending'·'expired' 는 제외한다.

         ★ 새 상태를 추가할 때 여기 넣지 않으면 **접근권이 없다.** 그것이 안전한
           기본값이다. 반대로 두면 실수 한 번에 무료로 열린다.
      */
      const PAID_STATUSES: ReadonlySet<string> = new Set(['active', 'canceled']);
      const entitled = code !== 'free' && PAID_STATUSES.has(status) && end > now;
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
   * 승인 대기 기록.
   *
   * ★★★ 이것이 없어서 **고객이 돈을 내고 아무것도 못 받을 수 있었다.**
   *
   *   checkout 이 만든 PayPal 구독 id 를 아무 데도 저장하지 않고 화면에만 돌려줬다.
   *   고객이 PayPal 에서 승인을 마친 뒤 브라우저를 닫으면, PayPal 쪽은 ACTIVE 이고
   *   요금이 청구되는데 우리에겐 기록도 단서도 없었다. 수동 복구조차 불가능했다.
   *
   * ★ 'pending' 은 **접근권을 주지 않는다.** entitled 는 'active' 와 기간으로만
   *   판단한다. 저장하는 목적은 나중에 PayPal 에 대조해 되찾기 위함이다.
   *
   * ★★ 이미 유효한 구독이 있으면 **건드리지 않는다.** 플랜을 바꾸려고 결제를
   *   시작했다가 중간에 그만둔 경우, 쓰고 있던 구독을 pending 으로 덮으면 멀쩡한
   *   접근권을 빼앗는다. 그래서 status='active' 인 행은 갱신 대상에서 뺀다.
   */
  async markPending(input: {
    userId: string;
    planCode: PlanCode;
    provider: string;
    providerRef: string;
  }): Promise<boolean> {
    try {
      await this.pool.query(
        `INSERT INTO subscriptions
           (user_id, plan_code, status, current_period_start, current_period_end,
            provider, provider_ref, pending_since, updated_at)
         VALUES ($1, $2, 'pending', now(), now(), $3, $4, now(), now())
         ON CONFLICT (user_id) DO UPDATE SET
           plan_code = EXCLUDED.plan_code,
           status = 'pending',
           provider = EXCLUDED.provider,
           provider_ref = EXCLUDED.provider_ref,
           pending_since = now(),
           updated_at = now()
         WHERE subscriptions.status <> 'active'`,
        [input.userId, input.planCode, input.provider, input.providerRef],
      );
      return true;
    } catch (e) {
      /*
         ★ 실패를 조용히 삼키지 않는다. 이 기록이 없으면 결제 후 복구가 불가능하다.
           결제 자체를 막을 이유는 아니므로 호출자는 계속 진행하지만, 로그는 남는다.
      */
      console.warn(`[subscription] 승인 대기 기록 실패 user=${input.userId} ref=${input.providerRef}: ${(e as Error).message}`);
      return false;
    }
  }

  /** PayPal 구독 id 로 소유자와 상태를 찾는다. 웹훅·대조 작업이 쓴다. */
  async findByProviderRef(providerRef: string): Promise<
    { userId: string; planCode: string; status: string } | null
  > {
    try {
      const r = await this.pool.query(
        `SELECT user_id, plan_code, status FROM subscriptions WHERE provider_ref = $1`,
        [providerRef],
      );
      if (!r.rowCount) return null;
      const x = r.rows[0]!;
      return { userId: String(x.user_id), planCode: String(x.plan_code), status: String(x.status) };
    } catch {
      return null;
    }
  }

  /**
   * 승인 대기 목록 — 대조 작업 대상.
   *
   * ★ `olderThanMs` 보다 오래된 것만 준다. 방금 만든 것을 건드리면 고객이 PayPal
   *   화면에서 결제하는 중에 상태가 바뀐다.
   */
  async listPending(olderThanMs: number, limit = 50): Promise<
    Array<{ userId: string; planCode: string; providerRef: string; pendingSince: number }>
  > {
    try {
      const r = await this.pool.query(
        `SELECT user_id, plan_code, provider_ref, pending_since
           FROM subscriptions
          WHERE status = 'pending'
            AND provider_ref IS NOT NULL
            AND pending_since < now() - ($1::bigint * interval '1 millisecond')
          ORDER BY pending_since ASC
          LIMIT $2`,
        [String(olderThanMs), limit],
      );
      return r.rows.map((x) => ({
        userId: String(x.user_id),
        planCode: String(x.plan_code),
        providerRef: String(x.provider_ref),
        pendingSince: ms(x.pending_since),
      }));
    } catch (e) {
      console.warn(`[subscription] 승인 대기 목록 조회 실패: ${(e as Error).message}`);
      return [];
    }
  }

  /**
   * 상태만 바꾼다(기간은 건드리지 않는다).
   *
   * ★ 'canceled' 는 기간이 남아 있으면 계속 쓸 수 있다는 뜻이다 — 그래서 기간을
   *   지우지 않는다. 'expired' 는 대조 결과 PayPal 쪽이 끝났다는 뜻이다.
   */
  async setStatus(userId: string, status: 'active' | 'canceled' | 'expired'): Promise<boolean> {
    try {
      const r = await this.pool.query(
        `UPDATE subscriptions SET status = $2, updated_at = now() WHERE user_id = $1`,
        [userId, status],
      );
      return (r.rowCount ?? 0) > 0;
    } catch {
      return false;
    }
  }

  /**
   * 웹훅 이벤트를 처음 받았는지 확인하고 기록한다.
   *
   * ★★ PayPal 은 같은 이벤트를 **여러 번 보낸다**(재시도). 멱등하지 않으면 포인트가
   *   두 번 지급되고 기간이 두 번 연장된다. INSERT 의 성공 여부로 판단하므로 경합에서도
   *   한 번만 통과한다 — 응용 코드의 "먼저 조회하고 없으면 넣기" 는 샌다.
   *
   * @returns true 면 처음 받은 것(처리해야 한다), false 면 이미 받은 것(무시).
   */
  async claimWebhookEvent(input: {
    eventId: string;
    provider: string;
    eventType: string;
    resourceId?: string | null;
  }): Promise<boolean> {
    try {
      const r = await this.pool.query(
        `INSERT INTO payment_webhook_events (event_id, provider, event_type, resource_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (event_id) DO NOTHING`,
        [input.eventId, input.provider, input.eventType, input.resourceId ?? null],
      );
      return (r.rowCount ?? 0) > 0;
    } catch (e) {
      /*
         ★ 기록할 수 없으면 **처리하지 않는다.** 중복 방지를 보장할 수 없는데 처리하면
           포인트를 두 번 줄 수 있다. PayPal 이 재시도하므로 다음 기회가 있다.
      */
      console.error(`[subscription] 웹훅 중복검사 실패 — 처리를 건너뛴다 event=${input.eventId}: ${(e as Error).message}`);
      return false;
    }
  }

  /** 웹훅 처리 결과를 남긴다. 실패한 것을 나중에 찾아 다시 처리할 수 있어야 한다. */
  async markWebhookHandled(eventId: string, note: string): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE payment_webhook_events SET handled = true, note = $2 WHERE event_id = $1`,
        [eventId, note.slice(0, 500)],
      );
    } catch (e) {
      console.warn(`[subscription] 웹훅 처리기록 실패 event=${eventId}: ${(e as Error).message}`);
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
