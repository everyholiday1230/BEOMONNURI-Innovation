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

/*
   차트가 그릴 수 있는 지표 — **KLineCharts 내장 27종 전부.**

   ★★ 이 목록이 유일한 기준이다.

     예전에는 세 곳이 따로 관리돼 어긋나 있었다:
       · 차트 화면(src/chart-indicators.jsx)  27종
       · 이 목록                              21종
       · AI 계산 도구(tools.ts)               5종

     그 결과 두 가지 잘못이 있었다:
       1. 차트에 있는 8종(AO AVP BRAR CR DMA EMV PSY PVT)을 AI 가 다루지 못했다 —
          고객이 그 지표를 켜놓고 물어도 AI 는 손을 댈 수 없었다.
       2. 이 목록에만 있던 ATR·STOCH 는 **KLineCharts 에 없다.** AI 가 추가를
          제안하면 차트가 렌더하지 못하고, 고객에게는 "AI 가 넣었다는데 안 보인다"
          가 된다. 예전에 removeIndicator 가 같은 방식으로 거짓 보고한 적이 있다.

   ★ 목록은 벤더 번들에서 실측해 맞췄다:
       grep 'name:"XXX"' vendor/klinecharts/klinecharts.min.js → 27종
     주석에 적힌 목록을 믿지 않고 라이브러리를 직접 확인했다.

   ★★ 화면 목록과의 일치는 테스트가 지킨다(indicator-parity.test.ts). 사람이 두 곳을
     같이 고치는 방식은 이미 한 번 실패했다.

   ★ `params` 는 지표 계산 인자다(RSI 는 [14], MACD 는 [12,26,9]). 생략하면 차트가
     기본값을 쓴다.
*/
export const AI_INDICATORS = [
  // 가격창 위에 겹쳐 그리는 것
  'MA', 'EMA', 'SMA', 'BOLL', 'BBI', 'SAR', 'AVP',
  // 거래량 계열
  'VOL', 'OBV', 'VR', 'EMV', 'PVT',
  // 모멘텀
  'MACD', 'RSI', 'KDJ', 'CCI', 'WR', 'BIAS', 'BRAR', 'CR',
  // 그 밖
  'ROC', 'MTM', 'AO', 'PSY', 'DMI', 'DMA', 'TRIX',
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
