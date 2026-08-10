import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import { D } from '@quantumtrade/domain';

import type { SimulatedOrderInput } from './sim-projection';

/**
 * 모의 주문을 **PostgreSQL** 의 거래 테이블에 기록한다.
 *
 * 왜 이 파일이 생겼나
 * -----------------
 * `SimOrderProjection` 은 SQLite 전용이었다(`better-sqlite3` 의 동기 API 를 직접 쓴다).
 * 그런데 이 배포는 사용자·세션을 PostgreSQL 에 둔다. 그래서 모의 주문을 확인하면
 * `orders.user_id` 외래키가 SQLite 의 `users` 를 찾다가 실패했다:
 *
 *     [api] sim order projection failed: FOREIGN KEY constraint failed
 *
 * 그 예외는 호출 지점에서 잡아 로그만 남기고 삼켜진다. 주문 자체는 성공으로
 * 응답하므로 **화면은 정상이었고, 기록만 사라졌다.** 실측 결과 8개 거래 테이블이
 * 전부 0행이었다 — 주문 이력·포지션·체결이 하나도 남지 않았다.
 *
 * 같은 형태의 결함을 전에도 겪었다(`SqliteStrategyRepo` → `PgStrategyRepo`).
 * 저장소를 하나만 만들어 두면 배포가 갈릴 때 조용히 깨진다.
 *
 * 이 파일이 하지 않는 것
 * -------------------
 * **거래소로 아무것도 보내지 않는다.** 모든 행은 `mode='MOCK'` 으로 기록되고,
 * `/api/orders/*` 가 그것을 `source: MOCK` 으로 보고한다. 모의 체결이 어느
 * 층에서도 실제 체결로 오인될 수 없어야 한다.
 */
export class PgSimOrderProjection {
  constructor(private readonly pool: Pool) {}

  /**
   * 주문·체결·포지션을 **한 트랜잭션**으로 기록한다.
   *
   * 일부만 기록되면 없는 것보다 나쁘다: 체결 없는 주문이나 포지션 없는 체결은
   * 스스로 모순되는 읽기 모델이다.
   */
  async project(userId: string, o: SimulatedOrderInput): Promise<{ ok: boolean; orderId: string }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      /*
         중복 확인은 데이터 층에서 막는다.

         같은 확인 요청이 두 번 오면(재시도·중복 클릭) 두 번째는 아무것도 하지
         않아야 한다. 호출자가 먼저 조회하도록 맡기면 언젠가 빠뜨린다.
      */
      const dup = await client.query(
        'SELECT internal_order_id FROM orders WHERE user_id = $1 AND client_order_id = $2',
        [userId, o.clientOrderId],
      );
      if (dup.rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false, orderId: String(dup.rows[0].internal_order_id) };
      }

      const id = o.id;

      /*
         ★ 시각 컬럼이 timestamptz 다 (SQLite 판은 정수 epoch 였다).

           epoch ms 를 그대로 넣으면 1970년대 날짜가 되거나 타입 오류가 난다.
           to_timestamp 로 변환한다.
      */
      await client.query(
        `INSERT INTO orders (internal_order_id, user_id, client_order_id, symbol, side, type,
                             price, quantity, filled_quantity, status, mode, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'MOCK',
                 to_timestamp($11::double precision / 1000),
                 to_timestamp($12::double precision / 1000))`,
        [
          id, userId, o.clientOrderId, o.symbol, o.side, o.orderType,
          o.price ?? null, o.quantity, o.filledQuantity ?? '0', o.status,
          o.createdAt, o.updatedAt,
        ],
      );

      // 상태 전이를 남긴다 — 이력 화면이 "현재 상태" 가 아니라 "어떻게 그 상태가 됐는지" 를 보여줘야 한다.
      const events = o.events ?? [];
      for (const [i, e] of events.entries()) {
        await client.query(
          `INSERT INTO order_events (id, internal_order_id, user_id, from_state, to_state, actor, seq, at, meta)
           VALUES ($1,$2,$3,$4,$5,$6,$7, to_timestamp($8::double precision / 1000), NULL)`,
          [randomUUID(), id, userId, e.fromState, e.toState, e.actor, i, e.at],
        );
      }

      /*
         체결 행은 **실제로 채워진 전이에만** 기록한다.

         접수만 되고 체결되지 않은 주문에 체결 행을 만들면 거래 이력이 허구가 된다.
      */
      const fills = events.filter((e) => e.toState === 'FILLED' || e.toState === 'PARTIALLY_FILLED');
      for (const [i, e] of fills.entries()) {
        await client.query(
          `INSERT INTO executions (id, internal_order_id, user_id, exec_id, price, quantity, fee, liquidity, at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8, to_timestamp($9::double precision / 1000))`,
          [
            randomUUID(), id, userId, `${id}-${i}`,
            o.price ?? '0', o.filledQuantity ?? o.quantity,
            // 모의 체결의 수수료는 알 수 없다. 0 으로 적으면 "수수료가 없었다" 는 거짓이 된다.
            null,
            'taker', e.at,
          ],
        );
      }

      if (o.status === 'FILLED' || o.status === 'PARTIALLY_FILLED') {
        await this.upsertPosition(client, userId, o);
      }

      await client.query('COMMIT');
      return { ok: true, orderId: id };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * 체결을 (사용자, 심볼, 방향) 포지션에 누적한다.
   *
   * ★ 평균 진입가를 십진 연산으로 계산한다. 부동소수점으로 하면 체결마다 오차가
   *   쌓이고, 그 오차가 손익 컬럼에 그대로 보인다.
   */
  private async upsertPosition(client: PoolClient, userId: string, o: SimulatedOrderInput): Promise<void> {
    const qty = D(o.filledQuantity ?? o.quantity);
    if (qty.isZero()) return;
    const px = o.price === undefined ? null : D(o.price);

    /*
       ★ 같은 행을 동시에 갱신할 수 있으므로 잠금 안에서 읽는다.

         잠금 없이 "읽고 더하기" 하면 두 체결이 같은 값을 읽어 하나가 사라진다.
         포지션 수량이 실제보다 작아지면 청산 위험을 과소평가한다.
    */
    const cur = await client.query(
      'SELECT id, size, entry_price FROM positions WHERE user_id = $1 AND symbol = $2 AND side = $3 FOR UPDATE',
      [userId, o.symbol, o.side],
    );
    const existing = cur.rows[0] as { id: string; size: string; entry_price: string | null } | undefined;

    if (!existing) {
      await client.query(
        `INSERT INTO positions (id, user_id, symbol, side, size, entry_price, mark_price,
                                liquidation_price, leverage, margin_mode, unrealized_pnl, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL,$7,$8,NULL, to_timestamp($9::double precision / 1000))`,
        [
          randomUUID(), userId, o.symbol, o.side, qty.toString(),
          px === null ? null : px.toString(),
          /*
             표시가·미실현손익은 실시간 시세가 필요하다.

             NULL 이 정직한 값이다. 0 으로 채우면 화면이 "손익 0" 이라고 표시하고,
             사용자는 본전이라고 읽는다.
          */
          o.leverage ?? null, o.marginMode ?? null, o.updatedAt,
        ],
      );
      return;
    }

    const prevSize = D(existing.size);
    const newSize = prevSize.plus(qty);
    let entry: string | null = existing.entry_price;
    if (px !== null && !newSize.isZero()) {
      const prevEntry = existing.entry_price === null ? px : D(existing.entry_price);
      entry = prevEntry.mul(prevSize).plus(px.mul(qty)).div(newSize).toString();
    }

    await client.query(
      `UPDATE positions
          SET size = $1,
              entry_price = $2,
              leverage = COALESCE($3, leverage),
              margin_mode = COALESCE($4, margin_mode),
              updated_at = to_timestamp($5::double precision / 1000)
        WHERE id = $6`,
      [newSize.toString(), entry, o.leverage ?? null, o.marginMode ?? null, o.updatedAt, existing.id],
    );
  }
}
