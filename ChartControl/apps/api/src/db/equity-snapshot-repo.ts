import type { Pool } from 'pg';

/**
 * 일별 자산 스냅샷 저장소.
 *
 * 왜 필요한가
 * ---------
 * 자산곡선과 기간 선택(1D·7D·30D)이 동작하려면 과거 자산이 있어야 한다.
 * 아무도 기록하지 않아서 그 기능이 비활성 상태였다.
 *
 * 불변식
 * -----
 * 1. **하루 한 행.** 같은 날 다시 조회하면 갱신한다. 하루 안의 모든 변동을
 *    남기면 행이 폭증하고, 자산곡선에는 일 단위면 충분하다.
 * 2. **조회 성공 시에만 기록한다.** 실패를 0 으로 기록하면 곡선에 없던 급락이
 *    그려지고 사용자가 자산을 잃은 줄 안다.
 * 3. **보간하지 않는다.** 접속하지 않은 날은 빈 구간이고 그것이 사실이다.
 * 4. **출처를 섞지 않는다.** 거래소 실값(`exchange`)과 모의 거래 기반(`mock`)을
 *    구분해 저장하고, 조회할 때도 하나만 읽는다 — 섞이면 사용자가 모의 성과를
 *    실제로 읽는다.
 */

export type EquitySource = 'exchange' | 'mock';

export interface EquityPoint {
  /** UTC 날짜 (YYYY-MM-DD). */
  date: string;
  equity: string;
  available: string | null;
  used: string | null;
  unrealizedPnl: string | null;
  currency: string;
  source: EquitySource;
}

const str = (v: unknown): string | null =>
  v === null || v === undefined ? null : String(v);

export class PgEquitySnapshotRepo {
  constructor(private readonly pool: Pool) {}

  /**
   * 오늘자 스냅샷을 기록한다 (있으면 갱신).
   *
   * ★ `equity` 가 유한한 숫자가 아니면 **기록하지 않는다.** 조회가 실패했거나
   *   값이 없는 상태이고, 그때 0 을 남기면 곡선이 거짓이 된다.
   *
   * @returns 기록했으면 true, 값이 부적절해 건너뛰었으면 false
   */
  async record(input: {
    userId: string;
    equity: number | string;
    available?: number | string | null;
    used?: number | string | null;
    unrealizedPnl?: number | string | null;
    currency?: string;
    source: EquitySource;
    /** 테스트용. 지정하지 않으면 오늘(UTC). */
    date?: string;
  }): Promise<boolean> {
    const eq = Number(input.equity);
    /*
       ★ 0 도 유효한 자산일 수 있다(자금을 모두 뺀 상태). 그래서 0 을 거부하지
         않는다. 거부하는 것은 **숫자가 아닌 것**뿐이다 — 조회 실패는 호출자가
         이 함수를 부르지 않는 것으로 구분해야 한다.
    */
    if (!Number.isFinite(eq)) return false;

    const date = input.date ?? new Date().toISOString().slice(0, 10);

    await this.pool.query(
      `INSERT INTO equity_snapshots
         (user_id, snapshot_date, equity, available, used, unrealized_pnl, currency, source)
       VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, snapshot_date, source) DO UPDATE
         SET equity = EXCLUDED.equity,
             available = EXCLUDED.available,
             used = EXCLUDED.used,
             unrealized_pnl = EXCLUDED.unrealized_pnl,
             currency = EXCLUDED.currency`,
      [
        input.userId,
        date,
        String(eq),
        input.available === null || input.available === undefined ? null : String(Number(input.available)),
        input.used === null || input.used === undefined ? null : String(Number(input.used)),
        // 미실현 손익은 모를 수 있다. 0 으로 만들지 않는다.
        input.unrealizedPnl === null || input.unrealizedPnl === undefined
          ? null
          : String(Number(input.unrealizedPnl)),
        input.currency ?? 'USDT',
        input.source,
      ],
    );
    return true;
  }

  /**
   * 기간별 자산 곡선.
   *
   * ★ 출처를 하나만 읽는다. 거래소 값과 모의 값을 한 곡선에 섞으면 그것이
   *   무엇의 성과인지 알 수 없다.
   *
   * ★ 빈 날을 채우지 않는다. 호출자가 "점이 몇 개인지" 로 이력의 충분함을
   *   판단해야 한다 — 우리가 이어 그리면 없던 변화를 만든다.
   */
  async range(
    userId: string,
    opts: { days?: number; source?: EquitySource } = {},
  ): Promise<EquityPoint[]> {
    const days = Math.min(Math.max(1, opts.days ?? 30), 1825);
    const source = opts.source ?? 'exchange';

    const { rows } = await this.pool.query(
      `SELECT to_char(snapshot_date, 'YYYY-MM-DD') AS date,
              equity, available, used, unrealized_pnl, currency, source
         FROM equity_snapshots
        WHERE user_id = $1
          AND source = $2
          AND snapshot_date >= (CURRENT_DATE - ($3::int - 1))
        ORDER BY snapshot_date ASC`,
      [userId, source, days],
    );

    return rows.map((r) => ({
      date: String(r.date),
      equity: String(r.equity),
      available: str(r.available),
      used: str(r.used),
      unrealizedPnl: str(r.unrealized_pnl),
      currency: String(r.currency),
      source: String(r.source) as EquitySource,
    }));
  }

  /**
   * 이력이 얼마나 쌓였는지.
   *
   * 화면이 "기간 선택을 켜도 되는가" 를 판단하는 근거다. 점이 2개 미만이면
   * 곡선을 그릴 수 없다.
   */
  async summary(userId: string, source: EquitySource = 'exchange'): Promise<{
    points: number;
    firstDate: string | null;
    lastDate: string | null;
  }> {
    const { rows } = await this.pool.query(
      `SELECT count(*)::int AS n,
              to_char(min(snapshot_date), 'YYYY-MM-DD') AS first_date,
              to_char(max(snapshot_date), 'YYYY-MM-DD') AS last_date
         FROM equity_snapshots WHERE user_id = $1 AND source = $2`,
      [userId, source],
    );
    const r = rows[0] as { n: number; first_date: string | null; last_date: string | null };
    return {
      points: Number(r.n),
      firstDate: r.first_date ?? null,
      lastDate: r.last_date ?? null,
    };
  }
}
