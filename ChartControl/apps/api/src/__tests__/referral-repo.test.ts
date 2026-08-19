/**
 * 친구 초대(리퍼럴) 저장소 테스트.
 *
 * 여기서 지키는 것
 * --------------
 * 1. **제도가 꺼져 있으면 아무것도 만들지 않는다.** 코드를 먼저 뿌리면 조건
 *    없이 초대가 일어나고, 나중에 조건을 정할 때 소급 적용 분쟁이 된다.
 *
 * 2. **중복 보상 경로를 막는다.** 자기 자신 초대, 한 사람이 두 코드에 귀속.
 *    둘 다 같은 사람에게 두 번 지급하는 결과가 된다.
 *
 * 3. **조건 스냅샷을 보존한다.** 가입 시점 비율을 박아둬야 소급 인하/인상이
 *    이미 초대된 건에 영향을 주지 않는다.
 *
 * 4. **적립액을 계산하지 않는다.** 요약에는 실제 지급 합계만 있고, 우리가
 *    추정한 예상 금액 필드가 없어야 한다 — 있으면 화면이 그것을 보여준다.
 */

import { randomUUID } from 'node:crypto';

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PgReferralRepo, normalizeCode } from '../db/referral-repo';

const URL = process.env.PG_TEST_URL;
const d = URL ? describe : describe.skip;

d('PgReferralRepo', () => {
  let pool: pg.Pool;
  let repo: PgReferralRepo;
  let alice: string;
  let bob: string;
  let carol: string;
  let admin: string;

  const mkUser = async () => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, role, status)
       VALUES ($1, $2, 'x', 'USER', 'active') ON CONFLICT DO NOTHING`,
      [id, `ref-${id.slice(0, 8)}@test.local`],
    );
    return id;
  };

  /** 제도를 켠다. 대부분의 검사가 켜진 상태를 전제한다. */
  const enable = (sharePct = 20) =>
    repo.updateSettings(
      { enabled: true, sharePct, minPayout: 10, payoutCurrency: 'USDT', payoutNote: 'Paid manually each month' },
      admin,
    );

  /** 운영 중인 제도 조건. 테스트가 끝나면 이 값으로 되돌린다. */
  let savedSettings: Awaited<ReturnType<PgReferralRepo['getSettings']>> | null = null;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: URL });
    repo = new PgReferralRepo(pool);
    savedSettings = await repo.getSettings();
    alice = await mkUser();
    bob = await mkUser();
    carol = await mkUser();
    admin = await mkUser();
  });

  /*
     ★★ 정리 범위를 테스트가 만든 것으로 한정한다 ★★

       전에는 `DELETE FROM referral_payouts` 처럼 **조건 없이** 지웠다.
       PG_TEST_URL 이 실수로 운영 DB 를 가리키면 실제 추천 코드·가입 귀속·
       지급 기록이 전부 사라진다. 되돌릴 방법이 없다 — 지급 기록은 우리가
       누구에게 얼마를 줬는지의 유일한 증거다.

       테스트 사용자에 딸린 행만 지운다. 사용자를 지우면 나머지는 외래키
       CASCADE 로 함께 사라진다.

     ★ referral_settings 는 단일행 공유 상태다.
       삭제하면 제도가 꺼진다. 실제로 겪었다: 테스트를 돌린 뒤 리퍼럴 제도가
       꺼져 있어 화면에서 코드가 사라졌다. 원래 값을 보관하고 되돌린다.
  */
  const scrub = async () => {
    const ids = [alice, bob, carol, admin].filter(Boolean);
    if (!ids.length) return;
    await pool.query('DELETE FROM referral_payouts WHERE referrer_user_id = ANY($1)', [ids]);
    await pool.query(
      'DELETE FROM referral_signups WHERE referrer_user_id = ANY($1) OR referred_user_id = ANY($1)',
      [ids],
    );
    await pool.query('DELETE FROM referral_codes WHERE user_id = ANY($1)', [ids]);
  };

  afterAll(async () => {
    await scrub();
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[alice, bob, carol, admin]]);

    // 제도 조건을 원래대로 되돌린다.
    if (savedSettings) {
      await repo.updateSettings(
        {
          enabled: savedSettings.enabled,
          sharePct: savedSettings.sharePct,
          minPayout: savedSettings.minPayout,
          payoutCurrency: savedSettings.payoutCurrency,
          payoutNote: savedSettings.payoutNote,
        },
        admin,
      ).catch(() => { /* 되돌리기 실패가 테스트 실패로 번지지 않게 한다 */ });
    }
    await pool.end();
  });

  beforeEach(async () => {
    await scrub();
    /*
       각 검사는 '제도 조건 없음' 에서 시작해야 한다.

       설정 행을 지우는 대신 **꺼진 값으로 덮어쓴다** — 지우면 다른 곳이
       참조하는 공유 행이 사라진다. getSettings() 는 행이 없을 때도 꺼진 값을
       주므로 결과는 같고, 부작용만 없다.
    */
    await repo.updateSettings(
      { enabled: false, sharePct: 0, minPayout: 0, payoutCurrency: 'USDT', payoutNote: null },
      admin,
    ).catch(() => { /* 조건 검증(payoutNote 필수 등)이 막으면 그대로 둔다 */ });
  });

  // ---- 제도 꺼진 상태 ----

  it('설정이 없으면 꺼진 상태를 돌려준다 — null 이 아니다', async () => {
    const s = await repo.getSettings();
    // null 을 주면 호출자가 검사를 잊고 조건이 있는 것처럼 진행한다.
    expect(s.enabled).toBe(false);
    expect(s.sharePct).toBe(0);
  });

  it('제도가 꺼져 있으면 코드를 발급하지 않는다', async () => {
    expect(await repo.issueCode(alice)).toBeNull();
    expect(await repo.findCodeByUser(alice)).toBeNull();
  });

  it('제도가 꺼져 있으면 귀속하지 않는다', async () => {
    // 코드 자체가 없으므로 임의 코드로도 귀속되지 않는다.
    expect(await repo.attribute('ANYCODE1', bob)).toBe(false);
  });

  // ---- 코드 ----

  it('제도를 켜면 코드를 발급한다 (멱등)', async () => {
    await enable();
    const first = await repo.issueCode(alice);
    expect(first).not.toBeNull();
    expect(first!.code).toMatch(/^[A-Z2-9]{8}$/);

    // 두 번 불러도 같은 코드다 — 코드가 바뀌면 이미 공유한 링크가 죽는다.
    const second = await repo.issueCode(alice);
    expect(second!.code).toBe(first!.code);
  });

  it('코드에 혼동되는 글자를 쓰지 않는다', async () => {
    await enable();
    // 0/O, 1/I/L 을 빼야 손으로 적거나 말로 전달할 때 틀리지 않는다.
    for (let i = 0; i < 12; i += 1) {
      const u = await mkUser();
      const c = await repo.issueCode(u);
      expect(c!.code).not.toMatch(/[01OIL]/);
      await pool.query('DELETE FROM referral_codes WHERE user_id = $1', [u]);
      await pool.query('DELETE FROM users WHERE id = $1', [u]);
    }
  });

  it('코드 입력을 정규화한다 — 소문자·하이픈·공백을 허용', () => {
    expect(normalizeCode('ab-cd 12')).toBe('ABCD12');
    expect(normalizeCode('  x7rf6f7n ')).toBe('X7RF6F7N');
    expect(normalizeCode('')).toBe('');
  });

  it('소문자 코드로도 찾는다', async () => {
    await enable();
    const c = await repo.issueCode(alice);
    const found = await repo.findCode(c!.code.toLowerCase());
    expect(found?.code).toBe(c!.code);
  });

  // ---- 귀속 ----

  it('코드로 귀속한다', async () => {
    await enable(25);
    const c = await repo.issueCode(alice);
    expect(await repo.attribute(c!.code, bob)).toBe(true);

    const list = await repo.listByReferrer(alice);
    expect(list).toHaveLength(1);
    expect(list[0]!.referredUserId).toBe(bob);
    // 가입 시점 비율이 박혀 있다.
    expect(list[0]!.sharePctAtSignup).toBe(25);
  });

  it('자기 코드로는 귀속되지 않는다 — 자기 자신에게 보상할 수 없다', async () => {
    await enable();
    const c = await repo.issueCode(alice);
    expect(await repo.attribute(c!.code, alice)).toBe(false);
    expect(await repo.listByReferrer(alice)).toHaveLength(0);
  });

  it('한 사람이 두 코드에 귀속되지 않는다 — 이중 지급 방지', async () => {
    await enable();
    const ca = await repo.issueCode(alice);
    const cc = await repo.issueCode(carol);

    expect(await repo.attribute(ca!.code, bob)).toBe(true);
    // 두 번째 시도는 실패한다.
    expect(await repo.attribute(cc!.code, bob)).toBe(false);

    expect(await repo.listByReferrer(alice)).toHaveLength(1);
    expect(await repo.listByReferrer(carol)).toHaveLength(0);
  });

  it('없는 코드는 무시한다 (예외를 던지지 않는다)', async () => {
    await enable();
    // 회원가입이 리퍼럴 때문에 실패하면 안 된다.
    await expect(repo.attribute('NOSUCHCD', bob)).resolves.toBe(false);
  });

  it('비활성 코드로는 귀속되지 않는다', async () => {
    await enable();
    const c = await repo.issueCode(alice);
    await pool.query('UPDATE referral_codes SET disabled = TRUE WHERE code = $1', [c!.code]);
    expect(await repo.attribute(c!.code, bob)).toBe(false);
  });

  it('조건을 바꿔도 이미 귀속된 건의 비율은 유지된다', async () => {
    await enable(20);
    const c = await repo.issueCode(alice);
    await repo.attribute(c!.code, bob);

    // 비율을 내린다.
    await repo.updateSettings(
      { enabled: true, sharePct: 5, minPayout: 10, payoutCurrency: 'USDT', payoutNote: 'Manual payout' },
      admin,
    );

    const list = await repo.listByReferrer(alice);
    // 소급 인하는 분쟁이 된다. 가입 시점 값이 남아야 한다.
    expect(list[0]!.sharePctAtSignup).toBe(20);

    // 새 귀속은 새 비율을 쓴다.
    await repo.attribute(c!.code, carol);
    const after = await repo.listByReferrer(alice);
    expect(after.find((x) => x.referredUserId === carol)!.sharePctAtSignup).toBe(5);
  });

  // ---- 단계 ----

  it('단계 도달을 기록하고 최초 시각을 보존한다', async () => {
    await enable();
    const c = await repo.issueCode(alice);
    await repo.attribute(c!.code, bob);

    expect(await repo.markMilestone(bob, 'first_trade')).toBe(true);
    const first = (await repo.listByReferrer(alice))[0]!.firstTradeAt;
    expect(first).toBeTypeOf('number');

    await new Promise((r) => setTimeout(r, 30));
    await repo.markMilestone(bob, 'first_trade');
    const second = (await repo.listByReferrer(alice))[0]!.firstTradeAt;
    // 두 번째 거래로 시각이 밀리면 언제부터 수익이 발생했는지 알 수 없다.
    expect(second).toBe(first);
  });

  it('귀속되지 않은 사용자의 단계는 기록되지 않는다', async () => {
    await enable();
    expect(await repo.markMilestone(carol, 'first_trade')).toBe(false);
  });

  // ---- 지급 ----

  it('지급을 기록하고 합계에 반영한다', async () => {
    await enable();
    await repo.issueCode(alice);
    await repo.recordPayout(
      { referrerUserId: alice, amount: 12.5, currency: 'USDT', method: 'KuCoin 송금', reference: 'tx-1' },
      admin,
    );
    await repo.recordPayout(
      { referrerUserId: alice, amount: 7.25, currency: 'USDT', method: 'KuCoin 송금' },
      admin,
    );

    const s = await repo.summaryFor(alice);
    expect(s.paidTotal).toBeCloseTo(19.75, 6);
    expect(s.payoutCount).toBe(2);
    expect(s.lastPaidAt).toBeTypeOf('number');
  });

  it('요약에 적립 예정액 필드가 없다 — 우리가 계산하지 않는다', async () => {
    await enable();
    const s = await repo.summaryFor(alice);
    /*
       필드가 있으면 화면이 그것을 보여준다. 우리 수익은 거래소가 산정하고
       우리 DB 에 없으므로, 추정치를 노출하면 실제 지급액과 어긋난다.
    */
    expect(s).not.toHaveProperty('pendingAmount');
    expect(s).not.toHaveProperty('accrued');
    expect(s).not.toHaveProperty('estimatedEarnings');
    expect(Object.keys(s).sort()).toEqual(
      ['emailVerified', 'keysConnected', 'lastPaidAt', 'paidTotal', 'payoutCount', 'signups', 'traded'].sort(),
    );
  });

  it('음수·0 지급은 DB 가 막는다', async () => {
    await enable();
    await repo.issueCode(alice);
    await expect(
      repo.recordPayout({ referrerUserId: alice, amount: 0, currency: 'USDT', method: 'x' }, admin),
    ).rejects.toThrow();
    await expect(
      repo.recordPayout({ referrerUserId: alice, amount: -5, currency: 'USDT', method: 'x' }, admin),
    ).rejects.toThrow();
  });

  it('없는 사용자에게 지급할 수 없다', async () => {
    await enable();
    await expect(
      repo.recordPayout({ referrerUserId: randomUUID(), amount: 5, currency: 'USDT', method: 'x' }, admin),
    ).rejects.toThrow();
  });

  // ---- 관리자 목록 ----

  it('초대자 목록에 단계별 인원과 지급 합계가 함께 나온다', async () => {
    await enable();
    const c = await repo.issueCode(alice);
    await repo.attribute(c!.code, bob);
    await repo.attribute(c!.code, carol);
    await repo.markMilestone(bob, 'keys_connected');
    await repo.markMilestone(bob, 'first_trade');
    await repo.recordPayout({ referrerUserId: alice, amount: 3, currency: 'USDT', method: 'x' }, admin);

    const rows = await repo.listReferrers();
    const mine = rows.find((x) => x.userId === alice)!;
    expect(mine.signups).toBe(2);
    expect(mine.keysConnected).toBe(1);
    // 거래한 사람이 몇 명인지가 지급 판단의 근거다.
    expect(mine.traded).toBe(1);
    expect(mine.paidTotal).toBeCloseTo(3, 6);
  });

  it('조건 변경 횟수를 센다', async () => {
    /*
       version 은 **누적**된다 — 제도가 살아 있는 동안 몇 번 바뀌었는지를
       세는 값이므로 초기화되지 않는다. 그래서 절대값이 아니라 증가분을 본다.

       (전에는 매 검사 전에 설정 행을 지워서 항상 1 이었다. 행을 지우는 것은
        공유 상태를 없애는 부작용이라 그만뒀다.)
    */
    const before = (await repo.getSettings()).version;
    await enable(20);
    expect((await repo.getSettings()).version).toBe(before + 1);
    await enable(25);
    expect((await repo.getSettings()).version).toBe(before + 2);
  });

  it('사용자가 지워지면 그 사람의 코드와 귀속도 사라진다', async () => {
    await enable();
    const doomed = await mkUser();
    const c = await repo.issueCode(doomed);
    await repo.attribute(c!.code, bob);

    await pool.query('DELETE FROM users WHERE id = $1', [doomed]);

    // 코드는 CASCADE 로 사라진다(그 사람의 개인 자산이다).
    expect(await repo.findCode(c!.code)).toBeNull();
    // 지급 기록도 함께 사라진다 — 받을 사람이 없는 기록은 의미가 없다.
    expect((await repo.listReferrers()).find((x) => x.userId === doomed)).toBeUndefined();
  });
});
