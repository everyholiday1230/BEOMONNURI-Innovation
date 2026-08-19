import type { Pool } from 'pg';
import type { TierDefinition, TierMetrics } from '../tiers/tier-engine';

/**
 * 고객 등급 저장소.
 *
 * ★★ 지표를 어디서 세는가 — `trade_outcomes`
 *
 *   체결된 결과만 여기에 들어오고, `execution_mode` 로 실거래와 모의가 구분된다.
 *   주문(`trade_decisions`)을 세면 **접수만 하고 체결되지 않은 주문**까지 세게
 *   되고, 그러면 지정가 주문을 잔뜩 걸어 두고 취소하는 것으로 등급을 만들 수 있다.
 *
 * ★★ 모의는 절대 세지 않는다 (`execution_mode = 'live'`).
 *   모의 주문은 우리 서버가 즉시 체결시킨다. 등급에 넣으면 버튼 몇 번으로
 *   최고 등급이 되고, 그 등급에 혜택이 붙으면 그대로 손실이다.
 *
 * ★ 거래 금액은 `filled_quantity × entry_price` 다.
 *   둘 중 하나라도 없는 행은 금액을 **모르는 것**이므로 합계에서 제외하고,
 *   제외한 개수를 함께 돌려준다 — 합계가 실제보다 작다는 사실을 숨기지 않는다.
 */
export class PgTierRepo {
  constructor(private readonly pool: Pool) {}

  /** 활성 등급 정의. rank 오름차순. */
  async definitions(): Promise<TierDefinition[]> {
    const r = await this.pool.query(
      `SELECT code, name_key, rank, min_volume_30d, min_trades_30d,
              min_active_days_30d, requires_referral, benefit_key, rebate_share_bps
         FROM tier_definitions
        WHERE active
        ORDER BY rank ASC`,
    );
    return r.rows.map((row) => ({
      code: row.code as string,
      nameKey: row.name_key as string,
      rank: Number(row.rank),
      minVolume30d: row.min_volume_30d === null ? null : Number(row.min_volume_30d),
      minTrades30d: row.min_trades_30d === null ? null : Number(row.min_trades_30d),
      minActiveDays30d: row.min_active_days_30d === null ? null : Number(row.min_active_days_30d),
      requiresReferral: row.requires_referral === true,
      benefitKey: (row.benefit_key as string | null) ?? null,
      /*
         ★ 숫자로 정규화한다. pg 가 INTEGER 를 문자열로 주는 경우가 있어,
           그대로 두면 화면에서 '1000' / 100 = NaN 이 된다.
      */
      rebateShareBps: Number(row.rebate_share_bps ?? 0) || 0,
    }));
  }

  /**
   * 30일 실거래 지표.
   *
   * @param hasVerifiedCredential 거래소 키가 검증됐는가. false 면 측정 불가다 —
   *   거래를 조회할 방법이 없으므로 "거래 0" 이 아니라 "모른다" 다.
   */
  /**
   * 환급 집행 스위치.
   *
   * ★★ 실패하면 **false** 를 준다.
   *
   *   조회가 실패했을 때 true 를 주면, DB 장애 중에 화면이 "환급 지급 중"이라고
   *   말한다. 돈이 걸린 안내는 확인된 경우에만 켠다.
   */
  /**
   * 환급 집행 스위치를 켜거나 끈다.
   *
   * ★★ 누가 언제 켰는지 남긴다. 돈이 나가는 스위치이므로 "누가 이걸 열었나" 에
   *   답할 수 있어야 한다.
   */
  async setPayoutsEnabled(o: { enabled: boolean; by: string; note?: string | undefined }): Promise<void> {
    await this.pool.query(
      `UPDATE tier_benefit_settings
          SET payouts_enabled = $1,
              enabled_at = CASE WHEN $1 THEN now() ELSE NULL END,
              enabled_by = CASE WHEN $1 THEN $2::text ELSE NULL END,
              note       = $3,
              updated_at = now()
        WHERE id = TRUE`,
      [o.enabled, o.by, o.note ?? null],
    );
  }

  async payoutsEnabled(): Promise<boolean> {
    try {
      const r = await this.pool.query('SELECT payouts_enabled FROM tier_benefit_settings WHERE id = TRUE');
      return r.rows[0]?.payouts_enabled === true;
    } catch {
      return false;
    }
  }

  async metrics(userId: string, hasVerifiedCredential: boolean): Promise<
    TierMetrics & { volumeUnknownRows: number }
  > {
    /*
       ★ 추천 가입은 키와 무관하게 확인된다(우리 DB 에 있다). 그래서 측정
         불가여도 이 값은 사실이다.
    */
    const ref = await this.pool.query(
      `SELECT 1 FROM referral_signups
        WHERE referred_user_id = $1
          AND keys_connected_at IS NOT NULL
        LIMIT 1`,
      [userId],
    );
    const referred = ref.rows.length > 0;

    if (!hasVerifiedCredential) {
      return {
        measurable: false,
        volume30d: null,
        trades30d: null,
        activeDays30d: null,
        referred,
        volumeUnknownRows: 0,
      };
    }

    const r = await this.pool.query(
      `SELECT
         /* 금액을 알 수 있는 행만 합산한다. */
         COALESCE(SUM(
           CASE WHEN filled_quantity IS NOT NULL AND entry_price IS NOT NULL
                THEN filled_quantity * entry_price END
         ), 0)                                                AS volume,
         COUNT(*)                                             AS trades,
         /* ★ 실제로 거래한 **날**. UTC 날짜로 센다 — 시간대를 섞으면 사람마다 다르다. */
         COUNT(DISTINCT (observed_at AT TIME ZONE 'UTC')::date) AS active_days,
         /* 금액을 모르는 행 수 — 합계가 실제보다 작다는 사실을 밝힌다. */
         COUNT(*) FILTER (
           WHERE filled_quantity IS NULL OR entry_price IS NULL
         )                                                    AS unknown_rows
       FROM trade_outcomes
      WHERE user_id = $1
        AND execution_mode = 'live'
        AND outcome_kind IN ('filled', 'partial', 'closed', 'liquidated')
        AND observed_at >= now() - interval '30 days'`,
      [userId],
    );
    const row = r.rows[0] ?? {};
    return {
      measurable: true,
      volume30d: Number(row.volume ?? 0),
      trades30d: Number(row.trades ?? 0),
      activeDays30d: Number(row.active_days ?? 0),
      referred,
      volumeUnknownRows: Number(row.unknown_rows ?? 0),
    };
  }

  /**
   * 계산된 등급을 저장한다.
   *
   * ★ 계산 근거(지표 + 기준 스냅샷)를 함께 남긴다. 고객이 "왜 등급이 내려갔나"
   *   고 물으면 답할 수 있어야 한다.
   */
  async saveState(input: {
    userId: string;
    tierCode: string | null;
    metrics: TierMetrics;
    criteria: unknown;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO user_tier_state
         (user_id, tier_code, volume_30d, trades_30d, active_days_30d, referred, measurable, computed_at, criteria_snapshot)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now(), $8)
       ON CONFLICT (user_id) DO UPDATE SET
         tier_code = EXCLUDED.tier_code,
         volume_30d = EXCLUDED.volume_30d,
         trades_30d = EXCLUDED.trades_30d,
         active_days_30d = EXCLUDED.active_days_30d,
         referred = EXCLUDED.referred,
         measurable = EXCLUDED.measurable,
         computed_at = now(),
         criteria_snapshot = EXCLUDED.criteria_snapshot`,
      [
        input.userId,
        input.tierCode,
        input.metrics.volume30d,
        input.metrics.trades30d,
        input.metrics.activeDays30d,
        input.metrics.referred,
        input.metrics.measurable,
        JSON.stringify(input.criteria ?? null),
      ],
    );
  }

  /**
   * 등급 분포 (운영자용).
   *
   * ★ 측정 불가 인원을 따로 센다. 최저 등급에 섞으면 "저등급이 많다" 는 잘못된
   *   판단을 하게 된다 — 그 사람들은 키를 연결하지 않은 것이다.
   */
  async distribution(): Promise<{
    byTier: Array<{ tierCode: string | null; count: number }>;
    unmeasurable: number;
    total: number;
  }> {
    const r = await this.pool.query(
      `SELECT tier_code, COUNT(*) c, COUNT(*) FILTER (WHERE NOT measurable) unmeasurable
         FROM user_tier_state
        GROUP BY tier_code`,
    );
    let unmeasurable = 0;
    let total = 0;
    const byTier: Array<{ tierCode: string | null; count: number }> = [];
    for (const row of r.rows) {
      const c = Number(row.c);
      total += c;
      unmeasurable += Number(row.unmeasurable ?? 0);
      byTier.push({ tierCode: (row.tier_code as string | null) ?? null, count: c });
    }
    return { byTier, unmeasurable, total };
  }
}
