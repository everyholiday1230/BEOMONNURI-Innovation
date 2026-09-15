import { Hono } from 'hono';
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
const WINDOWS: Record<string, number | null> = { '7d': 7 * 86_400_000, '30d': 30 * 86_400_000, all: null };

const aliasFor = (userId: string) => `Trader#${userId.replace(/-/gu, '').slice(-6).toUpperCase()}`;

export function createLeaderboardRouter(deps: LeaderboardDeps) {
  const app = new Hono();

  app.get('/competition/leaderboard', async (c) => {
    const w = String(c.req.query('window') ?? 'all');
    const since = WINDOWS[w];
    if (since === undefined) {
      return c.json({ error: { code: 'BAD_WINDOW', message: 'window must be one of 7d|30d|all', correlationId: corr() } }, 400);
    }
    const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') ?? 50) || 50));
    const where = since === null ? '' : ' WHERE closed_at >= ';
    const sql =
      `SELECT user_id, COUNT(*) AS trades, SUM(realized_pnl) AS pnl, SUM(fees) AS fees,` +
      ` SUM(CASE WHEN realized_pnl > 0 THEN 1 ELSE 0 END) AS wins` +
      ` FROM trade_journal${where}${since === null ? '' : deps.pool ? '$1' : '?'}` +
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
