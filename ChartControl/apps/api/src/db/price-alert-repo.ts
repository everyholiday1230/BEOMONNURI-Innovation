import { randomUUID } from 'node:crypto';

/*
   가격 알림 저장소 (PostgreSQL).

   ★ 감시 루프(index.ts)가 listActive() 로 활성 알림을 읽고, 조건이 충족되면
     markTriggered() 로 한 번만 발동시킨다(중복 알림 방지). 사용자는 create/
     listForUser/cancel 로 자기 알림을 관리한다.
*/

export type AlertDirection = 'above' | 'below';
export type AlertStatus = 'active' | 'triggered' | 'cancelled';

export interface PriceAlertRow {
  id: string;
  userId: string;
  symbol: string;
  direction: AlertDirection;
  targetPrice: number;
  status: AlertStatus;
  notifyEmail: boolean;
  triggeredPrice: number | null;
  createdAt: number;
  triggeredAt: number | null;
  cancelledAt: number | null;
}

/** 감시 루프가 쓰는 최소 정보 + 이메일 발송에 필요한 수신 주소. */
export interface ActiveAlert {
  id: string;
  userId: string;
  userEmail: string;
  symbol: string;
  direction: AlertDirection;
  targetPrice: number;
  notifyEmail: boolean;
}

export interface CreateAlertInput {
  userId: string;
  symbol: string;
  direction: AlertDirection;
  targetPrice: number;
  notifyEmail: boolean;
}

const COLS =
  `id, user_id, symbol, direction, target_price, status, notify_email, triggered_price,
   (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS created_at,
   (EXTRACT(EPOCH FROM triggered_at) * 1000)::bigint AS triggered_at,
   (EXTRACT(EPOCH FROM cancelled_at) * 1000)::bigint AS cancelled_at`;

function toRow(r: Record<string, unknown>): PriceAlertRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    symbol: String(r.symbol),
    direction: r.direction as AlertDirection,
    targetPrice: Number(r.target_price),
    status: r.status as AlertStatus,
    notifyEmail: Boolean(r.notify_email),
    triggeredPrice: r.triggered_price == null ? null : Number(r.triggered_price),
    createdAt: Number(r.created_at),
    triggeredAt: r.triggered_at == null ? null : Number(r.triggered_at),
    cancelledAt: r.cancelled_at == null ? null : Number(r.cancelled_at),
  };
}

/** 알림 개수 상한 — 한 사용자가 무한히 만들어 감시 루프를 무겁게 하지 않게. */
export const MAX_ACTIVE_ALERTS_PER_USER = 50;

export class PgPriceAlertRepo {
  constructor(private readonly pool: import('pg').Pool) {}

  async listForUser(userId: string, limit = 100): Promise<PriceAlertRow[]> {
    const { rows } = await this.pool.query(
      `SELECT ${COLS} FROM price_alerts WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [userId, Math.min(Math.max(1, limit), 200)],
    );
    return rows.map(toRow);
  }

  async countActive(userId: string): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS n FROM price_alerts WHERE user_id = $1 AND status = 'active'`,
      [userId],
    );
    return Number((rows[0] as { n: number }).n);
  }

  async create(input: CreateAlertInput): Promise<PriceAlertRow> {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO price_alerts (id, user_id, symbol, direction, target_price, notify_email)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLS}`,
      [id, input.userId, input.symbol, input.direction, input.targetPrice, input.notifyEmail],
    );
    return toRow(rows[0] as Record<string, unknown>);
  }

  /** 소유자 확인 후 취소. 이미 발동/취소된 것은 그대로 둔다. */
  async cancel(userId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE price_alerts SET status = 'cancelled', cancelled_at = now()
        WHERE id = $1 AND user_id = $2 AND status = 'active'`,
      [id, userId],
    );
    return (rowCount ?? 0) > 0;
  }

  /** 감시 대상. 활성 알림 + 수신 이메일을 함께 읽는다. */
  async listActive(): Promise<ActiveAlert[]> {
    const { rows } = await this.pool.query(
      `SELECT a.id, a.user_id, u.email AS user_email, a.symbol, a.direction,
              a.target_price, a.notify_email
         FROM price_alerts a
         JOIN users u ON u.id = a.user_id
        WHERE a.status = 'active' AND u.status = 'active'`,
    );
    return rows.map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      userEmail: String(r.user_email),
      symbol: String(r.symbol),
      direction: r.direction as AlertDirection,
      targetPrice: Number(r.target_price),
      notifyEmail: Boolean(r.notify_email),
    }));
  }

  /**
   * 발동 처리. status 가 여전히 active 일 때만 바꾼다(경합 시 한 번만 발동).
   * @returns true 면 이번 호출이 실제로 발동시킨 것(알림/메일을 보내야 한다).
   */
  async markTriggered(id: string, price: number): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE price_alerts
          SET status = 'triggered', triggered_at = now(), triggered_price = $2
        WHERE id = $1 AND status = 'active'`,
      [id, price],
    );
    return (rowCount ?? 0) > 0;
  }
}
