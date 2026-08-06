import { describe, it, expect } from 'vitest';
import { SqlitePreferencesRepo } from '../db/preferences-repo';
import { SqliteFavoritesRepo } from '../db/favorites-repo';
import { Hono } from 'hono';
import { AuthService, MailSink } from '@quantumtrade/auth';
import { MockReplayProvider } from '@quantumtrade/ai';
import { openDb } from '../db/sqlite';
import { SqliteUserRepository, SqliteSessionRepository, SqliteAuditRepository, SqliteTokenRepository } from '../db/repos';
import { ResourceRepo } from '../db/resource-repo';
import { SqliteConversationRepo, SqliteUsageRepo } from '../db/ai-repos';
import { createAuthRouter } from '../auth-routes';
import { createAiRouter, type AiRouterDeps } from '../ai-routes';
import { DEFAULT_COST_CONFIG, type ToolDataSource } from '@quantumtrade/ai';

const ORIGIN = 'http://localhost:5173';
const toolData: ToolDataSource = {
  async get_market_snapshot() { return { last: '100' }; }, async get_candles() { return []; }, async get_order_book_summary() { return { bids: 0, asks: 0 }; },
  async get_recent_trades_summary() { return { count: 0 }; }, async get_funding_rate() { return { fundingRate: null }; }, async get_market_metadata() { return {}; },
  async get_current_chart_context() { return {}; }, async get_user_visible_positions() { return []; }, async get_user_visible_open_orders() { return []; },
};

function build(aiAvailable = true, rateLimiter?: import('../security/rate-limiter').RateLimiter, aiRatePerMin?: number) {
  const db = openDb(':memory:');
  const audit = new SqliteAuditRepository(db);
  const service = new AuthService(new SqliteUserRepository(db), new SqliteSessionRepository(db), audit, {
    emailTokens: new SqliteTokenRepository(db, 'email_verification_tokens'),
    resetTokens: new SqliteTokenRepository(db, 'password_reset_tokens'),
    mail: new MailSink(),
  });
  const app = new Hono();
  app.route('/api', createAuthRouter({ service, audit, resource: new ResourceRepo(db), favorites: new SqliteFavoritesRepo(new ResourceRepo(db)), preferences: new SqlitePreferencesRepo(new ResourceRepo(db)), csrfKey: 'k', secureCookies: false, corsOrigins: [ORIGIN] }));
  const deps: AiRouterDeps = {
    service, conversations: new SqliteConversationRepo(db), usage: new SqliteUsageRepo(db), toolData,
    costConfig: DEFAULT_COST_CONFIG, csrfKey: 'k', corsOrigins: [ORIGIN], cookieName: 'qt_session',
    ai: aiAvailable ? { available: true, provider: new MockReplayProvider('mock-analyst-v1'), kind: 'mock' } : { available: false, kind: 'unavailable', reason: 'AI disabled' },
    model: 'mock-analyst-v1', maxOutputTokens: 500, store: false, maxToolCalls: 5, toolTimeoutMs: 1000,
    rateLimiter, aiRatePerMin,
  };
  app.route('/api', createAiRouter(deps));
  return { app, db };
}

function jarFrom(res: Response) { const out: Record<string, string> = {}; for (const sc of res.headers.getSetCookie?.() ?? []) { const [p] = sc.split(';'); const i = p!.indexOf('='); out[p!.slice(0, i)] = p!.slice(i + 1); } return out; }
const cj = (j: Record<string, string>) => Object.entries(j).map(([k, v]) => `${k}=${v}`).join('; ');
type App = ReturnType<typeof build>['app'];
async function req(app: App, method: string, path: string, o: { jar?: Record<string, string>; csrf?: boolean; body?: unknown } = {}) {
  const h: Record<string, string> = { 'content-type': 'application/json', origin: ORIGIN };
  if (o.jar) h['cookie'] = cj(o.jar);
  if (o.csrf && o.jar?.['qt_csrf']) h['x-csrf-token'] = o.jar['qt_csrf'];
  const init: RequestInit = { method, headers: h };
  if (method !== 'GET' && method !== 'DELETE') init.body = JSON.stringify(o.body ?? {});
  return app.request(path, init);
}
async function login(app: App, email: string) {
  await req(app, 'POST', '/api/auth/register', { body: { email, password: 'longenough123' } });
  return jarFrom(await req(app, 'POST', '/api/auth/login', { body: { email, password: 'longenough123' } }));
}

describe('Phase 4 AI API', () => {
  it('migration 0004 created ai_* tables', () => {
    const { db } = build();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    for (const t of ['ai_conversations', 'ai_messages', 'ai_runs', 'ai_tool_calls', 'ai_tool_outputs', 'ai_signals', 'chart_commands', 'chart_overlays', 'ai_usage_records', 'ai_prompt_versions', 'ai_evaluation_runs', 'ai_feedback'])
      expect(tables).toContain(t);
  });

  it('status reports availability without leaking secrets', async () => {
    const { app } = build();
    const jar = await login(app, 'a1@ex.com');
    const s = await (await req(app, 'GET', '/api/ai/status', { jar })).json() as { available: boolean; provider: string };
    expect(s.available).toBe(true);
    expect(s.provider).toBe('mock');
  });

  it('AI unavailable → copilot returns 503 (fail-closed, no silent mock)', async () => {
    const { app } = build(false);
    const jar = await login(app, 'a2@ex.com');
    const conv = { id: 'x' };
    const res = await req(app, 'POST', '/api/ai/copilot', { jar, csrf: true, body: { conversationId: conv.id, message: 'hi' } });
    expect(res.status).toBe(503);
  });

  it('[BL-11] copilot is gated by the DISTRIBUTED limiter → 429 + Retry-After before any provider work', async () => {
    // Deterministic denying limiter (stands in for the Redis limiter). The key it receives proves the
    // gate keys on user+route only, never the prompt.
    const seenKeys: string[] = [];
    const denying = {
      allow: async (key: string) => { seenKeys.push(key); return { ok: false, remaining: 0, retryAfterMs: 30_000, count: 21 }; },
    };
    const { app } = build(true, denying, 20);
    const jar = await login(app, 'a-rl@ex.com');
    const conv = await (await req(app, 'POST', '/api/ai/conversations', { jar, csrf: true, body: { title: 't' } })).json() as { id: string };
    const res = await req(app, 'POST', '/api/ai/copilot', { jar, csrf: true, body: { conversationId: conv.id, message: 'secret-prompt-should-not-be-in-key', symbol: 'BTCUSDT' } });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('RATE_LIMITED');
    // key is user+route category only; no prompt/PII.
    expect(seenKeys.some((k) => k.startsWith('ai:copilot:'))).toBe(true);
    expect(seenKeys.every((k) => !k.includes('secret-prompt'))).toBe(true);
  });

  it('[BL-11] an allowing limiter lets the request proceed (rate gate is separate from the cost budget)', async () => {
    const allowing = { allow: async () => ({ ok: true, remaining: 19, retryAfterMs: 0, count: 1 }) };
    const { app } = build(true, allowing, 20);
    const jar = await login(app, 'a-rl2@ex.com');
    const conv = await (await req(app, 'POST', '/api/ai/conversations', { jar, csrf: true, body: { title: 't' } })).json() as { id: string };
    const res = await req(app, 'POST', '/api/ai/copilot', { jar, csrf: true, body: { conversationId: conv.id, message: 'analyze BTC', symbol: 'BTCUSDT' } });
    expect(res.status).toBe(200);
  });

  it('copilot streams SSE text via mock provider and persists messages (no chain-of-thought column exposed)', async () => {
    const { app, db } = build();
    const jar = await login(app, 'a3@ex.com');
    const conv = await (await req(app, 'POST', '/api/ai/conversations', { jar, csrf: true, body: { title: 't' } })).json() as { id: string };
    const res = await req(app, 'POST', '/api/ai/copilot', { jar, csrf: true, body: { conversationId: conv.id, message: 'analyze BTC', symbol: 'BTCUSDT', timeframe: '15m' } });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/event: text/);
    expect(text).toMatch(/event: usage/);
    expect(text).toMatch(/not investment advice/i);
    // usage recorded
    const usage = db.prepare('SELECT COUNT(*) AS n FROM ai_usage_records').get() as { n: number };
    expect(usage.n).toBeGreaterThanOrEqual(1);
    // messages persisted; reasoning_summary is null (no raw chain-of-thought)
    const msgs = db.prepare('SELECT role, reasoning_summary FROM ai_messages WHERE conversation_id=?').all(conv.id) as { role: string; reasoning_summary: string | null }[];
    expect(msgs.some((m) => m.role === 'assistant')).toBe(true);
    expect(msgs.every((m) => m.reasoning_summary === null)).toBe(true);
  });

  it('cross-user conversation access is isolated (404)', async () => {
    const { app } = build();
    const jarA = await login(app, 'A4@ex.com');
    const jarB = await login(app, 'B4@ex.com');
    const conv = await (await req(app, 'POST', '/api/ai/conversations', { jar: jarA, csrf: true, body: {} })).json() as { id: string };
    expect((await req(app, 'GET', `/api/ai/conversations/${conv.id}/messages`, { jar: jarB })).status).toBe(404);
    // B cannot stream into A's conversation
    expect((await req(app, 'POST', '/api/ai/copilot', { jar: jarB, csrf: true, body: { conversationId: conv.id, message: 'hi' } })).status).toBe(404);
  });

  it('unauthenticated + missing CSRF rejected', async () => {
    const { app } = build();
    expect((await req(app, 'GET', '/api/ai/status', {})).status).toBe(401);
    const jar = await login(app, 'a5@ex.com');
    expect((await req(app, 'POST', '/api/ai/conversations', { jar, body: {} })).status).toBe(403); // no csrf
  });
});
