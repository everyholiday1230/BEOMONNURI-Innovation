import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import { D } from '@quantumtrade/domain';

import type { SimulatedOrderInput } from './sim-projection';
/*
   ★ 잔고 계산은 `sim-balance` 한 곳에만 둔다. 여기에 복사하면 두 곳이 어긋나고,
     어긋난 뒤에는 어느 쪽이 맞는지 알 수 없다.
*/
import { applySimFill, marginFor } from './sim-balance';

/**
 * 모의 수수료 요율(taker).
 *
 * ★★ 0 으로 두면 모의 성적이 실거래보다 항상 좋게 나오고, 그 차이가 전략 판단을
 *   왜곡한다. KuCoin 선물 taker 0.06% 를 쓴다.
 * ★ 환경변수로 열지 않는다 — 대회 참가자 사이에 달라지면 순위가 요율 차이로 갈린다.
 */
const SIM_TAKER_FEE_RATE = '0.0006';

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
                             price, quantity, filled_quantity, status, mode, reduce_only,
                             created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'MOCK',$11,
                 to_timestamp($12::double precision / 1000),
                 to_timestamp($13::double precision / 1000))`,
        [
          id, userId, o.clientOrderId, o.symbol, o.side, o.orderType,
          o.price ?? null, o.quantity, o.filledQuantity ?? '0', o.status,
          /*
             ★★ 청산 주문임을 **기록에도 남긴다.** 전에는 이 컬럼이 비어 있었다.
               그러면 주문 목록이 보호주문(TP/SL)을 신규 주문과 구분할 수 없고,
               화면에 `Reduce only` 배지가 붙지 않아 고객이 자기가 낸 신규 주문으로
               오해한다.
             ★ 컬럼이 integer 라 0/1 로 넣는다.
          */
          o.positionAction === 'close' ? 1 : 0,
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
        /*
           ★★★ 포지션 변화와 **잔고 변화를 같은 트랜잭션에서** 처리한다.

             나눠 쓰면 하나만 성공하는 상태가 생긴다 — 포지션은 열렸는데 증거금이
             빠지지 않으면 잔고가 무한해 보이고, 반대면 돈이 사라진다. 모의라도
             그 상태에서는 연습이 실거래와 다른 것을 가르친다.
        */
        const effect = await this.applyPosition(client, userId, o);
        await this.applyBalance(client, userId, o, effect);
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
  /**
   * 이 체결이 잔고에 미치는 영향.
   *
   * ★ `marginDelta` 는 진입이면 양수(잠긴다), 종료면 음수(풀린다).
   * ★ `realizedPnl` 은 종료에서만 0 이 아니다.
   */
  private async applyBalance(
    client: PoolClient,
    userId: string,
    o: SimulatedOrderInput,
    effect: { marginDelta: string; realizedPnl: string },
  ): Promise<void> {
    /*
       ★★ 수수료는 체결 금액의 taker 요율로 계산한다. 0 으로 두면 모의 성적이
         실거래보다 항상 좋게 나오고, 그 차이가 전략 판단을 왜곡한다.
       ★ 요율을 환경에 따라 바꿀 수 있게 두지 않는다 — 대회 참가자 사이에 달라지면
         순위가 요율 차이로 갈린다. 하나의 값을 쓴다.
    */
    const qty = D(o.filledQuantity ?? o.quantity);
    const px = o.price === undefined || o.price === null ? null : D(o.price);
    const fee = px === null || qty.isZero()
      ? '0'
      : px.mul(qty).mul(D(SIM_TAKER_FEE_RATE)).toString();

    const applied = await applySimFill(client, userId, {
      marginDelta: effect.marginDelta,
      realizedPnl: effect.realizedPnl,
      fee,
    });

    /*
       ★★ 잔고 행이 없으면 `applySimFill` 이 null 을 준다. 여기서 돈을 만들지 않고
         기록만 남긴다 — 지급 경로를 우회하면 얼마가 맞는지 알 수 없게 된다.
    */
    if (applied === null) {
      console.warn('[sim] 잔고 행이 없어 체결을 반영하지 못했다 — user=%s', userId);
    }
  }

  private async applyPosition(
    client: PoolClient,
    userId: string,
    o: SimulatedOrderInput,
  ): Promise<{ marginDelta: string; realizedPnl: string }> {
    const NONE = { marginDelta: '0', realizedPnl: '0' };

    const qty = D(o.filledQuantity ?? o.quantity);
    if (qty.isZero()) return NONE;
    const px = o.price === undefined || o.price === null ? null : D(o.price);

    /*
       ★★★ **청산 전용(reduceOnly)은 반대쪽 포지션을 줄인다.**

         TP/SL 은 항상 reduceOnly 다. 이것을 구분하지 않으면 롱을 닫는 손절(숏)이
         **새 숏 포지션**을 만들어 노출이 두 배가 된다. 실거래에서는 거래소가 막아
         주지만, 모의에서 그렇게 계산되면 연습이 실거래와 다른 것을 가르친다.

       ★ 줄일 대상은 **주문 방향의 반대**다. 숏 주문은 롱을 줄인다.
    */
    if (o.positionAction === 'close') {
      const oppositeSide = o.side === 'long' ? 'short' : 'long';
      return this.reducePosition(client, userId, o, oppositeSide, qty, px);
    }

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

    /*
       ★★ 진입은 증거금을 잠근다. 가격을 모르면(시장가 초안) 계산할 수 없으므로
         0 을 돌려준다 — 추측한 금액을 잠그면 잔고가 실제와 어긋난다.
    */
    const margin = marginFor(px === null ? null : px.toString(), qty.toString(), o.leverage) ?? '0';

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
      return { marginDelta: margin, realizedPnl: '0' };
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
    return { marginDelta: margin, realizedPnl: '0' };
  }

  /**
   * 반대쪽 포지션을 줄인다(청산 전용 체결).
   *
   * ★★★ 손익 = (종료가 − 진입가) × 줄인 수량 × 방향
   *   롱을 닫으면 오른 만큼 이익, 숏을 닫으면 내린 만큼 이익이다.
   * ★★ 줄이는 수량은 **보유량을 넘지 못한다.** 넘치면 남는 수량으로 반대 포지션이
   *   열려야 하는데, reduceOnly 의 정의상 그럴 수 없다. 보유량에서 멈춘다.
   * ★ 포지션이 없으면 아무것도 하지 않는다 — 없는 것을 줄일 수는 없다.
   */
  private async reducePosition(
    client: PoolClient,
    userId: string,
    o: SimulatedOrderInput,
    side: string,
    qty: ReturnType<typeof D>,
    px: ReturnType<typeof D> | null,
  ): Promise<{ marginDelta: string; realizedPnl: string }> {
    const NONE = { marginDelta: '0', realizedPnl: '0' };

    const cur = await client.query(
      'SELECT id, size, entry_price, leverage FROM positions WHERE user_id = $1 AND symbol = $2 AND side = $3 FOR UPDATE',
      [userId, o.symbol, side],
    );
    const pos = cur.rows[0] as
      | { id: string; size: string; entry_price: string | null; leverage: number | null }
      | undefined;
    if (!pos) {
      console.warn('[sim] 줄일 포지션이 없다 — user=%s symbol=%s side=%s', userId, o.symbol, side);
      return NONE;
    }

    const held = D(pos.size);
    const closeQty = qty.gt(held) ? held : qty;
    if (closeQty.isZero()) return NONE;

    const entry = pos.entry_price === null ? null : D(pos.entry_price);

    /*
       ★★ 손익은 진입가와 종료가를 모두 알아야 계산할 수 있다. 하나라도 없으면
         0 으로 둔다 — 추측한 손익은 틀린 손익이고, 랭킹을 왜곡한다.
    */
    let realized = '0';
    if (entry !== null && px !== null) {
      const diff = side === 'long' ? px.minus(entry) : entry.minus(px);
      realized = diff.mul(closeQty).toString();
    }

    /*
       ★★ 풀리는 증거금은 **진입 시 기준**으로 계산한다(진입가 × 줄인 수량 ÷ 레버리지).
         종료가로 계산하면 잠근 금액과 풀리는 금액이 달라져 잔고가 조용히 어긋난다.
       ★ 음수로 돌려준다 — `applySimFill` 이 그것을 "풀린다" 로 읽는다.
    */
    const releasedMargin = entry === null
      ? '0'
      : `-${marginFor(entry.toString(), closeQty.toString(), pos.leverage) ?? '0'}`;

    const remaining = held.minus(closeQty);
    if (remaining.isZero()) {
      /*
         ★★★ 전량 종료면 **행을 지운다.** size 0 인 행을 남기면 화면에 "0 수량 포지션"
           이 보이고, 종료 버튼·TP/SL 버튼이 그 행에 계속 나타난다.
      */
      await client.query('DELETE FROM positions WHERE id = $1', [pos.id]);
    } else {
      /*
         ★ 부분 종료는 수량만 줄인다. **진입가는 그대로 둔다** — 남은 포지션의 평균
           진입가는 변하지 않는다. 종료가로 다시 평균하면 남은 손익이 틀어진다.
      */
      await client.query(
        `UPDATE positions
            SET size = $1, updated_at = to_timestamp($2::double precision / 1000)
          WHERE id = $3`,
        [remaining.toString(), o.updatedAt, pos.id],
      );
    }

    return { marginDelta: releasedMargin, realizedPnl: realized };
  }
}
