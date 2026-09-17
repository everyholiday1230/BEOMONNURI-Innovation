import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { createPool } from '../db/pg';
import { createIsolatedTestDatabase } from './helpers/pg-test-db';
import { createLeaderboardRouter } from '../competition/leaderboard-routes';

/**
 * 리더보드 집계 규칙 테스트.
 *  · 실현손익 내림차순 순위  · 익명 별칭(user_id 를 되돌릴 수 없다)  · 기간 창 필터  · 승률
 *
 * ★★ **Postgres 경로를 반드시 함께 시험한다.**
 *
 *   이 스위트가 SQLite 만 쓰던 동안 운영(Postgres)에서는 이 엔드포인트가 500 이었다.
 *   `realized_pnl`·`fees` 가 TEXT 컬럼인데 `SUM(text)` 가 Postgres 에는 없는 함수다.
 *   SQLite 는 조용히 숫자로 바꿔 주기 때문에 시험은 초록색이었다. "시험이 통과한다"
 *   와 "운영에서 동작한다" 가 다른 전형적인 경우다.
 */
describe('competition leaderboard', () => {
  const now = Date.now();
  /* 40일 전 — 7d·30d 창에서 모두 빠져야 한다. */
  const old = now - 40 * 86_400_000;

  const SEED: [string, string, string, string, number][] = [
    ['j1', 'u1-aaaa', '300', '1.5', now],
    ['j2', 'u1-aaaa', '200', '1.0', now],
    ['j3', 'u2-bbbb', '250', '2.0', now],
    ['j4', 'u3-cccc', '-100', '0.5', now],
    ['j5', 'u2-bbbb', '-500', '0.5', old],
  ];

  /** 구현과 같은 방식으로 기대 별칭을 만든다 — user_id 를 그대로 자르지 않는다. */
  const alias = (userId: string) =>
    `Trader#${createHash('sha256').update(`chartcontrol:leaderboard:${userId}`).digest('hex').slice(0, 6).toUpperCase()}`;

  const db = new Database(':memory:');
  beforeAll(() => {
    db.exec(`CREATE TABLE trade_journal (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, symbol TEXT, side TEXT,
      entry_price TEXT, exit_price TEXT, size TEXT, realized_pnl TEXT,
      fees TEXT, roi_pct TEXT, closed_at INTEGER, note TEXT)`);
    const ins = db.prepare(
      'INSERT INTO trade_journal (id, user_id, realized_pnl, fees, closed_at) VALUES (?,?,?,?,?)');
    for (const r of SEED) ins.run(...r);
  });

  const mount = () => {
    const app = new Hono();
    app.route('/api', createLeaderboardRouter({ db, pool: null, disclosure: 'PAPER' }));
    return app;
  };

  it('실현손익 내림차순으로 순위를 매기고 익명 별칭을 준다', async () => {
    const res = await mount().request('/api/competition/leaderboard?window=all');
    expect(res.status).toBe(200);
    const j: any = await res.json();
    expect(j.disclosure).toBe('PAPER');
    expect(j.entries[0].alias).toMatch(/^Trader#[0-9A-F]{6}$/);
    expect(j.entries[0].realizedPnl).toBe(500); // u1: 300+200
    expect(j.entries[1].realizedPnl).toBe(-100); // u3
    expect(j.entries[2].realizedPnl).toBe(-250); // u2: 250-500(all)
  });

  /**
   * ★★ 별칭에서 user_id 로 되돌아갈 수 없어야 한다.
   *
   *   예전 구현은 `user_id` 의 뒤 6자를 대문자로 바꿔 붙였다(`u2-bbbb` → `U2BBBB`).
   *   이메일이 없으니 익명처럼 보였지만, 실제로는 **user_id 조각을 공개**하는 것이다.
   *   리더보드는 로그인 없이 볼 수 있어서 조각만으로 대조가 가능했다.
   */
  it('별칭이 user_id 에서 유도 가능한 문자열이 아니다', async () => {
    const res = await mount().request('/api/competition/leaderboard?window=all');
    const text = await res.text();
    for (const [, userId] of SEED) {
      const naive = userId.replace(/-/gu, '').slice(-6).toUpperCase();
      expect(text, `user_id 조각이 그대로 나갔다: ${naive}`).not.toContain(naive);
      expect(text).not.toContain(userId);
    }
    expect(text).not.toContain('@');
  });

  it('기간 창(7d)이 오래된 기록을 제외한다', async () => {
    const j: any = await (await mount().request('/api/competition/leaderboard?window=7d')).json();
    const u2 = j.entries.find((e: any) => e.alias === alias('u2-bbbb'));
    expect(u2, '7d 창에 u2 가 없다').toBeTruthy();
    expect(u2.realizedPnl).toBe(250); // 40일 전 -500 은 제외
    expect(u2.trades).toBe(1);
  });

  it('기간 창(30d)도 40일 전 기록을 제외한다', async () => {
    const j: any = await (await mount().request('/api/competition/leaderboard?window=30d')).json();
    const u2 = j.entries.find((e: any) => e.alias === alias('u2-bbbb'));
    expect(u2.realizedPnl).toBe(250);
  });

  it('all 창은 오래된 기록을 포함한다 — 창 필터가 켜져 있다는 대조군', async () => {
    const j: any = await (await mount().request('/api/competition/leaderboard?window=all')).json();
    const u2 = j.entries.find((e: any) => e.alias === alias('u2-bbbb'));
    expect(u2.realizedPnl).toBe(-250);
    expect(u2.trades).toBe(2);
  });

  it('알 수 없는 window 는 400 이다', async () => {
    const res = await mount().request('/api/competition/leaderboard?window=1y');
    expect(res.status).toBe(400);
  });

  it('승률을 계산한다', async () => {
    const j: any = await (await mount().request('/api/competition/leaderboard?window=all')).json();
    const u1 = j.entries[0];
    expect(u1.trades).toBe(2);
    expect(u1.winRate).toBe(1);
  });
});

/*
   ★★★ 운영과 같은 DB(Postgres)로 같은 검증을 한다.

     TEXT 컬럼 합산·정렬·기간 필터가 실제 방언에서 동작하는지 본다. 여기가 비어
     있던 탓에 `SUM(text)` 오류가 운영까지 갔다.
*/
const PG_URL = process.env.PG_TEST_URL;
describe.skipIf(!PG_URL)('competition leaderboard — Postgres 경로', () => {
  let pool: Pool;
  const now = Date.now();
  const old = now - 40 * 86_400_000;

  beforeAll(async () => {
    pool = createPool(await createIsolatedTestDatabase(PG_URL!, 'competition_leaderboard'));
    /*
       운영 스키마와 같은 컬럼 타입을 쓴다 — 금액은 TEXT, 시각은 BIGINT.
       (infrastructure/postgres/0010_phase8_analytics.postgres.sql)
       users 외래키는 이 시험의 대상이 아니므로 두지 않는다.
    */
    await pool.query(`CREATE TABLE trade_journal (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, symbol TEXT, side TEXT,
      entry_price TEXT, exit_price TEXT, size TEXT, realized_pnl TEXT NOT NULL,
      fees TEXT, roi_pct TEXT, opened_at BIGINT, closed_at BIGINT NOT NULL, note TEXT)`, []);
    const rows: [string, string, string, string, number][] = [
      ['p1', 'u1-aaaa', '300', '1.5', now],
      ['p2', 'u1-aaaa', '200', '1.0', now],
      ['p3', 'u2-bbbb', '250', '2.0', now],
      ['p4', 'u3-cccc', '-100', '0.5', now],
      ['p5', 'u2-bbbb', '-500', '0.5', old],
    ];
    for (const r of rows) {
      await pool.query(
        'INSERT INTO trade_journal (id, user_id, realized_pnl, fees, closed_at) VALUES ($1,$2,$3,$4,$5)', r);
    }
  }, 60_000);

  afterAll(async () => { if (pool) await pool.end(); });

  const mountPg = () => {
    const app = new Hono();
    /* db 는 Postgres 경로에서 쓰이지 않지만 타입이 요구한다. */
    app.route('/api', createLeaderboardRouter({
      db: new Database(':memory:'), pool, disclosure: 'LIVE',
    }));
    return app;
  };

  it('TEXT 금액 컬럼을 합산한다 — SUM(text) 로 500 이 나지 않는다', async () => {
    const res = await mountPg().request('/api/competition/leaderboard?window=all');
    /* ★ 본문은 한 번만 읽는다 — text() 뒤에 json() 을 부르면 "Body already read" 다. */
    const body = await res.text();
    expect(res.status, body).toBe(200);
    const j: any = JSON.parse(body);
    expect(j.disclosure).toBe('LIVE');
    expect(j.entries[0].realizedPnl).toBe(500);
    expect(j.entries[0].trades).toBe(2);
    expect(j.entries[0].fees).toBeCloseTo(2.5, 6);
  });

  it('기간 창이 Postgres 에서도 동작한다', async () => {
    const j: any = await (await mountPg().request('/api/competition/leaderboard?window=7d')).json();
    const total = j.entries.reduce((a: number, e: any) => a + e.trades, 0);
    expect(total, '40일 전 기록이 7d 창에 남아 있다').toBe(4);
  });

  it('승률 계산이 TEXT 비교가 아니라 숫자 비교다', async () => {
    const j: any = await (await mountPg().request('/api/competition/leaderboard?window=all')).json();
    /* '-100' 은 문자열로 비교하면 '0' 보다 크다고 나온다 — 숫자로 비교해야 승률 0 이다. */
    const loser = j.entries.find((e: any) => e.realizedPnl === -100);
    expect(loser.winRate).toBe(0);
  });
});
