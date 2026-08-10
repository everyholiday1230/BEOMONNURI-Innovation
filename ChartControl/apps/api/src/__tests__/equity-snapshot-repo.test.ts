/**
 * 일별 자산 스냅샷 테스트.
 *
 * ★ 자산곡선은 사용자가 **성과를 판단하는 근거**다. 없던 변화를 그리거나
 *   조회 실패를 급락으로 표시하면 잘못된 판단을 유도한다. 그래서 다음 셋을
 *   테스트로 못 박는다:
 *     1. 하루 한 행 (재조회는 갱신)
 *     2. 빈 날을 채우지 않는다
 *     3. 출처(exchange / mock)를 섞지 않는다
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

import { PgEquitySnapshotRepo } from '../db/equity-snapshot-repo';

const PG_URL = process.env.PG_TEST_URL;
const d = PG_URL ? describe : describe.skip;

d('PgEquitySnapshotRepo', () => {
  let pool: Pool;
  let repo: PgEquitySnapshotRepo;
  let user: string;

  const EMAIL_SUFFIX = '@equity-test.local';

  /** N일 전 날짜 (UTC, YYYY-MM-DD). */
  const daysAgo = (n: number) => {
    const dt = new Date();
    dt.setUTCDate(dt.getUTCDate() - n);
    return dt.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL });
    repo = new PgEquitySnapshotRepo(pool);
  });

  afterAll(async () => {
    // 사용자를 지우면 스냅샷도 CASCADE 로 사라진다.
    await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`%${EMAIL_SUFFIX}`]);
    await pool.end();
  });

  beforeEach(async () => {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, role, status)
       VALUES ($1, $2, 'x', 'user', 'active')`,
      [id, `eq_${id.slice(0, 8)}${EMAIL_SUFFIX}`],
    );
    user = id;
  });

  it('스냅샷을 기록하고 읽는다', async () => {
    expect(await repo.record({ userId: user, equity: 1234.56, source: 'exchange' })).toBe(true);
    const pts = await repo.range(user);
    expect(pts).toHaveLength(1);
    expect(Number(pts[0]!.equity)).toBeCloseTo(1234.56, 6);
    expect(pts[0]!.currency).toBe('USDT');
  });

  it('하루에 한 행만 남는다 (재조회는 갱신)', async () => {
    /*
       ★ 사용자가 화면을 여러 번 열면 잔고 조회가 여러 번 일어난다. 매번 행을
         남기면 하루에 수십 개가 쌓이고 곡선이 톱니가 된다.
    */
    await repo.record({ userId: user, equity: 100, source: 'exchange' });
    await repo.record({ userId: user, equity: 200, source: 'exchange' });
    await repo.record({ userId: user, equity: 300, source: 'exchange' });

    const pts = await repo.range(user);
    expect(pts).toHaveLength(1);
    // 마지막 값으로 갱신된다.
    expect(Number(pts[0]!.equity)).toBe(300);
  });

  it('숫자가 아닌 자산은 기록하지 않는다', async () => {
    /*
       ★★ 조회 실패를 0 으로 남기면 곡선에 없던 급락이 그려지고 사용자가
         자산을 잃은 줄 안다. 숫자가 아니면 아예 기록하지 않는다.
    */
    expect(await repo.record({ userId: user, equity: Number.NaN, source: 'exchange' })).toBe(false);
    expect(await repo.record({ userId: user, equity: 'not-a-number', source: 'exchange' })).toBe(false);
    expect(await repo.range(user)).toHaveLength(0);
  });

  it('자산 0 은 기록한다', async () => {
    // 자금을 전부 뺀 상태는 유효한 값이다. 거부하면 그 사실이 사라진다.
    expect(await repo.record({ userId: user, equity: 0, source: 'exchange' })).toBe(true);
    expect(Number((await repo.range(user))[0]!.equity)).toBe(0);
  });

  it('미실현 손익은 null 을 유지한다', async () => {
    // 표시가를 모르면 손익을 모른다. 0 으로 만들면 "본전" 이라는 거짓이 된다.
    await repo.record({ userId: user, equity: 500, unrealizedPnl: null, source: 'exchange' });
    expect((await repo.range(user))[0]!.unrealizedPnl).toBeNull();
  });

  /*
     ★★ 빈 날을 채우지 않는다.

       접속하지 않은 날은 점이 없다. 앞뒤를 이어 그리면 없었던 자산 변화를
       만들고, 사용자는 그 곡선으로 성과를 판단한다.
  */
  it('빈 날을 채우지 않는다', async () => {
    await repo.record({ userId: user, equity: 100, source: 'exchange', date: daysAgo(10) });
    await repo.record({ userId: user, equity: 300, source: 'exchange', date: daysAgo(2) });

    const pts = await repo.range(user, { days: 30 });
    // 두 점 사이 7일이 비어 있어야 한다.
    expect(pts).toHaveLength(2);
    expect(pts[0]!.date).toBe(daysAgo(10));
    expect(pts[1]!.date).toBe(daysAgo(2));
  });

  it('날짜 오름차순으로 준다', async () => {
    // 화면이 그대로 이어 그리므로 순서가 뒤바뀌면 곡선이 엉킨다.
    await repo.record({ userId: user, equity: 3, source: 'exchange', date: daysAgo(1) });
    await repo.record({ userId: user, equity: 1, source: 'exchange', date: daysAgo(5) });
    await repo.record({ userId: user, equity: 2, source: 'exchange', date: daysAgo(3) });

    const pts = await repo.range(user, { days: 30 });
    expect(pts.map((p) => Number(p.equity))).toEqual([1, 2, 3]);
  });

  it('기간 밖의 점은 주지 않는다', async () => {
    await repo.record({ userId: user, equity: 10, source: 'exchange', date: daysAgo(40) });
    await repo.record({ userId: user, equity: 20, source: 'exchange', date: daysAgo(3) });

    const week = await repo.range(user, { days: 7 });
    expect(week).toHaveLength(1);
    expect(Number(week[0]!.equity)).toBe(20);
  });

  /*
     ★★ 출처를 섞지 않는다.

       거래소 실값과 모의 거래 기반 값이 한 곡선에 섞이면 사용자가 모의 성과를
       실제 성과로 읽는다.
  */
  it('출처를 섞지 않는다', async () => {
    await repo.record({ userId: user, equity: 1000, source: 'exchange' });
    await repo.record({ userId: user, equity: 9999, source: 'mock' });

    const ex = await repo.range(user, { source: 'exchange' });
    const mk = await repo.range(user, { source: 'mock' });

    expect(ex).toHaveLength(1);
    expect(Number(ex[0]!.equity)).toBe(1000);
    expect(mk).toHaveLength(1);
    expect(Number(mk[0]!.equity)).toBe(9999);
  });

  it('같은 날 두 출처가 공존한다', async () => {
    // UNIQUE 가 (user, date, source) 이므로 서로를 덮지 않아야 한다.
    await repo.record({ userId: user, equity: 1, source: 'exchange' });
    await repo.record({ userId: user, equity: 2, source: 'mock' });
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM equity_snapshots WHERE user_id = $1',
      [user],
    );
    expect(Number(rows[0].n)).toBe(2);
  });

  it('기본 출처는 거래소다', async () => {
    /*
       ★ 실서비스에서 가장 중요한 것은 실잔고 곡선이다. 기본값이 mock 이면
         모의 성과가 먼저 보인다.
    */
    await repo.record({ userId: user, equity: 55, source: 'exchange' });
    await repo.record({ userId: user, equity: 66, source: 'mock' });
    const pts = await repo.range(user);
    expect(Number(pts[0]!.equity)).toBe(55);
  });

  // ---- 요약 ----

  it('이력 요약을 준다', async () => {
    await repo.record({ userId: user, equity: 1, source: 'exchange', date: daysAgo(5) });
    await repo.record({ userId: user, equity: 2, source: 'exchange', date: daysAgo(1) });

    const s = await repo.summary(user);
    expect(s.points).toBe(2);
    expect(s.firstDate).toBe(daysAgo(5));
    expect(s.lastDate).toBe(daysAgo(1));
  });

  it('이력이 없으면 요약이 0 이다', async () => {
    const s = await repo.summary(user);
    expect(s.points).toBe(0);
    // 날짜를 지어내지 않는다.
    expect(s.firstDate).toBeNull();
    expect(s.lastDate).toBeNull();
  });

  it('사용자별로 격리된다', async () => {
    const other = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, role, status)
       VALUES ($1, $2, 'x', 'user', 'active')`,
      [other, `eq_${other.slice(0, 8)}${EMAIL_SUFFIX}`],
    );
    await repo.record({ userId: user, equity: 111, source: 'exchange' });
    expect(await repo.range(other)).toHaveLength(0);
  });

  it('기간 상한을 넘기지 않는다', async () => {
    // 무제한 조회를 허용하면 한 요청이 DB 를 오래 잡는다.
    await repo.record({ userId: user, equity: 1, source: 'exchange' });
    const pts = await repo.range(user, { days: 999_999 });
    expect(Array.isArray(pts)).toBe(true);
  });
});
