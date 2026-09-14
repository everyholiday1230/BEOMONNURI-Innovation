/*
   모의(페이퍼) 잔고 — 지급과 갱신
   ------------------------------------------------------------
   왜 별도 파일인가

   ★ 돈이 움직이는 계산이다. 라우트 안에 섞어 두면 시험할 수 없고, 시험할 수
     없는 돈 계산은 언젠가 틀린다. 참조·리팩터링 실패로 지급이 두 번 일어나거나
     증거금이 차감되지 않는 종류의 결함은 화면만 보고는 발견되지 않는다.
   ★★ 실거래 잔고와 **완전히 분리**한다. 이 파일은 `account_balances`(우리 DB)만
     건드리고 거래소에는 아무것도 보내지 않는다. 두 개념이 한 함수에 섞이면
     "모의 주문인데 실제 자금이 움직였다" 는 최악의 사고가 가능해진다.

   무엇이 필요했나 (2026-09-14 실측)

     페이퍼 모드로 주문을 넣을 수 없었다. `account_balances` 프로덕션 **0행** —
     시뮬레이터에 돈을 넣는 코드가 시험 파일에만 있었다. 시뮬레이터 투영도
     orders·positions·executions 만 쓰고 잔고를 건드리지 않았다.
     `simulation_orders` 0행, `orders` 0행 — 페이퍼 주문 성공 기록이 0건이었다.
*/

import { randomUUID } from 'node:crypto';

import { D } from '@quantumtrade/domain';

/** 모의 잔고의 정산통화. 선물 증거금이 USDT 이므로 여기에 맞춘다. */
export const SIM_ASSET = 'USDT';

/**
 * 기본 시작 잔고.
 *
 * ★ 10,000 USDT. 실제 소액 계정과 비슷한 규모여야 연습이 의미가 있다.
 *   100만을 주면 레버리지 감각이 실거래와 달라져 "연습이 오히려 해가 되는"
 *   상태가 된다.
 * ★★ 환경변수로 바꿀 수 있게 둔다 — 대회에서는 참가자 전원에게 같은 금액을
 *   주어야 하고, 그 금액이 코드에 박혀 있으면 대회마다 배포가 필요하다.
 */
export const SIM_DEFAULT_START = '10000';

/** 최소 SQL 실행기. pg Pool/Client 와 시험용 가짜 모두 이 형태를 만족한다. */
export interface SqlRunner {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface EnsureResult {
  /** 이번 호출에서 새로 지급했는가. 이미 있었으면 false. */
  granted: boolean;
  /** 지급 후(또는 기존) 사용 가능 잔고. */
  available: string;
}

/**
 * 모의 시작 잔고를 보장한다. 이미 있으면 아무것도 하지 않는다.
 *
 * ★★★ **멱등**이어야 한다. 프론트가 페이퍼 모드에 들어갈 때마다 부르고, 재시도도
 *   일어난다. 지급이 두 번 되면 잔고가 두 배가 되고, 대회에서는 순위 자체가
 *   무의미해진다. 그래서 `ON CONFLICT DO NOTHING` 을 쓰고 유니크 색인
 *   (user_id, asset) 에 의존한다(마이그레이션 0050).
 * ★★ 조건을 "행이 없을 때" 로 둔다. "잔고가 0일 때" 로 하면 모의로 전액을 잃은
 *   사용자에게 자동으로 다시 채워 주게 된다 — 손실이 아무 의미가 없어지고,
 *   연습의 목적이 사라진다. 초기화는 **명시적 요청**으로만 한다.
 */
export async function ensureSimBalance(
  sql: SqlRunner,
  userId: string,
  startAmount: string = SIM_DEFAULT_START,
): Promise<EnsureResult> {
  const amount = D(startAmount);
  if (amount.isNegative()) {
    throw new Error('sim start balance must not be negative');
  }

  const ins = await sql.query(
    `INSERT INTO account_balances (id, user_id, asset, available, equity, used, at)
     VALUES ($1, $2, $3, $4, $4, '0', now())
     ON CONFLICT (user_id, asset) DO NOTHING
     RETURNING available`,
    [randomUUID(), userId, SIM_ASSET, amount.toString()],
  );

  if (ins.rows.length > 0) {
    return { granted: true, available: String(ins.rows[0]!.available) };
  }

  /* 이미 있었다. 현재 값을 돌려준다 — 호출자가 화면에 쓴다. */
  const cur = await sql.query(
    'SELECT available FROM account_balances WHERE user_id = $1 AND asset = $2',
    [userId, SIM_ASSET],
  );
  return {
    granted: false,
    available: cur.rows.length > 0 ? String(cur.rows[0]!.available) : '0',
  };
}

/**
 * 모의 잔고를 명시적으로 초기화한다.
 *
 * ★ 자동 재지급과 구분한다. 사용자가 "다시 시작" 을 눌렀을 때만 호출한다.
 * ★★ 포지션·주문을 함께 지우는 것은 **호출자의 책임**이다. 잔고만 되돌리면
 *   포지션은 남아 있어 자산이 실제보다 커 보인다.
 */
export async function resetSimBalance(
  sql: SqlRunner,
  userId: string,
  startAmount: string = SIM_DEFAULT_START,
): Promise<string> {
  const amount = D(startAmount);
  if (amount.isNegative()) {
    throw new Error('sim start balance must not be negative');
  }
  await sql.query(
    `INSERT INTO account_balances (id, user_id, asset, available, equity, used, at)
     VALUES ($1, $2, $3, $4, $4, '0', now())
     ON CONFLICT (user_id, asset)
     DO UPDATE SET available = $4, equity = $4, used = '0', at = now()`,
    [randomUUID(), userId, SIM_ASSET, amount.toString()],
  );
  return amount.toString();
}

export interface ApplyFillInput {
  /** 이 체결로 잠기는 증거금. 진입일 때 양수. */
  marginDelta: string;
  /** 이 체결로 확정된 손익. 종료일 때만 0 이 아니다. */
  realizedPnl: string;
  /** 수수료. 항상 잔고를 줄인다. */
  fee: string;
}

/**
 * 체결을 잔고에 반영한다.
 *
 * ★★★ 부호 규칙을 한곳에 모은다:
 *
 *     available -= marginDelta      (진입: 증거금이 잠긴다)
 *     available += realizedPnl      (종료: 손익이 확정된다)
 *     available -= fee              (항상)
 *     used      += marginDelta      (잠긴 금액을 따로 센다)
 *     equity     = available + used (평가액 = 가용 + 잠김)
 *
 *   종료 시 `marginDelta` 는 **음수**로 들어온다(증거금이 풀린다).
 *
 * ★★ `equity` 를 available 과 따로 저장하지 않고 **항상 합으로 계산**한다.
 *   두 값을 독립적으로 갱신하면 언젠가 어긋나고, 어긋난 뒤에는 어느 쪽이 맞는지
 *   알 수 없다.
 * ★★★ **음수 잔고를 허용하지 않는다.** 모의라도 음수 잔고는 실거래에 없는 상태이고,
 *   화면·랭킹 계산이 그것을 가정하지 않는다. 0 에서 멈춘다.
 * ★ 잠금(FOR UPDATE) 안에서 읽는다. 두 체결이 같은 값을 읽으면 하나가 사라진다.
 */
export async function applySimFill(
  sql: SqlRunner,
  userId: string,
  input: ApplyFillInput,
): Promise<{ available: string; used: string; equity: string } | null> {
  const cur = await sql.query(
    `SELECT available, used FROM account_balances
      WHERE user_id = $1 AND asset = $2
      FOR UPDATE`,
    [userId, SIM_ASSET],
  );
  if (cur.rows.length === 0) {
    /*
       ★★ 잔고 행이 없으면 **여기서 만들지 않는다.** 체결 시점에 돈을 만들어 내면
         지급 경로를 우회하게 되고, 얼마를 만들어야 하는지도 알 수 없다.
         null 을 돌려주어 호출자가 기록을 남기게 한다.
    */
    return null;
  }

  const prevAvail = D(String(cur.rows[0]!.available));
  const prevUsed = D(String(cur.rows[0]!.used));

  const margin = D(input.marginDelta);
  const pnl = D(input.realizedPnl);
  const fee = D(input.fee);

  let nextAvail = prevAvail.minus(margin).plus(pnl).minus(fee);
  if (nextAvail.isNegative()) nextAvail = D('0');

  let nextUsed = prevUsed.plus(margin);
  if (nextUsed.isNegative()) nextUsed = D('0');

  const nextEquity = nextAvail.plus(nextUsed);

  await sql.query(
    `UPDATE account_balances
        SET available = $1, used = $2, equity = $3, at = now()
      WHERE user_id = $4 AND asset = $5`,
    [nextAvail.toString(), nextUsed.toString(), nextEquity.toString(), userId, SIM_ASSET],
  );

  return {
    available: nextAvail.toString(),
    used: nextUsed.toString(),
    equity: nextEquity.toString(),
  };
}

/**
 * 진입에 필요한 증거금.
 *
 * ★ `가격 × 수량 ÷ 레버리지`. 레버리지를 모르면 1 로 본다 — 크게 잡는 방향이므로
 *   잔고를 실제보다 많이 잠근다. 반대(작게 잡기)는 잔고보다 큰 포지션을 허용하게
 *   되어 위험하다.
 * ★★ 가격이 없으면(시장가 초안) null 을 돌려준다. 0 을 돌려주면 증거금 없이
 *   주문이 통과한다.
 */
export function marginFor(
  price: string | null | undefined,
  quantity: string,
  leverage?: number | null,
): string | null {
  if (price === null || price === undefined || price === '') return null;
  const px = D(price);
  const qty = D(quantity);
  if (px.isZero() || qty.isZero()) return null;
  const lev = Number.isFinite(Number(leverage)) && Number(leverage) > 0 ? Number(leverage) : 1;
  return px.mul(qty).div(D(String(lev))).toString();
}
