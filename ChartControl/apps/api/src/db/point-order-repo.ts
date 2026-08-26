import { randomUUID } from 'node:crypto';
import type { PgPointsRepo } from './points-repo';

/*
   포인트 충전 주문 저장소 (PostgreSQL).

   흐름: create() 로 주문 생성 → 결제 제공자에서 결제 확인 → markPaid() 가 포인트를
   적립(point_ledger, reason='purchase')하고 주문을 paid 로 만든다.

   멱등: 적립은 point_ledger 의 uq_points_ref (user_id, reason, ref_type='payment',
   ref_id=order.id) 로 이중 방지되고, 주문 상태 가드로 한 번 더 막는다. 웹훅이 중복으로
   와도 포인트가 두 번 들어가지 않는다.
*/

export type PaymentProvider = 'paypal' | 'usdt' | 'toss';
export type PointOrderStatus = 'created' | 'paid' | 'failed' | 'expired';

export interface PointOrderRow {
  id: string;
  userId: string;
  provider: PaymentProvider;
  packageId: string | null;
  points: number;
  amount: string;      // NUMERIC → 문자열(부동소수 반올림 회피)
  currency: string;
  status: PointOrderStatus;
  providerRef: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateOrderInput {
  userId: string;
  provider: PaymentProvider;
  packageId: string | null;
  points: number;
  amount: string;
  currency: string;
  providerRef?: string | null;
}

function mapRow(x: Record<string, unknown>): PointOrderRow {
  return {
    id: String(x.id),
    userId: String(x.user_id),
    provider: String(x.provider) as PaymentProvider,
    packageId: x.package_id == null ? null : String(x.package_id),
    points: Number(x.points),
    amount: String(x.amount),
    currency: String(x.currency),
    status: String(x.status) as PointOrderStatus,
    providerRef: x.provider_ref == null ? null : String(x.provider_ref),
    createdAt: x.created_at instanceof Date ? x.created_at.getTime() : Number(x.created_at),
    updatedAt: x.updated_at instanceof Date ? x.updated_at.getTime() : Number(x.updated_at),
  };
}

export class PgPointOrderRepo {
  constructor(private readonly pool: import('pg').Pool, private readonly points: PgPointsRepo) {}

  async create(input: CreateOrderInput): Promise<PointOrderRow> {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO point_orders (id, user_id, provider, package_id, points, amount, currency, status, provider_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'created',$8) RETURNING *`,
      [id, input.userId, input.provider, input.packageId, input.points, input.amount, input.currency, input.providerRef ?? null],
    );
    return mapRow(rows[0] as Record<string, unknown>);
  }

  async getOwned(userId: string, id: string): Promise<PointOrderRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM point_orders WHERE id=$1 AND user_id=$2', [id, userId]);
    return rows[0] ? mapRow(rows[0] as Record<string, unknown>) : null;
  }

  async findByRef(provider: PaymentProvider, providerRef: string): Promise<PointOrderRow | null> {
    const { rows } = await this.pool.query('SELECT * FROM point_orders WHERE provider=$1 AND provider_ref=$2', [provider, providerRef]);
    return rows[0] ? mapRow(rows[0] as Record<string, unknown>) : null;
  }

  /** 결제 제공자 참조(주문/인보이스 id)를 붙인다. 생성 직후 1회. */
  async attachRef(id: string, providerRef: string): Promise<void> {
    await this.pool.query('UPDATE point_orders SET provider_ref=$2, updated_at=now() WHERE id=$1', [id, providerRef]);
  }

  async listOwned(userId: string, limit = 50): Promise<PointOrderRow[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM point_orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2',
      [userId, Math.min(200, Math.max(1, limit))],
    );
    return (rows as Record<string, unknown>[]).map(mapRow);
  }

  /**
   * 결제가 확인된 주문을 적립 처리한다. 반드시 결제 검증(예: PayPal capture 성공,
   * 크립토 웹훅 서명 검증) **후에** 호출한다. 멱등: 이미 paid 면 적립하지 않는다.
   */
  async markPaid(id: string): Promise<{ credited: boolean; order: PointOrderRow } | null> {
    const existing = await this.pool.query('SELECT * FROM point_orders WHERE id=$1', [id]);
    if (!existing.rows[0]) return null;
    const order = mapRow(existing.rows[0] as Record<string, unknown>);
    if (order.status === 'paid') return { credited: false, order };

    // 적립(멱등: 같은 주문 ref 로 두 번 적립되지 않는다) → 그다음 주문 상태 갱신.
    await this.points.grant({
      userId: order.userId,
      amount: order.points,
      reason: 'purchase',
      refType: 'payment',
      refId: order.id,
      memo: `${order.provider} ${order.amount} ${order.currency}`,
    });
    const upd = await this.pool.query(`UPDATE point_orders SET status='paid', updated_at=now() WHERE id=$1 RETURNING *`, [id]);
    return { credited: true, order: mapRow(upd.rows[0] as Record<string, unknown>) };
  }

  async markFailed(id: string): Promise<void> {
    await this.pool.query(`UPDATE point_orders SET status='failed', updated_at=now() WHERE id=$1 AND status='created'`, [id]);
  }
}
