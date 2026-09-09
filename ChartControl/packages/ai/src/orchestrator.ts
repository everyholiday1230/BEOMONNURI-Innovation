import type {
  AiRequest,
  AiStreamEvent,
  IAIOrchestrator,
  IAIPromptRegistry,
  IAISafetyPolicy,
  IAIStreamingProvider,
  IAIToolRegistry,
  OrchestratorEvent,
  OrchestratorInput,
} from './interfaces';
import type { CostController } from './cost';
import { suggestFollowUps } from './followups';
import { ToolLoopGuard, isProposalTool, parseProposalArgs, type ProposalToolName } from './tools';
import { buildDelimitedInput } from './prompts';
import {
  AiChartCommandSchema,
  AiSetupReviewSchema,
  validateChartCommandArgs,
  AI_CHART_COMMAND_VERSION,
  AI_SIGNAL_SCHEMA_VERSION,
  type AiChartCommandName,
} from './schemas';

/** Commands whose args carry a price/level — these require grounded MARKET_DATA before they may be proposed. */
const PRICE_BEARING_COMMANDS = new Set<AiChartCommandName>([
  'createTrendLine', 'createHorizontalLevel', 'createSupportResistance', 'createEntryZone',
  'createStopLoss', 'createTakeProfit', 'createLongMarker', 'createShortMarker', 'createInvalidationLevel',
]);

/*
   ★★ **방향을 드러내는 차트 명령.** 여기가 구멍이었다.

     방향 검사는 `review_setup` 에만 걸려 있었다. 그런데 롱 마커는 차트 명령
     (`propose_chart_command`)으로도 그릴 수 있고, 그 경로는 검사 앞에서 반환된다.
     즉 모델이 `review_setup` 을 건너뛰고 `createLongMarker` 를 부르면 방향 발신
     금지를 **그냥 지나갔다.** 4중 방어라고 적어 두었는데 서버 층에 구멍이 있었다.

   ★ 같은 행위가 경로에 따라 되기도 하고 안 되기도 하면 어느 정책에서도 틀렸다.
     그래서 이 명령들은 두 경로에서 같은 규칙을 받는다.

   ★ 지지·저항·추세선·수평선은 여기 넣지 않는다. 방향을 드러내지 않는 관찰이고,
     방향을 말하지 않은 고객도 받아야 하는 것이다(운영 결정: 관찰은 먼저).
*/
const DIRECTION_BEARING_COMMANDS = new Set<AiChartCommandName>([
  'createLongMarker', 'createShortMarker',
]);

/*
   고객이 방향을 말했는지 판정하는 단어들.

   ★ 언어를 가리지 않는다. 한국어로 "롱으로 보고 있어" 라고 쓴 고객도 방향을 말한 것이다.
   ★ 넓히지 않는다. '올라갈까요?' 는 질문이지 방향 선언이 아니다 — 느슨하게 만들면
     AI 가 방향을 고른 것과 같아진다.
*/
const LONG_WORDS = ['long', '롱', '매수', '買い', 'ロング', '做多', '买入'];
const SHORT_WORDS = ['short', '숏', '매도', '空売り', 'ショート', '做空', '卖出'];

/** 고객 문장에 방향 선언이 있는가. 두 경로(review_setup·차트 명령)가 같은 판정을 쓴다. */
export function userStatedDirection(userMessage: string | undefined): boolean {
  const said = String(userMessage ?? '').toLowerCase();
  return LONG_WORDS.some((w) => said.includes(w)) || SHORT_WORDS.some((w) => said.includes(w));
}

/** How long a proposed command/signal stays valid before the UI must discard it. */
const PROPOSAL_TTL_MS = 5 * 60_000;

/**
 * AI orchestrator (docs PHASE4-01/03). Runs: safety screen → cost/quota → prompt assembly →
 * provider stream → (validated, read-only) tool execution → structured-output validation → typed
 * events. LLM output is NEVER executed; ChartCommands are validated and only PROPOSED to the UI.
 */
export interface OrchestratorDeps {
  provider: IAIStreamingProvider;
  prompts: IAIPromptRegistry;
  safety: IAISafetyPolicy;
  tools: IAIToolRegistry;
  cost: CostController;
  model: string;
  maxOutputTokens: number;
  store: boolean;
  maxToolCalls: number;
  toolTimeoutMs: number;
  marketDataStale?: () => boolean;
}

const PROMPT_BY_MODE: Record<OrchestratorInput['mode'], string> = {
  copilot: 'copilot.system',
  'chart-analysis': 'chart.analysis',
  /* ★ 신호 발신(signal.generation)을 고객 셋업 검토(setup.review)로 바꿨다. */
  signal: 'setup.review',
};

export class Orchestrator implements IAIOrchestrator {
  constructor(private readonly d: OrchestratorDeps) {}

  async *run(input: OrchestratorInput): AsyncIterable<OrchestratorEvent> {
    yield { type: 'state', state: 'validating' };

    // 1) Safety screen of user input (prompt injection blocks; auto-trade request is flagged, refused later).
    const userScreen = this.d.safety.screenUserInput(input.userMessage);
    if (!userScreen.allowed) {
      yield { type: 'error', code: 'prompt-injection', message: 'Request blocked by safety policy (prompt injection).' };
      yield { type: 'done' };
      return;
    }

    // 2) Cost / quota / breaker.
    if (this.d.cost.breakerOpen()) {
      yield { type: 'error', code: 'provider-unavailable', message: 'AI temporarily unavailable (circuit open).' };
      yield { type: 'done' };
      return;
    }
    const decision = await this.d.cost.checkAllowed(input.userId);
    if (!decision.allowed) {
      yield { type: 'error', code: decision.reason ?? 'blocked', message: `AI request not allowed: ${decision.reason}` };
      yield { type: 'done' };
      return;
    }

    // 3) Prompt assembly (versioned) with clear trust boundaries.
    const prompt = this.d.prompts.active(PROMPT_BY_MODE[input.mode]);
    const req: AiRequest = {
      conversationId: input.conversationId,
      userId: input.userId,
      model: this.d.model,
      instructions: prompt.template,
      input: [{ role: 'user', content: buildDelimitedInput({ userMessage: input.userMessage, marketData: input.marketData }) }],
      // 서버가 시장 데이터를 이미 주입했으면(grounded) 읽기 전용 조회 도구는 노출하지 않는다.
      // 단일 패스 스트림에서 모델이 읽기 도구를 부르면 출력 제출을 기다리며 스트림이 끝나
      // 제안(command/signal)이 전혀 안 나온다. 주입된 데이터로 바로 제안하게 강제한다.
      tools: input.marketData ? this.d.tools.list().filter((t) => isProposalTool(t.name)) : this.d.tools.list(),
      maxOutputTokens: this.d.maxOutputTokens,
      store: this.d.store,
      signal: input.signal,
      correlationId: input.correlationId,
    };

    this.d.cost.acquire();
    const loop = new ToolLoopGuard(this.d.maxToolCalls);
    // Grounding: server-injected MARKET_DATA counts as grounded from the start; a market data tool
    // call sets it too. Price-bearing proposals and priced text are gated on this.
    const grounding = { has: Boolean(input.marketData) };
    let fullText = '';
    /*
       ★ 실행된 읽기 도구를 모은다. 후속 제안이 "이미 본 것" 과 "아직 안 본 것" 을
         구별하는 데 쓴다. 실패한 호출도 시도로 기록하지 않는다 — 결과가 없으면
         본 것이 아니다.
    */
    const toolsUsed: string[] = [];
    try {
      yield { type: 'state', state: 'streaming' };
      for await (const ev of this.d.provider.streamResponse(req)) {
        if (input.signal?.aborted) {
          yield { type: 'state', state: 'canceled' };
          yield { type: 'done' };
          return;
        }
        const mapped = await this.handleEvent(ev, input, loop, grounding);
        for (const m of mapped) {
          if (m.type === 'text') fullText += m.delta;
          if (m.type === 'tool' && m.ok && !toolsUsed.includes(m.name)) toolsUsed.push(m.name);
          yield m;
        }
        if (ev.type === 'completed') {
          // 4) Screen model output before final acceptance.
          const stale = this.d.marketDataStale?.() ?? false;
          const outScreen = this.d.safety.screenModelOutput(fullText, { hasMarketToolResult: grounding.has, marketDataStale: stale });
          if (!outScreen.allowed) {
            yield { type: 'error', code: 'unsafe-output', message: `Model output rejected: ${outScreen.violations.join(', ')}` };
          }
          this.d.cost.onProviderSuccess();
          this.d.cost.addSystemCost(ev.usage.estimatedCostMicros);
          yield { type: 'usage', usage: ev.usage };
        }
        if (ev.type === 'failed' || ev.type === 'error') {
          this.d.cost.onProviderFailure();
          yield { type: 'error', code: ev.type === 'failed' ? ev.code : 'error', message: ev.type === 'failed' ? ev.message : ev.message };
        }
      }
    } catch (e) {
      this.d.cost.onProviderFailure();
      /*
         ★★ **원인을 서버에 남긴다.** 전에는 이 오류가 어디에도 기록되지 않았다.

           고객 화면에는 "답변 작성 중 문제가 발생했습니다" 만 보이고(그건 맞다 —
           제공자 오류 원문을 고객에게 보여줄 수는 없다), 서버 로그에도 아무것도
           남지 않았다. 그래서 **AI 가 전부 실패하는데 원인을 알 수 없는** 상태가 됐다.
           실제로 그 상태로 운영에서 신고가 들어왔고, 로그를 봐도 단서가 없었다.

         ★ 고객에게 숨기는 것과 우리가 모르는 것은 다르다. 화면은 순화하고 로그에는
           원문을 남긴다.

         ★ 제공자 오류는 대개 원인이 정해져 있다 — 키 만료·잔액 부족·모델명 오류·
           레이트리밋. 원문에 그 구분이 들어 있으므로 한 줄만 봐도 대응이 갈린다.

         ★ 모델명을 함께 찍는다. 존재하지 않는 모델을 설정하면 404 가 오는데, 그때
           "어떤 모델을 부르려 했는가" 가 없으면 설정을 의심하기까지 오래 걸린다.
      */
      const err = e as Error;
      console.error(
        `[ai] ★ 제공자 호출 실패 — model=${this.d.model} corr=${input.correlationId} `
        + `name=${err.name} message=${err.message}`,
      );
      yield { type: 'error', code: 'stream-exception', message: err.message };
    } finally {
      this.d.cost.release();
    }

    /*
       ★★ 후속 제안. 답변만 하고 끝내지 않고 다음에 확인할 것을 제시한다.

         모델이 만들지 않는다. 규칙으로 고른다 — 모델은 이 제품이 주문을 넣지
         않는다는 것을 모르고(누르면 아무 일도 없는 죽은 버튼이 된다), 투자권유를
         해서는 안 된다는 경계도 모른다. 토큰도 쓰지 않는다.

       ★ 실패해도 답변을 망치지 않는다. 보조 기능이 본 기능을 막아서는 안 된다.
    */
    try {
      const fu = input.followUp ?? {};
      const items = suggestFollowUps({
        toolsUsed,
        indicators: Array.isArray(fu.indicators) ? fu.indicators : [],
        drawingTypes: Array.isArray(fu.drawingTypes) ? fu.drawingTypes : [],
        positionCount: fu.positionCount ?? null,
        openOrderCount: fu.openOrderCount ?? null,
        hasTradeHistory: fu.hasTradeHistory ?? null,
        symbol: input.symbol,
        timeframe: input.timeframe,
        mode: input.mode,
      });
      if (items.length > 0) yield { type: 'suggestions', items };
    } catch { /* 제안 실패는 비치명 — 답변은 이미 전달됐다 */ }

    yield { type: 'done' };
  }

  /** Map a provider event to orchestrator events (executing read-only tools; validating proposals). */
  private async handleEvent(
    ev: AiStreamEvent,
    input: OrchestratorInput,
    loop: ToolLoopGuard,
    grounding: { has: boolean },
  ): Promise<OrchestratorEvent[]> {
    if (ev.type === 'output_text.delta') return [{ type: 'text', delta: ev.delta }];
    if (ev.type === 'function_call.done') {
      const admit = loop.admit(ev.name, ev.args);
      if (!admit.ok) return [{ type: 'error', code: admit.reason ?? 'tool-blocked', message: `tool call blocked: ${admit.reason}` }];

      // PROPOSAL tools: validate + emit a command/signal proposal (never executed, never auto-applied).
      if (isProposalTool(ev.name)) {
        return this.handleProposal(ev.name, ev.args, input, grounding);
      }

      if (!this.d.tools.has(ev.name)) return [{ type: 'error', code: 'unknown-tool', message: `unknown tool: ${ev.name}` }];
      try {
        const result = await loop.withTimeout(
          this.d.tools.execute(ev.name, ev.args, { userId: input.userId, symbol: input.symbol, timeframe: input.timeframe, correlationId: input.correlationId }),
          this.d.toolTimeoutMs,
        );
        if (ev.name.startsWith('get_market') || ev.name === 'get_candles' || ev.name === 'get_current_chart_context') grounding.has = true;
        return [{ type: 'tool', name: ev.name, ok: result.ok }];
      } catch (e) {
        return [{ type: 'tool', name: ev.name, ok: false }, { type: 'error', code: 'tool-timeout', message: (e as Error).message }];
      }
    }
    return [];
  }

  /** Validate a model proposal, fill server-owned provenance, and emit a command/signal event. */
  private handleProposal(
    name: ProposalToolName,
    argsJson: string,
    input: OrchestratorInput,
    grounding: { has: boolean },
  ): OrchestratorEvent[] {
    const parsed = parseProposalArgs(name, argsJson);
    if (!parsed.ok) return [{ type: 'error', code: 'proposal-invalid', message: parsed.error }];
    const now = Date.now();

    if (name === 'propose_chart_command') {
      const command = String(parsed.value.command) as AiChartCommandName;
      // Grounding gate: a price-bearing level must be backed by real market data.
      if (PRICE_BEARING_COMMANDS.has(command) && !grounding.has) {
        return [{ type: 'error', code: 'ungrounded-proposal', message: `${command} requires market data before it can be proposed` }];
      }
      let cmdArgs: unknown;
      try {
        cmdArgs = JSON.parse(String(parsed.value.argsJson));
      } catch {
        return [{ type: 'error', code: 'proposal-invalid', message: 'argsJson is not valid JSON' }];
      }
      const argCheck = validateChartCommandArgs(command, cmdArgs);
      if (!argCheck.ok) return [{ type: 'error', code: 'proposal-invalid', message: `args: ${argCheck.error}` }];

      /*
         ★★ **구멍을 막는다** — 방향을 드러내는 명령은 이 경로에서도 검사한다.

           `review_setup` 에만 검사가 있어서, 모델이 그것을 건너뛰고 `createLongMarker`
           를 부르면 방향 발신 금지를 그냥 지나갔다.

         ★ 한쪽 마커만 그리는 것이 곧 방향 발신이다. 고객이 방향을 말하지 않았다면
           `review_setup` 으로 **양쪽을 함께** 제시해야 한다 — 그 경로에는 스키마가
           대칭을 강제한다. 그래서 여기서는 단독 마커를 막고 그 경로로 보낸다.

         ★ 그림을 못 그리게 하는 것이 아니다. 지지·저항·추세선·수평선은 그대로
           그려진다(DIRECTION_BEARING_COMMANDS 에 없다).
      */
      if (DIRECTION_BEARING_COMMANDS.has(command) && !userStatedDirection(input.userMessage)) {
        return [{
          type: 'error',
          code: 'direction-not-stated',
          message: 'one-sided marker without a user-stated direction — present both sides via review_setup',
        }];
      }
      const built = {
        schemaVersion: AI_CHART_COMMAND_VERSION,
        commandId: this.uuid(),
        conversationId: input.conversationId,
        userId: input.userId,
        symbol: input.symbol,
        marketType: input.marketType ?? 'perpetual',
        timeframe: input.timeframe,
        createdAt: now,
        expiresAt: now + PROPOSAL_TTL_MS,
        source: 'ai' as const,
        confidence: Number(parsed.value.confidence),
        reasoningSummary: String(parsed.value.reasoningSummary),
        dataSnapshotId: input.dataSnapshotId ?? `ctx-${input.correlationId}`,
        aiGenerated: true,
        command,
        args: argCheck.value as Record<string, unknown>,
      };
      const check = AiChartCommandSchema.safeParse(built);
      if (!check.success) return [{ type: 'error', code: 'proposal-invalid', message: check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }];
      return [{ type: 'command', command: check.data }];
    }

    /*
       review_setup — 고객이 만든 셋업의 검토 결과다. 수준(가격)을 다루므로 시세
       근거가 반드시 있어야 한다.
    */
    if (!grounding.has) return [{ type: 'error', code: 'ungrounded-proposal', message: 'setup review requires market data' }];

    /*
       ★★ **방향 발신을 서버에서 막는다 — 그러나 답을 막지는 않는다.**

         프롬프트에 "방향을 고르지 마라" 고 적는 것만으로는 부족하다. 모델은 지시를
         어길 수 있고, 어겼을 때 그것이 곧 매매 신호가 된다. 그래서 고객이 방향을
         말했는지 **서버가 확인**한다.

       ★★ 처음에는 방향이 없으면 도구 호출을 **거부**했다. 그것이 틀렸다.

         고객은 "BTC 어때?" 처럼 방향을 안 쓰고 묻는 것이 자연스럽다. 그래서 대부분의
         요청에서 아무 답도 못 받았고, 화면에는 개발자용 영어 오류가 떴다. 고객 문의로
         돌아왔다(BEWHITE 님).

         막는 것이 목적이 아니다. AI 가 방향을 **고르지** 않게 하는 것이 목적이다.
         그래서 이제 거부하지 않고 **양쪽을 모두 요구**한다 — 롱·숏을 나란히 제시하면
         AI 는 방향을 고르지 않으면서 고객은 필요한 답을 다 받는다.

       ★ 판정 근거는 고객이 이 요청에서 쓴 문장(userMessage)이다. 대화 전체를 보면
         "지난번에 롱 얘기했잖아" 같은 것까지 방향 선언으로 읽혀 경계가 흐려진다.

       ★ 언어를 가리지 않아야 한다. 한국어로 "롱으로 보고 있어" 라고 쓴 고객도 방향을
         말한 것이다.

       ★ 넓히지 않는다. '올라갈까요?' 는 질문이지 방향 선언이 아니다. 이 검사를
         느슨하게 만들면 AI 가 방향을 고른 것과 같아진다.
    */
    const said = String(input.userMessage ?? '').toLowerCase();
    const statedDirection = LONG_WORDS.some((w) => said.includes(w)) || SHORT_WORDS.some((w) => said.includes(w));

    const built = {
      ...parsed.value,
      reviewId: this.uuid(),
      schemaVersion: AI_SIGNAL_SCHEMA_VERSION,
      symbol: input.symbol,
      marketType: input.marketType ?? 'perpetual',
      timeframe: input.timeframe,
      /*
         ★★ 이 값은 **서버가** 정한다. 모델이 정하게 두면 "고객이 말한 것으로 간주"
           해 버리고 한쪽만 제시할 수 있다 — 방향 발신 금지가 그대로 무력해진다.
      */
      directionStatedByUser: statedDirection,
      /* ★ 출처는 '고객이 만들고 AI 가 도왔다' 다. AI 단독 발신은 표현할 수 없다. */
      author: 'user_ai_assisted' as const,
      model: this.d.model,
      promptVersion: '1.0.0',
      dataSnapshotId: input.dataSnapshotId ?? `ctx-${input.correlationId}`,
      dataTimestamp: now,
      expiresAt: now + PROPOSAL_TTL_MS,
      userEdited: false,
      status: 'USER_REVIEW' as const,
    };
    const check = AiSetupReviewSchema.safeParse(built);
    if (!check.success) return [{ type: 'error', code: 'proposal-invalid', message: check.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') }];
    return [{ type: 'signal', signal: check.data }];
  }

  private uuid(): string {
    const g = globalThis as { crypto?: { randomUUID?: () => string } };
    return g.crypto?.randomUUID ? g.crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  }
}

/** Validate a proposed AI ChartCommand end-to-end (schema + per-command args + symbol/timeframe match). */
export function validateProposedChartCommand(
  raw: unknown,
  ctx: { userId: string; symbol: string; timeframe: string; now: number },
): { ok: true; command: unknown } | { ok: false; error: string } {
  const parsed = AiChartCommandSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  const cmd = parsed.data;
  if (cmd.userId !== ctx.userId) return { ok: false, error: 'ownership mismatch' };
  if (cmd.expiresAt <= ctx.now) return { ok: false, error: 'command expired' };
  const argCheck = validateChartCommandArgs(cmd.command as AiChartCommandName, cmd.args);
  if (!argCheck.ok) return { ok: false, error: `args: ${argCheck.error}` };
  // Symbol/timeframe mismatch is NOT auto-applied — surface for user confirmation.
  if (cmd.symbol !== ctx.symbol || cmd.timeframe !== ctx.timeframe) {
    return { ok: false, error: 'symbol/timeframe mismatch — user confirmation required before applying' };
  }
  return { ok: true, command: cmd };
}
