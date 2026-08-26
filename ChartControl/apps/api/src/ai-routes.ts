import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { AuthService, verifyCsrf, originAllowed, hasPermission } from '@quantumtrade/auth';
import {
  Orchestrator,
  PromptRegistry,
  SafetyPolicy,
  CostController,
  ToolRegistry,
  type ToolDataSource,
  type IAIStreamingProvider,
  type IAIConversationRepository,
  type IAIUsageRepository,
  type CostConfig,
} from '@quantumtrade/ai';
import type { RateLimiter } from './security/rate-limiter';
import type { PgPointsRepo } from './db/points-repo';
import { computeRunPoints, AI_MIN_BALANCE } from './points/ai-metering';

const CSRF = 'qt_csrf';
const corr = () => Math.random().toString(36).slice(2, 10);
const errBody = (code: string, message: string) => ({ error: { code, message, correlationId: corr() } });

export interface AiRouterDeps {
  service: AuthService;
  conversations: IAIConversationRepository;
  usage: IAIUsageRepository;
  toolData: ToolDataSource;
  costConfig: CostConfig;
  csrfKey: string;
  corsOrigins: string[];
  cookieName: string;
  // provider resolution (computed at startup; may be unavailable → UI shows AI unavailable)
  ai: { available: boolean; provider?: IAIStreamingProvider; kind: string; reason?: string };
  model: string;
  maxOutputTokens: number;
  store: boolean;
  maxToolCalls: number;
  toolTimeoutMs: number;
  /**
   * BL-11 — DISTRIBUTED AI request-rate limiter. In production this is the Redis/Valkey limiter (shared
   * across instances, fail-closed); in dev/test it is the in-memory limiter. This bounds request RATE and
   * is DISTINCT from the CostController's token/cost budget: one caps how OFTEN a model call can be
   * triggered, the other caps how much it may SPEND. Injected by the server.
   */
  rateLimiter?: RateLimiter;
  /** AI requests allowed per minute, per authenticated user + route category. */
  aiRatePerMin?: number;
  /**
   * Points repo for usage-metered billing. When present AND the points programme is enabled, each AI
   * run is charged (base + output overage) and a pre-run balance check gates the request. Absent →
   * AI is free (no metering).
   */
  points?: PgPointsRepo;
  /**
   * Build a grounded, server-verified market snapshot for the prompt (decimal strings + timestamps).
   * Returns null when no real price is available — the orchestrator then refuses price-bearing
   * proposals rather than letting the model invent a level. Wired in index.ts from buildAiMarketContext.
   */
  groundContext?: (
    userId: string,
    symbol: string,
    timeframe: string,
    /**
     * The chart context the user is currently viewing (active indicators + their latest values,
     * user-drawn levels, visible range). UNTRUSTED UI state — used only to tell the model what is on
     * the user's screen. The authoritative price and the candle series are fetched SERVER-SIDE.
     */
    clientContext?: unknown,
  ) => Promise<{ marketData: string; dataSnapshotId: string; marketType?: 'futures' | 'perpetual' } | null>;
}

/** Default per-user AI request budget per minute when the server does not override it. */
const DEFAULT_AI_RATE_PER_MIN = 20;

export function createAiRouter(d: AiRouterDeps): Hono {
  const app = new Hono();
  /*
     사용자별 동시 실행 가드(경제 무결성). 잔액 사전확인과 실제 차감이 분리돼 있어,
     잔액 최소치(예: 300)만 있는 사용자가 동시에 여러 번 호출하면 모두 사전확인을
     통과해 OpenAI 비용은 N번 나가고 차감은 1번(clamp)만 되는 누수가 있었다.
     한 사용자는 한 번에 한 실행만 허용해 이 경합을 막는다(단일 인스턴스 기준).
  */
  const aiInFlight = new Set<string>();
  const prompts = new PromptRegistry();
  const safety = new SafetyPolicy();
  const cost = new CostController(d.costConfig, d.usage);
  const tools = new ToolRegistry(d.toolData);

  const authed = async (c: Context) => {
    const raw = getCookie(c, d.cookieName);
    const v = raw ? await d.service.validateSession(raw) : null;
    return v ? { user: v.user, csrfSecret: v.session.csrfSecret } : null;
  };
  const csrfOk = (c: Context, secret: string) =>
    originAllowed(c.req.header('origin'), c.req.header('referer'), d.corsOrigins) &&
    verifyCsrf(c.req.header('x-csrf-token'), getCookie(c, CSRF), secret, d.csrfKey);

  // ---- status: is AI available? which provider? (never leak secrets) ----
  app.get('/ai/status', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(errBody('UNAUTHENTICATED', ''), 401);
    return c.json({ available: d.ai.available, provider: d.ai.kind, reason: d.ai.available ? undefined : d.ai.reason, model: d.ai.available ? d.model : undefined });
  });

  // ---- conversation CRUD (user-isolated) ----
  app.post('/ai/conversations', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(errBody('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(errBody('CSRF_FAILED', ''), 403);
    const body = (await c.req.json().catch(() => ({}))) as { title?: string };
    const conv = await d.conversations.createConversation(a.user.id, body.title ?? 'Conversation');
    return c.json({ id: conv.id }, 201);
  });
  app.get('/ai/conversations/:id/messages', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(errBody('UNAUTHENTICATED', ''), 401);
    const owned = await d.conversations.getOwned(a.user.id, c.req.param('id'));
    if (!owned) return c.json(errBody('NOT_FOUND', ''), 404); // cross-user isolation
    return c.json({ messages: await d.conversations.listMessages(a.user.id, c.req.param('id')) });
  });
  app.delete('/ai/conversations/:id', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(errBody('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(errBody('CSRF_FAILED', ''), 403);
    return (await d.conversations.softDelete(a.user.id, c.req.param('id'))) ? c.json({ ok: true }) : c.json(errBody('NOT_FOUND', ''), 404);
  });

  // ---- copilot SSE stream (auth + CSRF + RBAC + quota; provider-agnostic; abortable) ----
  app.post('/ai/copilot', async (c) => {
    const a = await authed(c);
    if (!a) return c.json(errBody('UNAUTHENTICATED', ''), 401);
    if (!csrfOk(c, a.csrfSecret)) return c.json(errBody('CSRF_FAILED', ''), 403);
    if (!hasPermission(a.user.role, 'signal.write.self')) return c.json(errBody('FORBIDDEN', ''), 403);
    if (!d.ai.available || !d.ai.provider) return c.json(errBody('AI_UNAVAILABLE', d.ai.reason ?? 'AI provider unavailable'), 503);

    // BL-11 — distributed per-user request-rate gate on the expensive model path. The key is the
    // AUTHENTICATED user id + route category only; it never contains the prompt or any PII, so the
    // limiter store cannot become a log of what users asked. In production the limiter is Redis and
    // fail-closed (a Redis outage denies rather than silently allowing an unbounded spend). This runs
    // BEFORE the provider is constructed, so a throttled request costs nothing. It is SEPARATE from the
    // CostController token/cost budget enforced inside the orchestrator.
    if (d.rateLimiter) {
      const budget = d.aiRatePerMin ?? DEFAULT_AI_RATE_PER_MIN;
      const decision = await d.rateLimiter.allow(`ai:copilot:${a.user.id}`, budget, 60_000);
      if (!decision.ok) {
        c.header('Retry-After', String(Math.max(1, Math.ceil(decision.retryAfterMs / 1000))));
        return c.json(errBody('RATE_LIMITED', 'too many AI requests'), 429);
      }
    }

    const body = (await c.req.json().catch(() => ({}))) as { conversationId?: string; message?: string; symbol?: string; timeframe?: string; mode?: string; language?: string };
    if (!body.conversationId || !body.message) return c.json(errBody('BAD_REQUEST', 'conversationId and message required'), 400);
    const owned = await d.conversations.getOwned(a.user.id, body.conversationId);
    if (!owned) return c.json(errBody('NOT_FOUND', 'conversation not found'), 404);

    /*
       사용량 기반 포인트 차감(하이브리드). 포인트 제도가 켜져 있을 때만 과금한다.
       실행 전 최소 잔액(기본 1회분)을 확인해 잔액이 없는 사용자가 무료로 돌리거나
       음수가 되는 것을 막는다. 실제 차감은 실행 후 usage(출력 토큰)로 계산한다.
    */
    let meteringOn = false;
    if (d.points) {
      try { meteringOn = Boolean((await d.points.getSettings()).enabled); } catch { meteringOn = false; }
      if (meteringOn) {
        const balance = await d.points.balanceOf(a.user.id);
        if (balance < AI_MIN_BALANCE) {
          return c.json(errBody('INSUFFICIENT_POINTS', `need at least ${AI_MIN_BALANCE} points to run AI`), 402);
        }
      }
    }

    // 동시 실행 차단(경제 무결성): 이미 진행 중이면 새 실행을 막는다.
    if (aiInFlight.has(a.user.id)) {
      return c.json(errBody('AI_BUSY', 'a previous AI run is still in progress'), 429);
    }
    aiInFlight.add(a.user.id);

    const correlationId = corr();
    const orchestrator = new Orchestrator({
      provider: d.ai.provider,
      prompts,
      safety,
      tools,
      cost,
      model: d.model,
      maxOutputTokens: d.maxOutputTokens,
      store: d.store,
      maxToolCalls: d.maxToolCalls,
      toolTimeoutMs: d.toolTimeoutMs,
    });

    return streamSSE(c, async (stream) => {
      const abort = new AbortController();
      stream.onAbort(() => abort.abort());
      await d.conversations.appendMessage(a.user.id, body.conversationId!, { role: 'user', content: body.message! });
      const symbol = body.symbol ?? 'BTCUSDT';
      const timeframe = body.timeframe ?? '15m';
      // Ground the model in a server-verified market snapshot. Failure is non-fatal: without it the
      // orchestrator simply refuses price-bearing proposals (no fabricated levels).
      let grounded: { marketData: string; dataSnapshotId: string; marketType?: 'futures' | 'perpetual' } | null = null;
      if (d.groundContext) {
        try { grounded = await d.groundContext(a.user.id, symbol, timeframe, (body as { chartContext?: unknown }).chartContext); } catch { grounded = null; }
      }
      let assistantText = '';
      try {
        for await (const ev of orchestrator.run({
          conversationId: body.conversationId!,
          userId: a.user.id,
          userMessage: body.message!,
          symbol,
          timeframe,
          mode: (body.mode as 'copilot' | 'chart-analysis' | 'signal') ?? 'copilot',
          language: (body.language as 'ko' | 'en') ?? 'en',
          signal: abort.signal,
          correlationId,
          marketData: grounded?.marketData,
          dataSnapshotId: grounded?.dataSnapshotId,
          marketType: grounded?.marketType,
        })) {
          if (ev.type === 'text') assistantText += ev.delta;
          if (ev.type === 'usage') {
            await d.usage.record(a.user.id, { ...ev.usage, conversationId: body.conversationId!, correlationId });
            // 사용량 기반 차감(멱등: 같은 실행 correlationId 는 한 번만). 실패해도 응답을 막지 않는다.
            if (meteringOn && d.points) {
              try {
                const points = computeRunPoints(ev.usage.outputTokens);
                const res = await d.points.spendMetered({ userId: a.user.id, amount: points, refType: 'ai_run', refId: correlationId, memo: `ai copilot · out ${ev.usage.outputTokens}tok` });
                if (res) await stream.writeSSE({ event: 'points', data: JSON.stringify({ type: 'points', charged: res.deducted, balance: res.balanceAfter }) });
              } catch { /* 차감 실패는 비치명 */ }
            }
          }
          await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
        }
        if (assistantText) await d.conversations.appendMessage(a.user.id, body.conversationId!, { role: 'assistant', content: assistantText });
      } catch (e) {
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ code: 'stream-exception', message: (e as Error).message }) });
      } finally {
        aiInFlight.delete(a.user.id);
      }
    });
  });

  return app;
}
