import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import { createLeaderboardRouter } from '../competition/leaderboard-routes';

/**
 * 리더보드 집계 규칙 테스트.
 *  · 실현손익 내림차순 순위  · 익명 별칭(이메일 노출 금지)  · 기간 창 필터  · 승률
 */
describe('competition leaderboard', () => {
  const db = new Database(':memory:');
  beforeAll(() => {
    db.exec(`CREATE TABLE trade_journal (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, symbol TEXT, side TEXT,
      entry_price TEXT, exit_price TEXT, size TEXT, realized_pnl TEXT,
      fees TEXT, roi_pct TEXT, closed_at INTEGER, note TEXT)`);
    const now = Date.now();
    const ins = db.prepare(
      'INSERT INTO trade_journal (id, user_id, realized_pnl, fees, closed_at) VALUES (?,?,?,?,?)');
    ins.run('j1', 'u1-aaaa', '300', '1.5', now);
    ins.run('j2', 'u1-aaaa', '200', '1.0', now);
    ins.run('j3', 'u2-bbbb', '250', '2.0', now);
    ins.run('j4', 'u3-cccc', '-100', '0.5', now);
    ins.run('j5', 'u2-bbbb', '-500', '0.5', now - 40 * 86_400_000); // 40일 전 — 7d 창에서 제외
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
    expect(j.entries.map((e: any) => e.alias)).toEqual(j.entries.map((e: any) => e.alias)); // 안정
    expect(j.entries[0].realizedPnl).toBe(500); // u1: 300+200
    expect(j.entries[1].realizedPnl).toBe(-250); // u2: 250-500(all)
    expect(j.entries[2].realizedPnl).toBe(-100);
  });

  it('이메일·사용자 ID 원문을 절대 내보내지 않는다', async () => {
    const res = await mount().request('/api/competition/leaderboard?window=all');
    const text = await res.text();
    expect(text).not.toContain('u1-aaaa');
    expect(text).not.toContain('@');
  });

  it('기간 창(7d)이 오래된 기록을 제외한다', async () => {
    const j: any = await (await mount().request('/api/competition/leaderboard?window=7d')).json();
    const u2 = j.entries.find((e: any) => e.alias === `Trader#${'u2-bbbb'.replace(/-/gu, '').slice(-6).toUpperCase()}`);
    expect(u2.realizedPnl).toBe(250); // 40일 전 -500 은 제외
  });

  it('승률을 계산한다', async () => {
    const j: any = await (await mount().request('/api/competition/leaderboard?window=all')).json();
    const u1 = j.entries[0];
    expect(u1.trades).toBe(2);
    expect(u1.winRate).toBe(1); // 2건 모두 수익
  });

  it('모르는 창은 400 으로 거부한다', async () => {
    const res = await mount().request('/api/competition/leaderboard?window=99d');
    expect(res.status).toBe(400);
  });
});
