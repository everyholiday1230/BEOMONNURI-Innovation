import { Hono } from 'hono';
import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

/**
 * 대회 리더보드 — trade_journal 실현손익 순위 (공개·읽기 전용).
 *
 * ★ 정직성 규칙
 *   · 서버가 DB 에서 직접 집계한다. 클라이언트가 순위·손익을 제출하는 경로는 없다.
 *   · 사용자는 익명 별칭(Trader#XXXXXX)으로 표시된다 — 이메일·이름은 절대 내보내지 않는다.
 *   · disclosure 로 이 순위가 실거래(LIVE) 기준인지 모의(PAPER) 기준인지 함께 알린다.
 *     모의 순위를 실거래 순위처럼 보여주면 안 된다.
 */

export interface LeaderboardDeps {
  db: Database.Database;
  pool: { query: (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> } | null;
  disclosure: 'LIVE' | 'PAPER';
}

const corr = () => Math.random().toString(36).slice(2, 10);

/** 기간 창 → 거슬러 볼 밀리초. `all` 은 제한 없음. */
const WINDOWS: Record<string, number | null> = { '7d': 7 * 86_400_000, '30d': 30 * 86_400_000, all: null };

/**
 * 익명 별칭.
 *
 * ★★ **user_id 를 그대로 잘라 쓰지 않는다.**
 *
 *   예전에는 `userId.replace(/-/g,'').slice(-6).toUpperCase()` 였다. 이것은 익명화가
 *   아니라 **user_id 의 뒤 6자를 공개하는 것**이다. 리더보드는 로그인 없이 볼 수 있는
 *   공개 API 이므로, 어딘가에서 user_id 를 한 번 본 사람은 그 사람이 순위표에 있는지,
 *   몇 위인지, 손익이 얼마인지를 바로 알 수 있었다.
 *
 *   해시로 바꾸면 별칭에서 user_id 로 되돌아갈 수 없다. 같은 사람은 항상 같은
 *   별칭이므로 순위표의 연속성(어제 본 Trader#A1B2C3 가 오늘도 같은 사람)은 유지된다.
 *
 * ★ 도메인 문자열을 섞는다 — 다른 곳에서 같은 방식으로 만든 해시와 값이 겹치지 않게.
 * ★ 6자(24비트)는 표시용 길이다. 사용자가 늘면 서로 다른 두 사람이 같은 별칭이 될
 *   수 있다. 순위 자체는 user_id 로 집계하므로 **집계가 섞이지는 않는다** — 표시만
 *   같아진다. 실제로 문제가 될 규모가 되면 길이를 늘린다.
 */
const aliasFor = (userId: string) =>
  `Trader#${createHash('sha256').update(`chartcontrol:leaderboard:${userId}`).digest('hex').slice(0, 6).toUpperCase()}`;

export function createLeaderboardRouter(deps: LeaderboardDeps) {
  const app = new Hono();

  app.get('/competition/leaderboard', async (c) => {
    const w = String(c.req.query('window') ?? 'all');
    const spanMs = WINDOWS[w];
    if (spanMs === undefined) {
      return c.json({ error: { code: 'BAD_WINDOW', message: 'window must be one of 7d|30d|all', correlationId: corr() } }, 400);
    }
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));

    /*
       ★★ **기간(ms)이 아니라 시각(epoch ms)으로 비교한다.**

         예전에는 `WHERE closed_at >= ?` 에 `spanMs`(7일 = 604,800,000)를 그대로
         넣었다. epoch 로 치면 1970-01-08 이라서 **모든 기록이 통과했다** — 7d·30d
         창이 사실상 전체 기간과 같았다. 대회 상금을 이 집계로 지급하면 기간을
         지키지 않은 순위로 지급하게 된다.
    */
    const since = spanMs === null ? null : Date.now() - spanMs;

    /*
       ★★ **금액 컬럼이 TEXT 다 — 반드시 숫자로 캐스팅한다.**

         `trade_journal.realized_pnl`·`fees` 는 TEXT NOT NULL 이다
         (infrastructure/postgres/0010_phase8_analytics.postgres.sql). 부동소수점
         반올림을 피하려고 문자열로 저장하는 이 저장소의 방식이다.

         SQLite 는 SUM(TEXT) 를 조용히 숫자로 바꿔 주지만 **Postgres 는 에러다**:
         `function sum(text) does not exist`. 운영은 Postgres 로 돈다. 즉 이
         엔드포인트는 운영에서 500 이었고, 테스트가 SQLite 만 써서 통과했다.

       ★ 방언별로 캐스팅 문법이 다르므로 SQL 을 나눠 만든다. 두 경로가 같은
         결과를 내는지는 테스트가 양쪽 DB 로 확인한다.
    */
    const isPg = Boolean(deps.pool);
    const num = (col: string) => (isPg ? `COALESCE(NULLIF(${col},'')::numeric,0)` : `CAST(COALESCE(${col},'0') AS REAL)`);
    const where = since === null ? '' : ` WHERE closed_at >= ${isPg ? '$1' : '?'}`;
    const sql =
      `SELECT user_id, COUNT(*) AS trades, SUM(${num('realized_pnl')}) AS pnl, SUM(${num('fees')}) AS fees,` +
      ` SUM(CASE WHEN ${num('realized_pnl')} > 0 THEN 1 ELSE 0 END) AS wins` +
      ` FROM trade_journal${where}` +
      ` GROUP BY user_id ORDER BY pnl DESC LIMIT ${limit}`;
    const params = since === null ? [] : [since];
    let rows: { user_id: string; trades: number; pnl: string | null; fees: string | null; wins: number }[];
    if (deps.pool) {
      const res = await deps.pool.query(sql, params);
      rows = res.rows as typeof rows;
    } else {
      rows = deps.db.prepare(sql).all(...params) as typeof rows;
    }
    const entries = rows.map((row, i) => {
      const trades = Number(row.trades) || 0;
      const wins = Number(row.wins) || 0;
      return {
        rank: i + 1,
        alias: aliasFor(String(row.user_id)),
        realizedPnl: Number(row.pnl ?? 0),
        fees: Number(row.fees ?? 0),
        trades,
        winRate: trades > 0 ? wins / trades : 0,
      };
    });
    return c.json({
      window: w,
      disclosure: deps.disclosure,
      source: 'trade_journal',
      generatedAt: new Date().toISOString(),
      entries,
    });
  });

  return app;
}
