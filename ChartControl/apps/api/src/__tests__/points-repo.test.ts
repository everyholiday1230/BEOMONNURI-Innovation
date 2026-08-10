/**
 * 포인트 원장 테스트.
 *
 * ★ 여기서 가장 중요한 것은 **동시 차감 테스트**다.
 *
 *   "잔액 확인 → 차감" 을 잠금 없이 하면 두 요청이 같은 잔액을 읽고 둘 다
 *   통과한다. 그러면 사용자가 가진 것보다 많이 쓴다 — 우리가 손실을 본다.
 *   이 결함은 손으로 눌러서는 절대 재현되지 않으므로 테스트로만 잡힌다.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

import { PgPointsRepo } from '../db/points-repo';

const PG_URL = process.env.PG_TEST_URL;

/* Postgres 없이는 원장을 시험할 수 없다. 통과했다고 속이지 않고 건너뛴다. */
const d = PG_URL ? describe : describe.skip;

d('PgPointsRepo', () => {
  let pool: Pool;
  let repo: PgPointsRepo;
  let userA: string;
  let userB: string;

  /*
     users.id 는 uuid 다 (실측 확인).

     ★ 'usr_pt_...' 같은 문자열 ID 를 쓰면 `operator does not exist: uuid ~~ unknown`
       으로 실패한다. 정리도 ID 패턴이 아니라 email 로 한다 — uuid 에는
       LIKE 를 쓸 수 없다.
  */
  const TEST_EMAIL_SUFFIX = '@points-test.local';
  const created: string[] = [];

  const makeUser = async (): Promise<string> => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, role, status, created_at, updated_at)
       VALUES ($1, $2, 'x', 'user', 'active', now(), now())`,
      [id, `pt_${id.slice(0, 8)}${TEST_EMAIL_SUFFIX}`],
    );
    created.push(id);
    return id;
  };

  /*
     제도 설정은 **단일행 공유 상태**다 (point_settings, id='default').

     ★ 테스트가 이걸 바꾸고 되돌리지 않으면 개발 DB 의 제도 조건이 오염된다.
       실제로 겪었다: 테스트를 돌린 뒤 화면의 단위 이름이 'Credits' 로 바뀌어
       있었다. 더 나쁜 경우는 누군가 운영 DB 를 가리켜 테스트를 돌리는 것이다 —
       그러면 살아 있는 제도의 조건이 조용히 바뀐다.

     그래서 원래 값을 보관하고 끝나면 되돌린다.
  */
  let savedSettings: Awaited<ReturnType<PgPointsRepo['getSettings']>> | null = null;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL });
    repo = new PgPointsRepo(pool);
    savedSettings = await repo.getSettings();
  });

  afterAll(async () => {
    // 사용자를 지우면 원장도 ON DELETE CASCADE 로 함께 사라진다.
    await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`%${TEST_EMAIL_SUFFIX}`]);
    /*
       상품은 지우지 않는다 — 사용 기록이 참조한다. 사용자를 지우면 원장과
       사용 기록은 CASCADE 로 사라지지만, 상품 자체는 남는 것이 옳다.
    */
    await pool.query(`DELETE FROM point_catalog WHERE id LIKE 'test_%'`).catch(() => {});

    // 제도 조건을 원래대로 되돌린다 (공유 상태 오염 방지).
    if (savedSettings) {
      await repo.updateSettings(
        {
          enabled: savedSettings.enabled,
          unitName: savedSettings.unitName,
          purchaseEnabled: savedSettings.purchaseEnabled,
          expiryDays: savedSettings.expiryDays,
          referralAsPoints: savedSettings.referralAsPoints,
          referralPoints: savedSettings.referralPoints,
        },
        savedSettings.updatedBy ?? null,
      ).catch(() => { /* 되돌리기 실패가 테스트 실패로 번지지 않게 한다 */ });
    }
    await pool.end();
  });

  /*
     상품 ID 를 테스트마다 새로 만든다.

     ★ 상품을 지우려 하면 point_redemptions 외래키가 막는다 — 그것이 옳다.
       사용 기록이 있는 상품을 지우면 "무엇을 샀는지" 를 알 수 없게 된다.
       그래서 정리하지 않고 새 ID 를 쓴다.
  */
  let itemId: string;

  beforeEach(async () => {
    userA = await makeUser();
    userB = await makeUser();
    itemId = `test_${randomUUID().slice(0, 8)}`;
    await repo.upsertCatalog({
      id: itemId, nameKey: 'pt_x', descKey: null, kind: 'ai_run',
      cost: 100, grants: 5, enabled: true, sortOrder: 0,
    });
  });

  it('원장이 없으면 잔액은 0이다', async () => {
    expect(await repo.balanceOf(userA)).toBe(0);
  });

  it('적립하면 잔액이 늘고 balance_after 가 함께 기록된다', async () => {
    const e1 = await repo.grant({ userId: userA, amount: 300, reason: 'event_reward' });
    const e2 = await repo.grant({ userId: userA, amount: 200, reason: 'event_reward' });
    expect(e1?.balanceAfter).toBe(300);
    expect(e2?.balanceAfter).toBe(500);
    expect(await repo.balanceOf(userA)).toBe(500);
  });

  it('사용자별로 잔액이 격리된다', async () => {
    await repo.grant({ userId: userA, amount: 100, reason: 'event_reward' });
    expect(await repo.balanceOf(userB)).toBe(0);
  });

  /*
     같은 근거로 두 번 적립되지 않는다.

     초대 보상처럼 이벤트가 재전송될 수 있는 경로에서 중요하다. 두 번 주면
     부채가 실제보다 커진다. 예외가 아니라 null 을 돌려준다 — 재시도는
     오류가 아니고, 호출자가 특별히 처리할 일이 없다.
  */
  it('같은 근거로 두 번 적립하지 않는다', async () => {
    const first = await repo.grant({
      userId: userA, amount: 500, reason: 'referral_signup', refType: 'referred_user', refId: userB,
    });
    const second = await repo.grant({
      userId: userA, amount: 500, reason: 'referral_signup', refType: 'referred_user', refId: userB,
    });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await repo.balanceOf(userA)).toBe(500);
  });

  it('회수는 삭제가 아니라 반대 항목 추가다', async () => {
    await repo.grant({ userId: userA, amount: 300, reason: 'admin_grant', memo: '오적립' });
    await repo.revoke({ userId: userA, amount: 100, memo: '정정' });
    const h = await repo.history(userA, 10);
    // 원장은 추가만 한다 — 두 항목이 모두 남아야 한다.
    expect(h).toHaveLength(2);
    expect(await repo.balanceOf(userA)).toBe(200);
  });

  it('잔액보다 많이 회수할 수 없다', async () => {
    await repo.grant({ userId: userA, amount: 50, reason: 'event_reward' });
    await expect(repo.revoke({ userId: userA, amount: 100, memo: 'x' })).rejects.toThrow('INSUFFICIENT_POINTS');
    expect(await repo.balanceOf(userA)).toBe(50);
  });

  it('잔액이 부족하면 사용할 수 없다', async () => {
    await repo.grant({ userId: userA, amount: 99, reason: 'event_reward' });
    await expect(repo.redeem(userA, itemId)).rejects.toThrow('INSUFFICIENT_POINTS');
  });

  it('사용하면 이용권이 생기고 잔액이 줄어든다', async () => {
    await repo.grant({ userId: userA, amount: 250, reason: 'event_reward' });
    const out = await repo.redeem(userA, itemId);
    expect(out.redemption.remaining).toBe(5);
    expect(await repo.balanceOf(userA)).toBe(150);
    expect(await repo.entitlementsOf(userA)).toEqual({ [itemId]: 5 });
  });

  it('같은 상품을 다시 살 수 있다', async () => {
    // ref_id 에 UUID 를 붙이지 않으면 UNIQUE 제약이 재구매를 막아버린다.
    await repo.grant({ userId: userA, amount: 250, reason: 'event_reward' });
    await repo.redeem(userA, itemId);
    await repo.redeem(userA, itemId);
    expect(await repo.entitlementsOf(userA)).toEqual({ [itemId]: 10 });
    expect(await repo.balanceOf(userA)).toBe(50);
  });

  it('꺼진 상품은 살 수 없다', async () => {
    await repo.upsertCatalog({
      id: itemId, nameKey: 'pt_x', descKey: null, kind: 'ai_run',
      cost: 100, grants: 5, enabled: false, sortOrder: 0,
    });
    await repo.grant({ userId: userA, amount: 500, reason: 'event_reward' });
    await expect(repo.redeem(userA, itemId)).rejects.toThrow('ITEM_DISABLED');
  });

  it('없는 상품은 살 수 없다', async () => {
    await repo.grant({ userId: userA, amount: 500, reason: 'event_reward' });
    await expect(repo.redeem(userA, 'test_nope')).rejects.toThrow('ITEM_NOT_FOUND');
  });

  it('이용권을 소비하면 하나씩 줄고, 없으면 false 다', async () => {
    await repo.grant({ userId: userA, amount: 100, reason: 'event_reward' });
    await repo.redeem(userA, itemId);
    for (let i = 0; i < 5; i += 1) expect(await repo.consume(userA, itemId)).toBe(true);
    // 다 쓴 뒤에는 false — 그때 기능을 실행하면 무료로 제공하는 셈이 된다.
    expect(await repo.consume(userA, itemId)).toBe(false);
    expect(await repo.entitlementsOf(userA)).toEqual({});
  });

  /*
     ★★ 이중 사용 방지 ★★

     잔액 250 · 상품 100 → 최대 2건만 성공해야 한다.
     잠금이 없으면 5건이 같은 잔액(250)을 읽고 전부 통과해 잔액이 -250 이 된다.
  */
  it('동시에 사용해도 잔액을 넘지 않는다', async () => {
    await repo.grant({ userId: userA, amount: 250, reason: 'event_reward' });

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => repo.redeem(userA, itemId)),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;

    expect(ok).toBe(2);
    expect(await repo.balanceOf(userA)).toBe(50);
    // 음수 잔액이 하나라도 있으면 잠금이 새고 있다는 뜻이다.
    const h = await repo.history(userA, 20);
    expect(h.every((x) => x.balanceAfter >= 0)).toBe(true);
  });

  it('동시에 적립해도 balance_after 가 어긋나지 않는다', async () => {
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        repo.grant({ userId: userA, amount: 10, reason: 'event_reward', refType: 'test', refId: `c${i}` }),
      ),
    );
    expect(await repo.balanceOf(userA)).toBe(80);
    // 원장 정합성 검사가 아무것도 잡지 않아야 한다.
    expect(await repo.audit(20)).toEqual([]);
  });

  it('부채 집계가 잔액 합과 일치한다', async () => {
    await repo.grant({ userId: userA, amount: 300, reason: 'event_reward' });
    await repo.grant({ userId: userB, amount: 200, reason: 'event_reward' });
    await repo.redeem(userA, itemId);

    const t = await repo.totals();
    const a = await repo.balanceOf(userA);
    const b = await repo.balanceOf(userB);
    // 다른 테스트가 남긴 사용자가 있을 수 있으므로 '이상' 으로 확인한다.
    expect(t.outstanding).toBeGreaterThanOrEqual(a + b);
    expect(t.holders).toBeGreaterThanOrEqual(2);
    expect(t.grantedTotal).toBeGreaterThanOrEqual(500);
    expect(t.redeemedTotal).toBeGreaterThanOrEqual(100);
  });

  it('제도 조건을 저장하고 다시 읽는다', async () => {
    const s = await repo.updateSettings(
      { enabled: true, unitName: 'Credits', purchaseEnabled: false, expiryDays: 90, referralAsPoints: true, referralPoints: 300 },
      userB,
    );
    expect(s.enabled).toBe(true);
    expect(s.referralPoints).toBe(300);
    const again = await repo.getSettings();
    expect(again.unitName).toBe('Credits');
    expect(again.expiryDays).toBe(90);
  });

  it('소수 포인트는 거부된다', async () => {
    /*
       조용히 버리거나 반올림하지 않고 거부한다.

       10.7 을 10 으로 만들면 사용자는 왜 줄었는지 모르고, 11 로 만들면 우리가
       요청보다 많은 부채를 진다. 어느 쪽도 설명할 수 없다.
    */
    await expect(repo.grant({ userId: userA, amount: 10.7, reason: 'event_reward' }))
      .rejects.toThrow('POINTS_MUST_BE_INTEGER');
    expect(await repo.balanceOf(userA)).toBe(0);
  });

  it('0 포인트는 적립되지 않는다', async () => {
    await expect(repo.grant({ userId: userA, amount: 0, reason: 'event_reward' })).rejects.toThrow();
  });

  it('없는 사용자에게는 적립되지 않는다', async () => {
    await expect(repo.grant({ userId: randomUUID(), amount: 10, reason: 'event_reward' }))
      .rejects.toThrow();
  });
});
