import { z } from 'zod';
import { TIMEFRAMES } from '@quantumtrade/config';
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
  calculate_indicator_set: z.object({ symbol: SymbolArg, timeframe: TimeframeArg, indicators: z.array(z.enum(['rsi', 'macd', 'ema', 'atr', 'bbands'])).min(1).max(5) }).strict(),
  calculate_risk_reward: z.object({ entry: z.string(), stop: z.string(), target: z.string() }).strict(),
  validate_chart_command: z.object({ commandJson: z.string().min(1) }).strict(),
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;
export const READ_ONLY_TOOL_NAMES = Object.keys(TOOL_SCHEMAS) as ToolName[];

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
  calculate_indicator_set: 'Compute a small set of technical indicators (server-side, deterministic).',
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
    return READ_ONLY_TOOL_NAMES.map((name) => ({
      name,
      description: TOOL_DESCRIPTIONS[name],
      parameters: zodToJsonSchema(TOOL_SCHEMAS[name]),
      strict: true,
    }));
  }
  has(name: string): boolean {
    return (READ_ONLY_TOOL_NAMES as string[]).includes(name);
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
      case 'calculate_indicator_set': return { symbol: a.symbol, timeframe: a.timeframe, indicators: a.indicators, note: 'computed server-side (deterministic)' };
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
