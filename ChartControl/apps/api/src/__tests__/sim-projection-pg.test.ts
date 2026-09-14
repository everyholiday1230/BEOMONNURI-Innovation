/*
   시뮬레이터 투영 — 실제 Postgres 통합 시험
   ------------------------------------------------------------
   ★★★ 왜 실제 DB 로 하는가

     `applySimFill` 단위 시험은 **부호 규칙**만 검증한다. 그러나 페이퍼 모드가
     동작하려면 그것들이 하나의 트랜잭션 안에서 실제 SQL 로 맞물려야 한다:

       · FOR UPDATE 잠금이 실제로 걸리는가
       · ON CONFLICT (user_id, asset) 유니크 색인이 멱등성을 보장하는가
       · 전량 청산에서 포지션 행이 정말 사라지는가
       · 증거금 잠금 → 해제 후 `used` 가 정확히 0 으로 돌아오는가

     이 중 하나라도 틀리면 잔고가 조용히 어긋나고, 대회 순위가 무의미해진다.
     가짜 SQL 실행기로는 확인할 수 없다.

   ★ PG_TEST_URL 이 없으면 건너뛴다. 다만 **건너뛰는 것을 통과로 읽지 않도록**
     테스트 이름에 남긴다.
*/

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PgSimOrderProjection } from '../portfolio/pg-sim-projection';
import { ensureSimBalance } from '../portfolio/sim-balance';
import type { SimulatedOrderInput } from '../portfolio/sim-projection';

const URL = process.env.PG_TEST_URL;

/* ★ 저장소 뿌리에서 읽는다. 시험 실행 위치(apps/api)와 다르다. */
const ROOT = join(process.cwd(), '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

describe.skipIf(!URL)('시뮬레이터 투영 — 실제 Postgres', () => {
  let pool: Pool;
  let userId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    /*
       ★ 시험용 최소 스키마. 제품 마이그레이션 전체를 돌리지 않는 이유는 이 시험이
         검증하려는 것이 **잔고·포지션 계산**이고, 다른 표는 관여하지 않기 때문이다.
       ★★ 유니크 색인은 **반드시** 만든다. 그것이 멱등성의 근거이므로 빼면 시험이
         실제와 다른 것을 검증한다(마이그레이션 0050).
    */
    await pool.query(`
      DROP TABLE IF EXISTS executions, order_events, orders, positions, account_balances, sim_users CASCADE;
      CREATE TABLE sim_users (id uuid PRIMARY KEY);
      CREATE TABLE account_balances (
        id text PRIMARY KEY,
        user_id uuid NOT NULL REFERENCES sim_users(id) ON DELETE CASCADE,
        asset text NOT NULL, available numeric NOT NULL, equity numeric NOT NULL,
        used numeric NOT NULL, at timestamptz NOT NULL);
      CREATE UNIQUE INDEX account_balances_user_asset_uniq ON account_balances (user_id, asset);
      CREATE TABLE positions (
        id text PRIMARY KEY, user_id uuid NOT NULL, symbol text NOT NULL, side text NOT NULL,
        size numeric NOT NULL, entry_price numeric, mark_price numeric, liquidation_price numeric,
        leverage integer, margin_mode text, unrealized_pnl numeric, updated_at timestamptz NOT NULL);
      CREATE TABLE orders (
        internal_order_id text PRIMARY KEY, user_id uuid NOT NULL, credential_id text,
        client_order_id text NOT NULL, exchange_order_id text, idempotency_key text,
        correlation_id text, symbol text NOT NULL, side text NOT NULL, type text NOT NULL,
        price numeric, quantity numeric NOT NULL, filled_quantity numeric NOT NULL,
        status text NOT NULL, mode text NOT NULL,
        created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, reduce_only integer);
      CREATE TABLE order_events (
        id text PRIMARY KEY, internal_order_id text NOT NULL, user_id uuid NOT NULL,
        from_state text, to_state text NOT NULL, actor text NOT NULL, seq integer,
        at timestamptz NOT NULL, meta jsonb);
      CREATE TABLE executions (
        id text PRIMARY KEY, internal_order_id text NOT NULL, user_id uuid NOT NULL, exec_id text,
        price numeric NOT NULL, quantity numeric NOT NULL, fee numeric, liquidity text,
        at timestamptz NOT NULL);
    `);
    userId = randomUUID();
    await pool.query('INSERT INTO sim_users (id) VALUES ($1)', [userId]);
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  const bal = async () => {
    const r = await pool.query(
      'SELECT available, used, equity FROM account_balances WHERE user_id = $1',
      [userId],
    );
    return r.rows[0] as { available: string; used: string; equity: string } | undefined;
  };
  const positions = async () => {
    const r = await pool.query(
      'SELECT side, size, entry_price FROM positions WHERE user_id = $1 ORDER BY side',
      [userId],
    );
    return r.rows as { side: string; size: string; entry_price: string | null }[];
  };

  const order = (o: Partial<SimulatedOrderInput> & { side: string; quantity: string }): SimulatedOrderInput => ({
    id: randomUUID(),
    clientOrderId: randomUUID(),
    symbol: 'BTCUSDT',
    orderType: 'market',
    filledQuantity: o.quantity,
    status: 'FILLED',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...o,
  });

  it('시작 잔고를 지급하고 두 번 불러도 늘지 않는다', async () => {
    const a = await ensureSimBalance(pool, userId, '10000');
    const b = await ensureSimBalance(pool, userId, '10000');
    expect(a.granted).toBe(true);
    expect(b.granted, '두 번째 호출이 또 지급했다 — 유니크 색인이 없다').toBe(false);
    expect(Number((await bal())!.available)).toBe(10000);
  });

  it('★ 진입이 증거금을 잠그고 수수료를 뺀다', async () => {
    /* 롱 0.1 @ 60000, 10x → 증거금 600, 수수료 60000×0.1×0.0006 = 3.6 */
    const P = new PgSimOrderProjection(pool);
    await P.project(userId, order({ side: 'long', price: '60000', quantity: '0.1', leverage: 10, positionAction: 'open' }));

    const b = (await bal())!;
    expect(Number(b.used), '증거금이 잠기지 않았다').toBeCloseTo(600, 6);
    expect(Number(b.available), '증거금·수수료가 빠지지 않았다').toBeCloseTo(10000 - 600 - 3.6, 6);
    /* ★★ 평가액은 항상 가용 + 잠김이다. */
    expect(Number(b.equity)).toBeCloseTo(Number(b.available) + Number(b.used), 6);

    const p = await positions();
    expect(p).toHaveLength(1);
    expect(p[0]!.side).toBe('long');
    expect(Number(p[0]!.size)).toBeCloseTo(0.1, 8);
  });

  it('★★★ 청산 전용이 반대쪽을 줄이고 손익을 확정한다 (부분)', async () => {
    /*
       숏 0.04 @ 63000 은 **롱을 0.04 줄인다** — 새 숏 포지션을 만들면 안 된다.
       손익 = (63000 − 60000) × 0.04 = +120
       풀리는 증거금 = 60000 × 0.04 ÷ 10 = 240   (진입가 기준)
       수수료 = 63000 × 0.04 × 0.0006 = 1.512
    */
    const P = new PgSimOrderProjection(pool);
    const before = (await bal())!;
    await P.project(userId, order({ side: 'short', price: '63000', quantity: '0.04', leverage: 10, positionAction: 'close' }));

    const p = await positions();
    expect(p, '숏 포지션이 새로 생겼다 — 노출이 두 배가 된다').toHaveLength(1);
    expect(p[0]!.side).toBe('long');
    expect(Number(p[0]!.size), '수량이 줄지 않았다').toBeCloseTo(0.06, 8);
    /* ★ 부분 청산은 진입가를 바꾸지 않는다. */
    expect(Number(p[0]!.entry_price), '남은 포지션의 진입가가 바뀌었다').toBeCloseTo(60000, 4);

    const after = (await bal())!;
    expect(Number(after.used), '증거금이 풀리지 않았다').toBeCloseTo(360, 6);
    expect(Number(after.available)).toBeCloseTo(Number(before.available) + 240 + 120 - 1.512, 6);
  });

  it('★★★ 전량 청산이 포지션 행을 지운다', async () => {
    /*
       0 수량 행을 남기면 화면에 "0 수량 포지션" 이 보이고 종료·TP/SL 버튼이 계속
       나타난다. 고객은 닫았는데 안 닫힌 것으로 읽는다.
    */
    const P = new PgSimOrderProjection(pool);
    await P.project(userId, order({ side: 'short', price: '63000', quantity: '0.06', leverage: 10, positionAction: 'close' }));

    expect(await positions(), '전량 청산 후에도 포지션 행이 남았다').toHaveLength(0);

    const b = (await bal())!;
    expect(Number(b.used), '전량 청산 후 잠긴 증거금이 남았다').toBeCloseTo(0, 6);
    /*
       전체 검산: 10000 − 수수료(3.6 + 1.512 + 2.268) + 손익(120 + 180) = 10292.62
       ★ 손익과 수수료를 모두 반영한 값이어야 한다. 하나라도 빠지면 어긋난다.
    */
    expect(Number(b.available)).toBeCloseTo(10000 - 3.6 - 1.512 - 2.268 + 300, 4);
    expect(Number(b.equity)).toBeCloseTo(Number(b.available), 6);
  });

  it('★★★ 보유량보다 많이 청산해도 보유량에서 멈춘다', async () => {
    /*
       ★★★ 역검증에서 이 경우가 처음에 **잡히지 않았다.** 앞선 시험들은 정확히
         맞는 수량으로만 청산했기 때문이다. 보유량을 넘는 청산을 그대로 허용하면
         손익이 보유량보다 큰 수량으로 계산되어 **잔고가 부풀려진다.**
         대회라면 그것만으로 순위가 뒤집힌다.

       진입: 롱 0.02 @ 50000, 5x  → 증거금 200, 수수료 0.6
       청산: 숏 0.5  @ 55000      → 0.02 만 닫혀야 한다
         손익 = (55000 − 50000) × 0.02 = +100   (0.5 로 계산하면 +2500)
         증거금 해제 = 50000 × 0.02 ÷ 5 = 200
    */
    const P = new PgSimOrderProjection(pool);
    await P.project(userId, order({ side: 'long', price: '50000', quantity: '0.02', leverage: 5, positionAction: 'open' }));
    const mid = (await bal())!;
    expect(Number(mid.used)).toBeCloseTo(200, 6);

    await P.project(userId, order({ side: 'short', price: '55000', quantity: '0.5', leverage: 5, positionAction: 'close' }));

    expect(await positions(), '초과 청산 후 포지션이 남았다').toHaveLength(0);
    const after = (await bal())!;
    expect(Number(after.used), '잠긴 증거금이 남았다').toBeCloseTo(0, 6);
    /*
       ★ 손익은 **보유량 기준(+100)** 이어야 한다. 주문 수량(0.5) 으로 계산하면
         +2500 이 되어 잔고가 2400 만큼 부풀려진다.
       ★ 수수료는 체결 수량 기준으로 계산되므로 여기서는 상한만 확인한다.
    */
    const gain = Number(after.available) - Number(mid.available);
    expect(gain, '손익이 보유량보다 큰 수량으로 계산됐다').toBeLessThan(200 + 100 + 1);
    expect(gain, '증거금·손익이 반영되지 않았다').toBeGreaterThan(200 + 100 - 20);
  });

  it('★★ 청산 주문임을 orders.reduce_only 에 기록한다', async () => {
    /*
       전에는 이 컬럼이 비어 있었다. 그러면 주문 목록이 보호주문(TP/SL)을 신규 주문과
       구분할 수 없고, `Reduce only` 배지가 붙지 않아 고객이 **자기가 낸 신규 주문으로
       오해**한다. 실측에서 실제로 NULL 이었다.
    */
    const P = new PgSimOrderProjection(pool);
    await P.project(userId, order({ side: 'long', price: '40000', quantity: '0.01', leverage: 4, positionAction: 'open' }));
    await P.project(userId, order({ side: 'short', price: '41000', quantity: '0.01', leverage: 4, positionAction: 'close' }));

    const r = await pool.query(
      'SELECT type, reduce_only FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 2',
      [userId],
    );
    const flags = r.rows.map((x) => Number((x as { reduce_only: number }).reduce_only));
    expect(flags, '청산/진입이 구분되지 않는다').toEqual([1, 0]);
  });

  /*
     ═══ ★★★ 알려진 한계 — 페이퍼에서 스톱은 **즉시** 체결된다 ═══

     `SimOrderEngine.confirmAndSubmit` 은 모든 주문을 곧바로 FILLED 로 만든다
     (`state = transitionOrder(state, 'FILLED'); // simulated immediate fill`).
     그래서 페이퍼 모드의 TP/SL 은 **대기하지 않고 즉시 실행된다** — 프로덕션 실측
     (2026-09-14): 손절을 확정하자 포지션이 그 자리에서 닫혔다.

     ★ 실거래(futures)에서는 거래소가 트리거를 지키므로 이 한계가 없다.
     ★★ 대회를 모의로 운영하려면 이것을 고쳐야 한다. 시세를 감시하며 조건이 닿을 때
       체결시키는 장치가 필요하다 — 지금은 없다.
     ★★★ 이 시험은 그 사실을 **문서가 아니라 코드로** 남긴다. 대기 기능이 생기면 이
       시험이 실패하고, 그때 한계 설명을 지우라는 신호가 된다.
  */
  it('★★★ (알려진 한계) 페이퍼는 스톱을 즉시 체결한다', async () => {
    const engine = read('apps/api/src/sim/order-engine.ts');
    expect(engine, '즉시 체결이 사라졌다 — 페이퍼 TP/SL 한계 설명을 갱신하라')
      .toMatch(/simulated immediate fill/);
  });

  it('★★ 없는 포지션을 청산해도 아무 일도 일어나지 않는다', async () => {
    /* 없는 것을 줄일 수는 없다. 여기서 새 포지션을 만들면 reduceOnly 의 뜻이 깨진다. */
    const P = new PgSimOrderProjection(pool);
    const before = (await bal())!;
    await P.project(userId, order({ side: 'short', price: '63000', quantity: '5', leverage: 10, positionAction: 'close' }));

    expect(await positions(), '없는 포지션을 청산하며 포지션이 생겼다').toHaveLength(0);
    const after = (await bal())!;
    /* ★ 수수료만 빠진다(체결은 일어났다). 손익·증거금 변화는 없어야 한다. */
    expect(Number(after.used)).toBeCloseTo(0, 6);
    expect(Number(after.available)).toBeLessThanOrEqual(Number(before.available));
  });
});
