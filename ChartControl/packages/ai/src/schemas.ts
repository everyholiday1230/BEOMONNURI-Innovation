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
  /*
     ★★★ 피보나치(2026-09-18). 여태 "그릴 수 없다" 고 답하도록 프롬프트에 적어 두었는데,
       klinecharts 에 `fibonacciLine` 내장 오버레이가 있고 **화면 도구에도 이미 있었다**
       (chart-actions.js 의 `fib`). 즉 못 하는 게 아니라 AI 경로만 없었다.
       "할 수 없다" 고 말하는 것이 사실이 아니었으므로 만들었다.
  */
  'createFibonacci',
  'addIndicator',
  'removeIndicator',
  /*
     ★★★ 지표 **설정 변경**(2026-09-18). 이 명령이 없어서 "RSI 를 7 로 바꿔줘" 가
       중복 추가가 됐다(실측: RSI[14] 와 RSI[7] 두 창). 말로 차트를 조작하는 것이
       우리 서비스이므로 설정 변경은 기본 기능이다.
  */
  'setIndicatorParams',
  /*
     ★★★ 고객이 만든 **신호 규칙**(2026-09-18). 매매 신호는 우리가 주는 것이 아니라
       고객이 조건을 쓰고 우리가 성립한 봉을 표시한다. AI 는 고객이 말로 설명한
       조건을 DSL 식으로 옮기는 일을 한다 — 방향을 정하는 것이 아니다.
  */
  'addSignalRule',
  'removeSignalRule',
  'updateOverlay',
  'hideOverlay',
  'deleteOverlay',
  /*
     ★★★ `createSignalProposal` · `createOrderDraftProposal` 을 **제거했다.**

       고객 `bewhite12` 가 "RSI 다이버전스 매수·매도 신호를 차트에 표시해줘" 라고
       두 번 요청했고 두 번 다 아무 응답도 받지 못했다.
       프로덕션 로그(2026-09-11 02:53:34):
         [ai] ★ 제안 거부 — tool=propose_chart_command code=proposal-invalid
              reason=args: signalId: Required
              args={"command":"createSignalProposal","argsJson":"{\"label\":\"RSI diverge…

       ★ 두 명령은 **`signalId` 만** 받는다. 이미 존재하는 SignalObject 를 가리키는
         값이다. 그런데 그 SignalObject 를 **만드는 경로가 AI 에게 없다** —
         예전 `propose_signal` 도구는 2026-09-08 에 `review_setup` 으로 바뀌었다
         (AI 가 매매 신호를 발신하지 않기로 한 운영 결정).
       ★ 화면에도 **처리기가 없다.** `src/ai-copilot.jsx` 의 switch 는 이 두 이름에서
         `default` 로 떨어진다.
       ★★ 즉 **모델만 부를 수 있는 죽은 명령**이었다. 이름이 목록에 있으니 모델은
         "신호를 만들 수 있다" 고 판단해 호출하고, 인자를 채울 방법이 없어 반드시
         검증에서 떨어진다. **고객이 무엇을 요청해도 실패하는 경로**다.
       ★ 이 저장소의 규칙 — **죽은 버튼을 두지 않는다.** 목록에서 지우면 모델은
         이 이름을 호출할 수 없고, 대신 실제로 되는 것(수평선·지표)을 쓰거나
         못 한다고 말한다.
  */
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
/*
   ★★ **추세선이 아예 그려지지 않았다.** 이 자리가 원인이다.

     `args` 가 평면 레코드(문자열·숫자·불리언·그 배열)였다. 그런데 추세선은
     `points: [{time,price},{time,price}]` 이고 마커는 `point: {time,price}` 다 —
     **중첩 객체**다. 그래서 앞의 per-command 검증(validateChartCommandArgs)을 통과한
     뒤 여기서 `args.point: Invalid input` 으로 떨어졌다.

     결과: AI 에게 "추세선 그려줘" 라고 하면 조용히 아무 일도 일어나지 않았다.
     고객 질문("각종 선들도 그려달라고 하면 그려지나?")의 답이 '아니오' 였다.

   ★ 앞서 per-command 스키마가 이미 엄격하게 검증한다(OverlayPoint 는 time·price 를
     정확히 요구한다). 그래서 여기서는 **검증된 값을 담을 수 있을 만큼만** 넓힌다 —
     z.unknown() 으로 열어버리지 않는다. 열면 무엇이 들어오는지 이 스키마만 읽고
     알 수 없게 된다.

   ★★ 이것을 고치면 `createLongMarker` 가 처음으로 이 경로를 통과할 수 있게 된다.
     즉 방향 가드(orchestrator 의 DIRECTION_BEARING_COMMANDS)가 **이제부터 실제로
     필요하다.** 전에는 이 평면 레코드가 우연히 막고 있었을 뿐이고, 의도된 방어가
     아니었다 — 우연히 막히는 것에 안전을 기대면 안 된다.
*/
const ArgScalar = z.union([z.string(), z.number(), z.boolean()]);
const ArgPoint = z.object({ time: EpochMs, price: RawDecimalString }).strict();
/*
   ★★★ **`updateOverlay` 가 구조적으로 부를 수 없었다 — 위 사고와 같은 자리다.**

     위 주석은 `point`·`points`(중첩 객체)를 빠뜨려 추세선이 안 그려진 일을 적어 두었다.
     그런데 고치면서 `updateOverlay` 의 `patch` 를 빠뜨렸다. `patch` 는
     `{ label: "..." }` 같은 **평면 객체**이고 ArgPoint 도 배열도 아니므로 거부된다.

     프로덕션 로그(2026-09-18 03:05:40)로 드러났다:
       [ai] ★ 제안 거부 — tool=propose_chart_command code=proposal-invalid
       reason=args.patch: Invalid input
       args={"command":"updateOverlay","argsJson":"{\\"overlayId\\":\\"ai-1\\",
             \\"patch\\":{\\"label\\":\\"MACD 기준선\\"}}"}

     즉 "라벨 바꿔줘" 가 **한 번도 동작한 적이 없다.** 명령별 스키마
     (CHART_COMMAND_ARG_SCHEMAS.updateOverlay)는 통과하는데 이 앞 관문에서 떨어진다.

   ★ 같은 실수를 세 번째로 하지 않으려면 **명령별 스키마가 받는 모양을 이 스키마도
     받을 수 있어야 한다.** 그것을 시험이 확인한다(chart-control-surface).

   ★ `z.unknown()` 으로 열지 않는다. 열면 무엇이 들어오는지 이 스키마만 읽고 알 수 없다.
     `patch` 는 스칼라만 담는 평면 객체이므로 그만큼만 허용한다.
*/
const ArgFlatObject = z.record(ArgScalar);
const ArgValue = z.union([ArgScalar, ArgPoint, ArgFlatObject, z.array(z.union([ArgScalar, ArgPoint]))]);

export const AiChartCommandSchema = AiCommonFields.merge(cmd).extend({
  args: z.record(ArgValue).default({}),
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
  /*
     피보나치 되돌림 — 두 점(시작·끝)으로 그린다.

     ★ 두 점은 **실제 캔들 시각**이어야 한다. 추세선(createTrendLine)과 같은 규칙이다.
     ★ 비율은 klinecharts 가 정한다(23.6/38.2/50/61.8/78.6/100). 우리가 지정하지
       않는다 — 화면 도구로 그린 것과 같은 도형이어야 고객이 혼란스럽지 않다.
  */
  createFibonacci: z.object({
    points: z.tuple([OverlayPoint, OverlayPoint]),
    label: z.string().max(80).optional(),
  }),
  addIndicator: z
    .object({
      indicator: z.enum(AI_INDICATORS),
      params: z.array(z.number().int().positive().max(1000)).max(6).optional(),
      label: z.string().max(60).optional(),
    }),
  removeIndicator: z.object({ indicator: z.string().min(1).max(20) }),
  /*
     지표 설정(기간) 변경.

     ★ 양의 정수만 받는다. 0·음수·소수를 넘기면 klinecharts 가 계산에서 멈출 수 있고
       그때 화면 전체가 굳는다. 최대 6개는 addIndicator 와 같은 한도다.
     ★ 상한 1000 — 봉 수(1000)보다 큰 기간은 값이 나오지 않는다.
  */
  setIndicatorParams: z.object({
    indicator: z.enum(AI_INDICATORS),
    params: z.array(z.number().int().positive().max(1000)).min(1).max(6),
  }),
  /*
     신호 규칙 추가.

     ★★ `rule` 은 **DSL 표현식**이다. 임의 자바스크립트가 아니다 — 서버가
       validateIndicatorFormula() 로 한 번 더 검증하고, 화면이 렌더 직전에 또 파싱한다
       (이중 방어). 길이 상한은 DSL 의 MAX_LEN(600)과 같아야 한다.

     ★★★ `direction` 은 **선택**이고 기본이 없음이다. 고객이 "골든크로스면 매수" 라고
       말했으면 'long' 이 되고, "골든크로스 표시해줘" 라고만 했으면 방향이 없다.
       AI 가 채워 넣으면 그 순간 우리가 방향을 발신한 것이 된다.
  */
  addSignalRule: z.object({
    name: z.string().trim().min(1).max(24),
    rule: z.string().trim().min(1).max(600),
    direction: z.enum(['long', 'short']).optional(),
  }),
  removeSignalRule: z.object({ name: z.string().trim().min(1).max(24) }),
  updateOverlay: z.object({ overlayId: z.string().min(1), patch: z.record(z.union([z.string(), z.number(), z.boolean()])) }),
  hideOverlay: z.object({ overlayId: z.string().min(1) }),
  deleteOverlay: z.object({ overlayId: z.string().min(1) }),
  // ★ createSignalProposal · createOrderDraftProposal 제거 — 위 주석 참조.
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

/**
 * 고객이 만든 셋업의 **검토 결과**.
 *
 * ★★ 예전 `AiSignalObjectSchema` 를 대체한다. 그 스키마는 `aiGenerated:
 *   z.literal(true)` 였다 — 리터럴이라 "AI 가 만든 신호" 외에는 **표현할 자리가
 *   없었다.** 고객이 만든 셋업을 담을 수 없었고, 그래서 기능이 자연히 AI 발신으로
 *   흘렀다. 스키마가 제품의 성격을 정하고 있었다.
 *
 * ★ `author` 에 'ai' 를 넣지 않는다. 넣으면 그 경로가 다시 생긴다.
 *
 * ★ `confidence` 를 제거했다. AI 가 고객 셋업에 확신도 점수를 붙이면 그것이 곧
 *   예측이고 추천이다. 대신 계산·검증 결과(riskReward · missing ·
 *   contradictingEvidence)를 담는다 — 이것은 사실 진술이다.
 *
 * ★ direction · entry · stop · targets 는 **고객이 준 값**이다. orchestrator 가
 *   고객이 방향을 말했는지 확인한 뒤에만 이 객체를 만든다.
 */
/*
   한 방향의 셋업. 고객이 방향을 말했으면 1개, 말하지 않았으면 롱·숏 2개가 온다.

   ★★ '주(primary)' 와 '부(alternate)' 로 나누지 않는다. 나누면 어느 쪽이 주인지가
     곧 추천으로 읽히고, 그러면 방향을 AI 가 고른 것과 다르지 않다. 배열에 나란히
     담아 어느 쪽도 앞서지 않게 한다.
*/
export const SetupSideSchema = z
  .object({
    direction: DirectionSchema,
    entry: DecimalString,
    stop: DecimalString.optional(),
    targets: z.array(PositiveDecimalString).max(3).default([]),
    riskReward: DecimalString.optional(),
    invalidation: z.string().max(500).optional(),
    /* 이 방향과 어긋나는 근거. 양방향일 때 각 방향마다 다르다. */
    contradictingEvidence: z.array(z.string().max(500)).default([]),
  })
  .strict();
export type SetupSide = z.infer<typeof SetupSideSchema>;

export const AiSetupReviewSchema = z
  .object({
    reviewId: z.string().min(1),
    schemaVersion: z.number().int().positive(),
    symbol: z.string().min(1),
    marketType: MarketTypeSchema,
    timeframe: TimeframeSchema,
    /* ---- 고객이 방향을 말했는가 ---- */
    /*
       ★★ 이 값이 화면 표현을 정한다.

         true  → 고객이 방향을 말했다. sides 는 1개. 그 방향으로 검토한 결과다.
         false → 말하지 않았다. sides 는 2개(롱·숏). **어느 쪽도 권하지 않는 제시**다.

       ★ 서버가 고객 문장을 보고 정한다. 모델이 정하게 두면 "말한 것으로 간주" 해
         버리고 방향 발신 금지가 무력해진다.
    */
    directionStatedByUser: z.boolean(),
    /*
       ---- AI 가 자기 방향 견해를 말한 경우 ----

       ★★★ 운영 결정(2026-09-18): AI 는 **자기 견해를 참고자료로** 말할 수 있다.
         약관 제2조의2(AI 견해)가 그 성격을 정의한다 — 조언·추천·권유가 아니고,
         고객 사정에 맞춘 것이 아니고, 틀릴 수 있고, 판단은 고객 것이다.

       ★★ `directionStatedByUser` 와 **구별한다.** 둘을 섞으면 AI 가 만든 숫자를
         "고객이 준 것" 으로 기록하게 되고, 그것은 우리가 방향을 발신하고도 고객
         책임으로 적는 것이 된다. 실제로 그 위험 때문에 예전 프롬프트는 STEP 3 에서
         review_setup 호출을 금지했다.

       ★ 기본 false — 이 값을 넣지 않으면 예전과 똑같이 동작한다(양방향 강제).
    */
    directionByAi: z.boolean().default(false),
    /*
       ★★★ **면책 고지 없이 방향을 말할 수 없다.** 이 값이 true 여야 스키마를 통과한다
         (아래 superRefine). 화면이 고지를 붙이는 것과 별개로, **데이터 자체에** 고지
         사실이 남아야 나중에 "그때 고지했는가" 를 확인할 수 있다.
    */
    aiOpinionDisclosed: z.boolean().default(false),
    /* ---- 셋업 (1개 또는 롱·숏 2개) ---- */
    sides: z.array(SetupSideSchema).min(1).max(2),
    /* ---- AI 가 계산·검증한 것 (방향과 무관한 부분) ---- */
    missing: z.array(z.enum(['stopLoss', 'invalidation', 'takeProfit'])).max(3).default([]),
    /* 방향과 무관한 관찰(지지·저항·추세·모멘텀). 방향을 말하지 않아도 항상 유효하다. */
    observations: z.array(z.string().max(500)).max(8).default([]),
    /* ---- 출처·시각 ---- */
    /*
       ★ 'ai_opinion' 은 **방향까지 AI 가 낸 경우**다. 'user_ai_assisted' 는 방향은
         고객이 정하고 숫자를 AI 가 도운 경우다. 둘을 구별해야 기록에서
         "누가 방향을 정했는가" 를 되짚을 수 있다.
    */
    author: z.enum(['user', 'user_ai_assisted', 'ai_opinion']),
    model: z.string().min(1),
    promptVersion: z.string().min(1),
    dataSnapshotId: z.string().min(1),
    dataTimestamp: EpochMs,
    expiresAt: EpochMs,
    userEdited: z.boolean(),
    status: AiSignalStateSchema,
  })
  .strict()
  /*
     ★★ 대칭을 **스키마가** 강제한다.

       방향을 말하지 않았으면 sides 가 정확히 2개여야 하고 롱·숏을 모두 담아야 한다.
       한쪽만 오면 그것이 AI 의 방향 발신이다 — 검증에서 떨어뜨린다.

     ★ 코드 여러 곳에서 검사하지 않고 스키마에 둔다. 검사 지점이 늘면 한 곳이
       빠지고, 빠진 곳이 곧 구멍이 된다(차트 명령 경로에서 실제로 그랬다).
  */
  .superRefine((v, ctx) => {
    const bad = (message: string, path: (string | number)[] = ['sides']) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    /*
       ★★★ **방향의 출처가 둘일 수는 없다.** 고객이 말했다고 하면서 AI 견해라고도
         하면 기록이 모순되고, 나중에 누가 정했는지 확인할 수 없다.
    */
    if (v.directionStatedByUser && v.directionByAi) {
      bad('direction cannot come from both the user and the AI', ['directionByAi']);
      return;
    }

    if (v.directionStatedByUser) {
      if (v.sides.length !== 1) bad('direction stated by user → exactly one side');
      /* ★ 고객이 방향을 말한 건에 AI 견해 표기를 붙이면 출처가 흐려진다. */
      if (v.author === 'ai_opinion') bad("author must not be 'ai_opinion' when the user stated the direction", ['author']);
      return;
    }

    if (v.directionByAi) {
      /*
         ★★★ AI 가 방향을 말하는 경로. **세 가지를 모두 요구한다.**
           ① 한 방향만 (양방향이면 그것은 견해가 아니라 중립 제시다)
           ② 면책 고지 사실이 데이터에 남아 있어야 한다
           ③ author 가 'ai_opinion' 이어야 한다 — 우리가 낸 견해를 고객 것으로
              기록하지 않기 위해서다
      */
      if (v.sides.length !== 1) bad('AI opinion → exactly one side');
      if (!v.aiOpinionDisclosed) {
        bad('AI opinion requires aiOpinionDisclosed=true (reference material, not advice)', ['aiOpinionDisclosed']);
      }
      if (v.author !== 'ai_opinion') bad("AI opinion → author must be 'ai_opinion'", ['author']);
      /*
         ★★ 견해에도 **반대 근거**를 요구한다. 한쪽 근거만 적은 것은 견해가 아니라
           권유에 가깝다. 약관 제2조의2 4호("틀릴 수 있다")를 데이터로도 지킨다.
      */
      const side = v.sides[0];
      if (side && side.contradictingEvidence.length === 0) {
        bad('AI opinion must list evidence against its own view', ['sides', 0, 'contradictingEvidence']);
      }
      return;
    }

    /* 아무도 방향을 말하지 않은 경우 — 예전과 같다. 양방향을 동등하게 제시한다. */
    if (v.sides.length !== 2) {
      bad('direction not stated → both long and short must be presented');
      return;
    }
    const dirs = new Set(v.sides.map((s) => s.direction));
    if (!dirs.has('long') || !dirs.has('short')) {
      bad('direction not stated → sides must be one long and one short');
    }
  });
export type AiSetupReview = z.infer<typeof AiSetupReviewSchema>;

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
