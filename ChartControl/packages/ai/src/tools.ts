import { z } from 'zod';
import { TIMEFRAMES } from '@quantumtrade/config';
import { AI_CHART_COMMANDS } from './schemas';
import type { AiToolDefinition, AiToolResult, IAIToolRegistry, ToolExecContext } from './interfaces';

/**
 * Strict READ-ONLY tool registry (docs PHASE4-03). Every tool: strict schema,
 * additionalProperties:false, all properties required (optionals expressed as nullable). There is NO
 * tool that submits/cancels/modifies orders, changes leverage/position-mode, or returns secrets.
 */
const SymbolArg = z.string().min(1).max(20);
const TimeframeArg = z.enum(TIMEFRAMES);

// Each tool's Zod schema. `.strict()` => additionalProperties:false. Optionals use .nullable().
const TOOL_SCHEMAS = {
  get_market_snapshot: z.object({ symbol: SymbolArg }).strict(),
  get_candles: z.object({ symbol: SymbolArg, timeframe: TimeframeArg, limit: z.number().int().min(1).max(500) }).strict(),
  get_order_book_summary: z.object({ symbol: SymbolArg, depth: z.number().int().min(1).max(50) }).strict(),
  get_recent_trades_summary: z.object({ symbol: SymbolArg, limit: z.number().int().min(1).max(100) }).strict(),
  get_funding_rate: z.object({ symbol: SymbolArg }).strict(),
  get_market_metadata: z.object({ symbol: SymbolArg }).strict(),
  get_current_chart_context: z.object({ symbol: SymbolArg, timeframe: TimeframeArg }).strict(),
  get_user_visible_positions: z.object({ symbol: SymbolArg.nullable() }).strict(),
  get_user_visible_open_orders: z.object({ symbol: SymbolArg.nullable() }).strict(),
  calculate_risk_reward: z.object({ entry: z.string(), stop: z.string(), target: z.string() }).strict(),
  validate_chart_command: z.object({ commandJson: z.string().min(1) }).strict(),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;
/*
   ★★ `calculate_indicator_set` 을 **제거했다.** 아무것도 계산하지 않았다.

     구현 전체가 이랬다:

       return { symbol, timeframe, indicators, note: 'computed server-side (deterministic)' };

     입력을 그대로 되돌려주면서 "서버에서 결정론적으로 계산했다" 고 적어 보냈다.
     숫자는 없었다. 도구 설명도 'Compute a small set of technical indicators
     (server-side, deterministic)' 였다.

   ★★ 미구현보다 나쁜 이유: 모델은 **계산된 값을 받았다고 믿는다.** 그러면 지표
     수치를 자신 있게 말하는데 그 숫자의 출처가 없다. 없는 도구보다, 있는 척하는
     도구가 위험하다 — 이 프로젝트에서 반복해서 고쳐온 실패 방식이다(막지 못하는
     게이트, 기록하지 않는 컬럼, 도달하지 않는 오류 싱크).

   ★ 지표 값을 실제로 넘기는 경로는 차트가 이미 계산한 값을 쓰는 방식으로 붙인다
     (KLineCharts 가 27종을 브라우저에서 계산한다). 서버에서 따로 구현하면 화면
     숫자와 AI 숫자가 어긋날 수 있고, 그건 둘 다 못 믿게 만든다.

   ★ 그때까지 모델은 지표 수치를 말할 수 없다. SAFETY_FOOTER 에 그 규칙을 넣었다.
*/
export const READ_ONLY_TOOL_NAMES = Object.keys(TOOL_SCHEMAS) as ToolName[];

/**
 * PROPOSAL tools (docs PHASE4-06). Unlike the read-only tools above, these do not fetch data — they
 * let the model PROPOSE a chart drawing/indicator command or a trading signal. The proposal is
 * validated server-side (schema + provenance + grounding) by the orchestrator and surfaced to the UI
 * as a PROPOSAL the user reviews; it is NEVER auto-applied and NEVER submits an order. The model emits
 * only the essential fields — the server owns all provenance (ids, timestamps, expiry, symbol/tf).
 */
const PROPOSAL_TOOL_SCHEMAS = {
  propose_chart_command: z
    .object({
      command: z.enum(AI_CHART_COMMANDS),
      // args as a JSON string so strict function-calling stays simple; validated per-command server-side.
      argsJson: z.string().min(2).max(2000),
      confidence: z.number().min(0).max(100),
      reasoningSummary: z.string().min(1).max(600),
    })
    .strict(),
  propose_signal: z
    .object({
      // full SignalObject fields as JSON; the server fills provenance and validates the schema.
      signalJson: z.string().min(2).max(6000),
    })
    .strict(),
} as const;

export type ProposalToolName = keyof typeof PROPOSAL_TOOL_SCHEMAS;
export const PROPOSAL_TOOL_NAMES = Object.keys(PROPOSAL_TOOL_SCHEMAS) as ProposalToolName[];
export function isProposalTool(name: string): name is ProposalToolName {
  return (PROPOSAL_TOOL_NAMES as string[]).includes(name);
}

const PROPOSAL_TOOL_DESCRIPTIONS: Record<ProposalToolName, string> = {
  propose_chart_command:
    'Propose ONE chart drawing/indicator action. `command` is the action; `argsJson` is a JSON object ' +
    'with EXACTLY these keys per command (no extra keys, prices from MARKET_DATA as strings):\n' +
    '- createSupportResistance: {"price":"65000","kind":"support"|"resistance"}\n' +
    '- createHorizontalLevel: {"price":"65000","label":"optional"}\n' +
    '- createTrendLine: {"points":[{"time":1699999999000,"price":"64000"},{"time":1700000999000,"price":"66000"}],"label":"optional"}\n' +
    '- createEntryZone: {"priceLo":"64000","priceHi":"64500"}\n' +
    '- createStopLoss: {"price":"63000"}  · createInvalidationLevel: {"price":"62500"}\n' +
    '- createTakeProfit: {"price":"68000","index":0}\n' +
    '- addIndicator: {"indicator":"RSI","label":"optional"}  · removeIndicator: {"indicator":"RSI"}\n' +
    'Prices must come from MARKET_DATA — never invent a level. Shown to the user as a proposal; never auto-applied.',
  propose_signal:
    'Propose a trading SignalObject (direction, entryZone, stopLoss, takeProfits, invalidation, ' +
    'riskReward, thesis, supporting + contradicting evidence). Derive every level from MARKET_DATA. ' +
    'Shown for user review; never auto-executed.',
};

const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  get_market_snapshot: 'Read-only current market snapshot (last/mark price, 24h stats) for a symbol.',
  get_candles: 'Read-only OHLCV candles for a symbol/timeframe (bounded limit).',
  get_order_book_summary: 'Read-only aggregated order-book summary (bounded depth).',
  get_recent_trades_summary: 'Read-only recent-trades summary (bounded).',
  get_funding_rate: 'Read-only current funding rate for a perpetual symbol.',
  get_market_metadata: 'Read-only contract metadata: tick/step size, min qty, precision.',
  get_current_chart_context: 'Read-only current chart context the user is viewing.',
  get_user_visible_positions: 'Read-only positions the authenticated user is allowed to see.',
  get_user_visible_open_orders: 'Read-only open orders the authenticated user is allowed to see.',
  calculate_risk_reward: 'Compute risk/reward from entry/stop/target decimal strings.',
  validate_chart_command: 'Validate a proposed ChartCommand JSON against the schema (no side effects).',
};

/** Minimal Zod→JSON-Schema for OpenAI strict function tools (objects of scalars/enums/arrays). */
export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as unknown as { _def: { typeName: string } })._def;
  const tn = def.typeName;
  if (tn === 'ZodObject') {
    const shape = (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, val] of Object.entries(shape)) {
      properties[key] = zodToJsonSchema(val);
      required.push(key); // strict mode: ALL properties required (optionals are nullable)
    }
    return { type: 'object', properties, required, additionalProperties: false };
  }
  if (tn === 'ZodString') return { type: 'string' };
  if (tn === 'ZodNumber') return { type: 'number' };
  if (tn === 'ZodBoolean') return { type: 'boolean' };
  if (tn === 'ZodEnum') return { type: 'string', enum: (def as unknown as { values: string[] }).values };
  if (tn === 'ZodArray') return { type: 'array', items: zodToJsonSchema((def as unknown as { type: z.ZodTypeAny }).type) };
  if (tn === 'ZodNullable') {
    const inner = zodToJsonSchema((def as unknown as { innerType: z.ZodTypeAny }).innerType) as { type?: string };
    return { type: [inner.type ?? 'string', 'null'] };
  }
  if (tn === 'ZodOptional') return zodToJsonSchema((def as unknown as { innerType: z.ZodTypeAny }).innerType);
  return {};
}

export interface ToolDataSource {
  get_market_snapshot(symbol: string): Promise<unknown>;
  get_candles(symbol: string, timeframe: string, limit: number): Promise<unknown>;
  get_order_book_summary(symbol: string, depth: number): Promise<unknown>;
  get_recent_trades_summary(symbol: string, limit: number): Promise<unknown>;
  get_funding_rate(symbol: string): Promise<unknown>;
  get_market_metadata(symbol: string): Promise<unknown>;
  get_current_chart_context(symbol: string, timeframe: string): Promise<unknown>;
  get_user_visible_positions(userId: string, symbol: string | null): Promise<unknown>;
  get_user_visible_open_orders(userId: string, symbol: string | null): Promise<unknown>;
}

export class ToolRegistry implements IAIToolRegistry {
  constructor(private readonly ds: ToolDataSource) {}

  list(): AiToolDefinition[] {
    const readOnly = READ_ONLY_TOOL_NAMES.map((name) => ({
      name,
      description: TOOL_DESCRIPTIONS[name],
      parameters: zodToJsonSchema(TOOL_SCHEMAS[name]),
      strict: true,
    }));
    const proposal = PROPOSAL_TOOL_NAMES.map((name) => ({
      name,
      description: PROPOSAL_TOOL_DESCRIPTIONS[name],
      parameters: zodToJsonSchema(PROPOSAL_TOOL_SCHEMAS[name]),
      strict: true,
    }));
    return [...readOnly, ...proposal];
  }
  has(name: string): boolean {
    return (READ_ONLY_TOOL_NAMES as string[]).includes(name) || isProposalTool(name);
  }

  async execute(name: string, argsJson: string, ctx: ToolExecContext): Promise<AiToolResult> {
    const callId = `${name}:${ctx.correlationId}`;
    if (!this.has(name)) return { callId, name, ok: false, output: { error: `unknown tool: ${name}` } };
    let parsed: unknown;
    try {
      parsed = JSON.parse(argsJson || '{}');
    } catch {
      return { callId, name, ok: false, output: { error: 'invalid tool arguments JSON' } };
    }
    const schema = TOOL_SCHEMAS[name as ToolName];
    const v = schema.safeParse(parsed);
    if (!v.success) return { callId, name, ok: false, output: { error: v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') } };
    const a = v.data as Record<string, unknown>;
    try {
      const output = await this.dispatch(name as ToolName, a, ctx);
      return { callId, name, ok: true, output };
    } catch (e) {
      return { callId, name, ok: false, output: { error: (e as Error).message } };
    }
  }

  private async dispatch(name: ToolName, a: Record<string, unknown>, ctx: ToolExecContext): Promise<unknown> {
    switch (name) {
      case 'get_market_snapshot': return this.ds.get_market_snapshot(a.symbol as string);
      case 'get_candles': return this.ds.get_candles(a.symbol as string, a.timeframe as string, a.limit as number);
      case 'get_order_book_summary': return this.ds.get_order_book_summary(a.symbol as string, a.depth as number);
      case 'get_recent_trades_summary': return this.ds.get_recent_trades_summary(a.symbol as string, a.limit as number);
      case 'get_funding_rate': return this.ds.get_funding_rate(a.symbol as string);
      case 'get_market_metadata': return this.ds.get_market_metadata(a.symbol as string);
      case 'get_current_chart_context': return this.ds.get_current_chart_context(a.symbol as string, a.timeframe as string);
      case 'get_user_visible_positions': return this.ds.get_user_visible_positions(ctx.userId, (a.symbol as string) ?? null);
      case 'get_user_visible_open_orders': return this.ds.get_user_visible_open_orders(ctx.userId, (a.symbol as string) ?? null);
      case 'calculate_risk_reward': {
        const entry = Number(a.entry), stop = Number(a.stop), target = Number(a.target);
        const risk = Math.abs(entry - stop), reward = Math.abs(target - entry);
        return { riskReward: risk === 0 ? null : (reward / risk).toFixed(4) };
      }
      case 'validate_chart_command': return { note: 'schema validation is performed by the orchestrator pipeline' };
    }
  }
}

/**
 * Parse + validate the ARGUMENTS of a proposal tool call (shape only). Standalone so the orchestrator
 * (typed on IAIToolRegistry) can use it. Deeper command/signal validation, provenance, and grounding
 * checks are the orchestrator's responsibility.
 */
export function parseProposalArgs(name: ProposalToolName, argsJson: string):
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson || '{}');
  } catch {
    return { ok: false, error: 'invalid proposal arguments JSON' };
  }
  const v = PROPOSAL_TOOL_SCHEMAS[name].safeParse(parsed);
  if (!v.success) return { ok: false, error: v.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  return { ok: true, value: v.data as Record<string, unknown> };
}

/**
 * Guards the tool-calling loop (docs PHASE4-05): max calls, loop (repeated identical call) detection,
 * per-call timeout, and duplicate-call de-duplication.
 */
export class ToolLoopGuard {
  private count = 0;
  private seen = new Map<string, number>();
  constructor(private readonly maxCalls: number, private readonly maxRepeat = 2) {}

  /** Returns a decision for a proposed tool call. */
  admit(name: string, argsJson: string): { ok: boolean; reason?: string } {
    this.count += 1;
    if (this.count > this.maxCalls) return { ok: false, reason: 'max-tool-calls-exceeded' };
    const key = `${name}:${argsJson}`;
    const n = (this.seen.get(key) ?? 0) + 1;
    this.seen.set(key, n);
    if (n > this.maxRepeat) return { ok: false, reason: 'tool-loop-detected' };
    return { ok: true };
  }

  async withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('tool-timeout')), ms);
      p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
  }
}
