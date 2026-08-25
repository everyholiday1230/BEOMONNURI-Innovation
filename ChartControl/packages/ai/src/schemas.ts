import { z } from 'zod';
import { DecimalString as RawDecimalString, PositiveDecimalString as RawPositiveDecimalString, EpochMs } from '@quantumtrade/schemas';
import { TIMEFRAMES } from '@quantumtrade/config';

/**
 * Phase 4 AI structured-output schemas (docs PHASE4-04). These EXTEND the Phase 1 ChartCommand/Signal
 * concepts with the AI provenance/safety fields required for a production copilot. LLM output is NEVER
 * executed directly — it must pass this schema + the orchestrator validation pipeline first.
 */
export const AI_CHART_COMMAND_VERSION = 2;
export const AI_SIGNAL_SCHEMA_VERSION = 2;

// LLM 은 가격/레벨을 JSON 숫자로 내보내는 경우가 많다(예: 65000). 원장의 문자열 소수 규칙은
// 그대로 유지하되, 숫자로 와도 문자열로 변환해 받아들인다. (문자열은 그대로 통과.)
const DecimalString = z.preprocess((v) => (typeof v === 'number' ? String(v) : v), RawDecimalString);
const PositiveDecimalString = z.preprocess((v) => (typeof v === 'number' ? String(v) : v), RawPositiveDecimalString);

export const MarketTypeSchema = z.enum(['futures', 'perpetual']);
export const TimeframeSchema = z.enum(TIMEFRAMES);
export const DirectionSchema = z.enum(['long', 'short']);

/** Common provenance fields every AI ChartCommand must carry (docs PHASE4-06). */
export const AiCommonFields = z.object({
  schemaVersion: z.number().int().positive(),
  commandId: z.string().min(1),
  conversationId: z.string().min(1),
  userId: z.string().min(1),
  symbol: z.string().min(1),
  marketType: MarketTypeSchema,
  timeframe: TimeframeSchema,
  createdAt: EpochMs,
  expiresAt: EpochMs,
  source: z.enum(['ai', 'user', 'system']),
  confidence: z.number().min(0).max(100),
  reasoningSummary: z.string().max(600), // SUMMARY only — never raw chain-of-thought
  dataSnapshotId: z.string().min(1),
  aiGenerated: z.boolean(),
});

const OverlayPoint = z.object({ time: EpochMs, price: DecimalString });

/** The allowlisted AI chart commands (docs PHASE4-06). Anything else fails validation. */
export const AI_CHART_COMMANDS = [
  'createTrendLine',
  'createHorizontalLevel',
  'createSupportResistance',
  'createEntryZone',
  'createStopLoss',
  'createTakeProfit',
  'createLongMarker',
  'createShortMarker',
  'createInvalidationLevel',
  'addIndicator',
  'removeIndicator',
  'updateOverlay',
  'hideOverlay',
  'deleteOverlay',
  'createSignalProposal',
  'createOrderDraftProposal',
] as const;

/**
 * Indicators the chart can render (KLineCharts built-ins). The AI may only ask for these — anything
 * else fails validation. `params` are the indicator calc-params (e.g. [14] for RSI, [12,26,9] for
 * MACD); the chart applies sane defaults when omitted.
 */
export const AI_INDICATORS = [
  'MA', 'EMA', 'SMA', 'BOLL', 'SAR', 'BBI', // overlay on the price pane
  'MACD', 'RSI', 'KDJ', 'VOL', 'ATR', 'CCI', 'WR', 'DMI', 'OBV', 'TRIX', 'ROC', 'BIAS', 'STOCH', 'VR', 'MTM', // separate pane
] as const;
export type AiIndicatorName = (typeof AI_INDICATORS)[number];
export type AiChartCommandName = (typeof AI_CHART_COMMANDS)[number];

const cmd = z.object({ command: z.enum(AI_CHART_COMMANDS) });

/**
 * A single AI chart command = common provenance fields + a command discriminator + a bounded,
 * strongly-typed `args` object. `args` is intentionally small and validated per command by
 * `validateChartCommandArgs`. There is NO command that submits/cancels/modifies a live order.
 */
export const AiChartCommandSchema = AiCommonFields.merge(cmd).extend({
  args: z.record(z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))])).default({}),
});
export type AiChartCommand = z.infer<typeof AiChartCommandSchema>;

/** Per-command argument schemas (strict). Used by the validation pipeline. */
export const CHART_COMMAND_ARG_SCHEMAS: Record<AiChartCommandName, z.ZodTypeAny> = {
  createTrendLine: z.object({ points: z.tuple([OverlayPoint, OverlayPoint]), label: z.string().max(80).optional() }),
  createHorizontalLevel: z.object({ price: DecimalString, label: z.string().max(80).optional() }),
  createSupportResistance: z.preprocess(
    // LLM 이 kind 대신 type 으로 support/resistance 를 넣는 경우가 있어 별칭 처리한다.
    (v) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const o = v as Record<string, unknown>;
        if (o.kind === undefined && (o.type === 'support' || o.type === 'resistance')) return { ...o, kind: o.type };
      }
      return v;
    },
    z.object({ price: DecimalString, kind: z.enum(['support', 'resistance']) }),
  ),
  createEntryZone: z.object({ priceLo: DecimalString, priceHi: DecimalString }),
  createStopLoss: z.object({ price: DecimalString }),
  createTakeProfit: z.object({ price: DecimalString, index: z.number().int().min(0).max(10) }),
  createLongMarker: z.object({ point: OverlayPoint, text: z.string().max(120) }),
  createShortMarker: z.object({ point: OverlayPoint, text: z.string().max(120) }),
  createInvalidationLevel: z.object({ price: DecimalString }),
  addIndicator: z
    .object({
      indicator: z.enum(AI_INDICATORS),
      params: z.array(z.number().int().positive().max(1000)).max(6).optional(),
      label: z.string().max(60).optional(),
    }),
  removeIndicator: z.object({ indicator: z.string().min(1).max(20) }),
  updateOverlay: z.object({ overlayId: z.string().min(1), patch: z.record(z.union([z.string(), z.number(), z.boolean()])) }),
  hideOverlay: z.object({ overlayId: z.string().min(1) }),
  deleteOverlay: z.object({ overlayId: z.string().min(1) }),
  createSignalProposal: z.object({ signalId: z.string().min(1) }),
  createOrderDraftProposal: z.object({ signalId: z.string().min(1), note: z.string().max(200).optional() }),
};

export function validateChartCommandArgs(cmdName: AiChartCommandName, args: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const schema = CHART_COMMAND_ARG_SCHEMAS[cmdName];
  const r = schema.safeParse(args);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
}

// ---- SignalObject (Phase 4) ----
export const AI_SIGNAL_STATES = [
  'DRAFT',
  'PROPOSED',
  'USER_REVIEW',
  'APPROVED',
  'EDITED',
  'REJECTED',
  'EXPIRED',
  'ORDER_DRAFT_CREATED',
] as const;
export const AiSignalStateSchema = z.enum(AI_SIGNAL_STATES);
export type AiSignalState = (typeof AI_SIGNAL_STATES)[number];

export const AiSignalObjectSchema = z
  .object({
    signalId: z.string().min(1),
    schemaVersion: z.number().int().positive(),
    symbol: z.string().min(1),
    marketType: MarketTypeSchema,
    timeframe: TimeframeSchema,
    direction: DirectionSchema,
    entryZone: z.tuple([DecimalString, DecimalString]),
    stopLoss: DecimalString,
    takeProfits: z.array(PositiveDecimalString).min(1).max(3),
    invalidationLevel: DecimalString,
    confidence: z.number().min(0).max(100),
    riskReward: DecimalString,
    thesis: z.string().max(4000),
    supportingEvidence: z.array(z.string().max(500)).default([]),
    contradictingEvidence: z.array(z.string().max(500)).default([]),
    assumptions: z.array(z.string().max(300)).default([]),
    dataTimestamp: EpochMs,
    expiresAt: EpochMs,
    aiGenerated: z.literal(true),
    model: z.string().min(1),
    promptVersion: z.string().min(1),
    dataSnapshotId: z.string().min(1),
    userEdited: z.boolean(),
    status: AiSignalStateSchema,
  })
  .refine((s) => Number(s.entryZone[0]) <= Number(s.entryZone[1]), { message: 'entryZone must be [lo,hi] with lo<=hi', path: ['entryZone'] });
export type AiSignalObject = z.infer<typeof AiSignalObjectSchema>;

/** Signal state machine. Approval and order submission stay separate; there is no submit here. */
const SIGNAL_T: Record<AiSignalState, AiSignalState[]> = {
  DRAFT: ['PROPOSED', 'REJECTED', 'EXPIRED'],
  PROPOSED: ['USER_REVIEW', 'REJECTED', 'EXPIRED'],
  USER_REVIEW: ['APPROVED', 'EDITED', 'REJECTED', 'EXPIRED'],
  EDITED: ['USER_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED'],
  APPROVED: ['ORDER_DRAFT_CREATED', 'REJECTED', 'EXPIRED'],
  ORDER_DRAFT_CREATED: [], // creating a DRAFT is terminal for the signal; submission is a separate gate
  REJECTED: [],
  EXPIRED: [],
};
export function canTransitionAiSignal(from: AiSignalState, to: AiSignalState): boolean {
  return SIGNAL_T[from]?.includes(to) ?? false;
}
export function transitionAiSignal(from: AiSignalState, to: AiSignalState): AiSignalState {
  if (!canTransitionAiSignal(from, to)) throw new Error(`illegal AI signal transition ${from} -> ${to}`);
  return to;
}
