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
import { ToolLoopGuard, isProposalTool, parseProposalArgs, type ProposalToolName } from './tools';
import { buildDelimitedInput } from './prompts';
import {
  AiChartCommandSchema,
  AiSignalObjectSchema,
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
  signal: 'signal.generation',
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
      tools: this.d.tools.list(),
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
      yield { type: 'error', code: 'stream-exception', message: (e as Error).message };
    } finally {
      this.d.cost.release();
    }
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

    // propose_signal — a signal always carries levels, so it always requires grounding.
    if (!grounding.has) return [{ type: 'error', code: 'ungrounded-proposal', message: 'signal requires market data before it can be proposed' }];
    let signalFields: Record<string, unknown>;
    try {
      signalFields = JSON.parse(String(parsed.value.signalJson));
    } catch {
      return [{ type: 'error', code: 'proposal-invalid', message: 'signalJson is not valid JSON' }];
    }
    const built = {
      ...signalFields,
      signalId: this.uuid(),
      schemaVersion: AI_SIGNAL_SCHEMA_VERSION,
      symbol: input.symbol,
      marketType: input.marketType ?? 'perpetual',
      timeframe: input.timeframe,
      aiGenerated: true as const,
      model: this.d.model,
      promptVersion: '1.0.0',
      dataSnapshotId: input.dataSnapshotId ?? `ctx-${input.correlationId}`,
      dataTimestamp: now,
      expiresAt: now + PROPOSAL_TTL_MS,
      userEdited: false,
      status: 'PROPOSED' as const,
    };
    const check = AiSignalObjectSchema.safeParse(built);
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
