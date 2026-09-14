/*
   모의(페이퍼) 잔고 시험
   ------------------------------------------------------------
   ★ 돈이 움직이는 계산이므로 화면 없이 검증한다. 여기서 잡지 못하면 프로덕션에서
     "잔고가 두 배" 나 "증거금이 안 빠짐" 으로 나타나고, 대회라면 순위가 무의미해진다.
   ★★ 가짜 SQL 실행기를 쓴다. 실제 Postgres 없이도 **부호 규칙**을 검증할 수 있어야
     한다 — CI 에 PG 가 없으면 건너뛰는 시험은 없는 시험과 같다.
*/

import { describe, expect, it } from 'vitest';

import {
  SIM_ASSET,
  SIM_DEFAULT_START,
  applySimFill,
  ensureSimBalance,
  marginFor,
  resetSimBalance,
  type SqlRunner,
} from '../portfolio/sim-balance';

/**
 * 아주 작은 가짜 저장소.
 *
 * ★ `ON CONFLICT (user_id, asset) DO NOTHING` 의 의미만 흉내낸다 — 같은 키가
 *   있으면 삽입하지 않고 RETURNING 이 빈 배열이 된다. 이것이 멱등성의 근거다.
 */
function fakeSql(seed?: { available: string; used: string }): SqlRunner & {
  rowsFor: () => { available: string; used: string } | null;
  calls: string[];
} {
  let row: { available: string; used: string } | null = seed ? { ...seed } : null;
  const calls: string[] = [];
  return {
    calls,
    rowsFor: () => (row ? { ...row } : null),
    async query(sql: string, params: unknown[] = []) {
      calls.push(sql.trim().split('\n')[0]!.trim());
      if (sql.includes('INSERT INTO account_balances') && sql.includes('DO NOTHING')) {
        if (row) return { rows: [] };
        row = { available: String(params[3]), used: '0' };
        return { rows: [{ available: row.available }] };
      }
      if (sql.includes('INSERT INTO account_balances') && sql.includes('DO UPDATE')) {
        row = { available: String(params[3]), used: '0' };
        return { rows: [] };
      }
      if (sql.includes('SELECT available, used')) {
        return { rows: row ? [{ available: row.available, used: row.used }] : [] };
      }
      if (sql.includes('SELECT available FROM account_balances')) {
        return { rows: row ? [{ available: row.available }] : [] };
      }
      if (sql.includes('UPDATE account_balances')) {
        row = { available: String(params[0]), used: String(params[1]) };
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

describe('모의 잔고 지급', () => {
  it('없으면 시작 잔고를 지급한다', async () => {
    const sql = fakeSql();
    const r = await ensureSimBalance(sql, 'u1');
    expect(r.granted, '지급하지 않았다').toBe(true);
    expect(r.available).toBe(SIM_DEFAULT_START);
    expect(SIM_ASSET).toBe('USDT');
  });

  it('★★★ 두 번 불러도 두 배가 되지 않는다 (멱등)', async () => {
    /*
       프론트는 페이퍼 모드에 들어갈 때마다 부르고 재시도도 일어난다. 두 번 지급되면
       잔고가 두 배가 되고, 대회에서는 순위 자체가 무의미해진다.
    */
    const sql = fakeSql();
    const a = await ensureSimBalance(sql, 'u1');
    const b = await ensureSimBalance(sql, 'u1');
    expect(a.granted).toBe(true);
    expect(b.granted, '두 번째 호출이 또 지급했다').toBe(false);
    expect(sql.rowsFor()!.available, '잔고가 늘어났다').toBe(SIM_DEFAULT_START);
  });

  it('★★ 전액을 잃어도 자동으로 다시 채우지 않는다', async () => {
    /*
       조건이 "잔고가 0일 때" 였다면 모의로 전액을 잃은 사용자에게 계속 채워 주게
       된다 — 손실이 아무 의미가 없어지고 연습의 목적이 사라진다. 조건은 "행이 없을 때" 다.
    */
    const sql = fakeSql({ available: '0', used: '0' });
    const r = await ensureSimBalance(sql, 'u1');
    expect(r.granted, '0 잔고에 다시 지급했다').toBe(false);
    expect(r.available).toBe('0');
  });

  it('명시적 초기화는 값을 되돌린다', async () => {
    const sql = fakeSql({ available: '13.5', used: '99' });
    const v = await resetSimBalance(sql, 'u1', '5000');
    expect(v).toBe('5000');
    expect(sql.rowsFor()!.available).toBe('5000');
    expect(sql.rowsFor()!.used, '잠긴 금액을 풀지 않았다').toBe('0');
  });

  it('음수 시작 잔고를 거부한다', async () => {
    await expect(ensureSimBalance(fakeSql(), 'u1', '-1')).rejects.toThrow();
    await expect(resetSimBalance(fakeSql(), 'u1', '-1')).rejects.toThrow();
  });
});

describe('체결 반영 — 부호 규칙', () => {
  it('진입은 증거금을 잠그고 수수료를 뺀다', async () => {
    const sql = fakeSql({ available: '10000', used: '0' });
    const r = await applySimFill(sql, 'u1', { marginDelta: '1000', realizedPnl: '0', fee: '0.6' });
    expect(r).not.toBeNull();
    expect(r!.available, '증거금·수수료가 빠지지 않았다').toBe('8999.4');
    expect(r!.used, '잠긴 금액을 세지 않았다').toBe('1000');
    /* ★ 평가액은 항상 가용 + 잠김이다. 따로 저장하면 언젠가 어긋난다. */
    expect(r!.equity).toBe('9999.4');
  });

  it('종료는 증거금을 풀고 손익을 확정한다', async () => {
    /* ★ 종료 시 marginDelta 는 음수로 들어온다. */
    const sql = fakeSql({ available: '9000', used: '1000' });
    const r = await applySimFill(sql, 'u1', { marginDelta: '-1000', realizedPnl: '250', fee: '0.6' });
    expect(r!.available).toBe('10249.4');
    expect(r!.used, '잠긴 금액이 풀리지 않았다').toBe('0');
    expect(r!.equity).toBe('10249.4');
  });

  it('손실도 그대로 반영한다', async () => {
    const sql = fakeSql({ available: '9000', used: '1000' });
    const r = await applySimFill(sql, 'u1', { marginDelta: '-1000', realizedPnl: '-400', fee: '0.5' });
    expect(r!.available).toBe('9599.5');
    expect(r!.equity).toBe('9599.5');
  });

  it('★★★ 음수 잔고가 되지 않는다', async () => {
    /*
       모의라도 음수 잔고는 실거래에 없는 상태다. 화면·랭킹 계산이 그것을 가정하지
       않으므로 0 에서 멈춘다.
    */
    const sql = fakeSql({ available: '10', used: '0' });
    const r = await applySimFill(sql, 'u1', { marginDelta: '0', realizedPnl: '-999', fee: '1' });
    expect(r!.available).toBe('0');
    expect(r!.equity).toBe('0');
  });

  it('★★ 잔고 행이 없으면 돈을 만들어 내지 않는다', async () => {
    /*
       체결 시점에 잔고를 만들면 지급 경로를 우회하게 되고, 얼마를 만들어야 하는지도
       알 수 없다. null 로 알려 호출자가 기록을 남기게 한다.
    */
    const sql = fakeSql();
    const r = await applySimFill(sql, 'u1', { marginDelta: '10', realizedPnl: '0', fee: '0' });
    expect(r, '없는 잔고에 체결을 반영했다').toBeNull();
  });

  it('★ 잠금 안에서 읽는다 — 두 체결이 겹치면 하나가 사라진다', async () => {
    const sql = fakeSql({ available: '100', used: '0' });
    await applySimFill(sql, 'u1', { marginDelta: '1', realizedPnl: '0', fee: '0' });
    expect(sql.calls.some((c) => /SELECT available, used/.test(c)), '읽기 구문이 없다').toBe(true);
    const src = String(applySimFill);
    expect(src, 'FOR UPDATE 없이 읽는다').toMatch(/FOR UPDATE/);
  });
});

describe('증거금 계산', () => {
  it('가격 × 수량 ÷ 레버리지', () => {
    expect(marginFor('100', '2', 10)).toBe('20');
    expect(marginFor('62500', '0.1', 5)).toBe('1250');
  });

  it('★ 레버리지를 모르면 1 로 본다 — 크게 잡는 방향', () => {
    /* 작게 잡으면 잔고보다 큰 포지션을 허용한다. 반대 방향의 실수가 더 위험하다. */
    expect(marginFor('100', '2')).toBe('200');
    expect(marginFor('100', '2', 0)).toBe('200');
    expect(marginFor('100', '2', Number.NaN)).toBe('200');
  });

  it('★★ 가격이 없으면 null — 0 을 주면 증거금 없이 통과한다', () => {
    expect(marginFor(null, '2', 10)).toBeNull();
    expect(marginFor(undefined, '2', 10)).toBeNull();
    expect(marginFor('', '2', 10)).toBeNull();
    expect(marginFor('0', '2', 10)).toBeNull();
    expect(marginFor('100', '0', 10)).toBeNull();
  });
});
