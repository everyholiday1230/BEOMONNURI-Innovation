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
  /*
     ★★ 복기(post-mortem)용. **이용자 본인이 이미 끝낸 거래**만 읽는다.

       왜 필요한가: 지금까지 AI 는 "앞으로 어떻게 할까" 만 도왔다. 그런데 고객이
       실제로 손실을 줄이는 방법은 자기가 무엇을 했는지 보는 것이다 — 손절을 몇 번
       옮겼는지, 계획한 손익비와 실제 결과가 얼마나 달랐는지.

     ★ 과거만 본다. 미래 예측이나 수익 약속의 근거로 쓰이지 않는다.
     ★ 조회 범위는 서버가 정한다(본인 것만). symbol/limit 은 좁히는 데만 쓴다.
  */
  get_user_trade_history: z
    .object({
      symbol: SymbolArg.nullable(),
      limit: z.number().int().min(1).max(50),
    })
    .strict(),
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
  /*
     ★★ `propose_signal` 을 `review_setup` 으로 바꿨다.

       예전 도구는 `signalJson` 한 덩이를 받았다. 그 안에 방향·진입·손절·목표가가
       전부 들어 있어서 **모델이 다 만들어 넣을 수 있었다.** 스키마가 그것을 막지
       않았다.

     ★★ 이제 `sides` 배열로 받는다 — 1개 또는 롱·숏 2개.

       · 고객이 방향을 말했으면 sides 1개(그 방향).
       · 말하지 않았으면 sides 2개(롱·숏 **둘 다**).

       처음에는 방향이 없으면 도구 호출 자체를 거부했다. 그랬더니 고객이
       "BTC 어때?" 처럼 방향을 안 쓰고 묻는 대부분의 경우에 **아무 답도 못 받았다.**
       막는 것이 목적이 아니다 — AI 가 방향을 **고르지** 않게 하는 것이 목적이고,
       양쪽을 같이 보여주면 그 목적을 지키면서 고객은 필요한 답을 다 받는다.

     ★ '주(primary)' 와 '부(alternate)' 로 나누지 않는다. 나누면 어느 쪽이 주인지가
       곧 추천이 된다. 배열에 나란히 담는다.

     ★ 대칭은 서버 스키마(AiSetupReviewSchema.superRefine)가 강제한다. 한쪽만 오면
       검증에서 떨어진다 — 프롬프트로 부탁하는 것보다 강하다.
  */
  review_setup: z
    .object({
      /*
         방향별 셋업. 고객이 방향을 말했으면 1개, 말하지 않았으면 롱·숏 2개.
         ★ 2개일 때 어느 쪽도 권하지 않는다. 순서에 의미를 두지 않는다.
      */
      sides: z
        .array(
          z
            .object({
              direction: z.enum(['long', 'short']),
              /** 진입가. 고객이 말했으면 그 값, 양방향 제시일 때는 캔들에서 읽은 수준. */
              entry: z.string().min(1).max(40),
              /** 손절가. 없으면 생략하고 missing 에 담는다. */
              stop: z.string().min(1).max(40).optional(),
              /** 목표가(최대 3개). */
              targets: z.array(z.string().min(1).max(40)).max(3).default([]),
              /** 계산한 손익비. calculate_risk_reward 결과를 그대로 넣는다. */
              riskReward: z.string().min(1).max(40).optional(),
              /** 이 방향에 **반대되는** 근거. 캔들에서 읽은 것만. */
              contradictingEvidence: z.array(z.string().min(1).max(500)).max(6).default([]),
              /** 무엇이 이 방향을 무효로 만드는가. */
              invalidation: z.string().max(500).optional(),
            })
            .strict(),
        )
        .min(1)
        .max(2),
      /** 빠진 항목. 지어내지 말고 없는 것을 없다고 적는다. */
      missing: z.array(z.enum(['stopLoss', 'invalidation', 'takeProfit'])).max(3).default([]),
      /** 방향과 무관한 관찰(지지·저항·추세·모멘텀). 방향을 몰라도 항상 적을 수 있다. */
      observations: z.array(z.string().min(1).max(500)).max(8).default([]),
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
    '- updateOverlay: {"overlayId":"ai-1","patch":{"label":"support 41800"}}\n' +
    '  NOT SUPPORTED in patch: color, width/thickness, lineStyle. The renderer derives colour and ' +
    'thickness from the overlay source (AI draft vs user), so those keys change nothing. If the user ' +
    'asks to recolour or thicken a line, say plainly that this is not adjustable rather than calling ' +
    'the tool — do not report a change that will not happen.\n' +
    '- deleteOverlay / hideOverlay: {"overlayId":"ai-1"}\n' +
    'Prices must come from MARKET_DATA — never invent a level. Shown to the user as a proposal; never auto-applied.',
  review_setup:
    'Review the setup the USER authored. `direction`, `entry`, `stop` and `targets` must be the values ' +
    'the user stated — you must not choose or invent them. Return the computed riskReward, what is ' +
    'missing, and evidence that argues AGAINST the setup. This is the user\'s own analysis, not a ' +
    'recommendation, and is never auto-executed. If the user gave no direction, do not call this tool — ' +
    'ask them to choose instead.',
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
  get_user_trade_history:
    "Read-only history of the authenticated user's own COMPLETED orders (filled, cancelled, rejected), "
    + 'newest first. Use this for post-trade review: compare what the user planned against what they '
    + 'actually did. Past facts only — never present it as a prediction or a guarantee of future results.',
  calculate_risk_reward: 'Compute risk/reward from entry/stop/target decimal strings.',
  validate_chart_command: 'Validate a proposed ChartCommand JSON against the schema (no side effects).',
};

/** Minimal Zod→JSON-Schema for OpenAI strict function tools (objects of scalars/enums/arrays). */
/**
 * JSON Schema 노드에 `null` 을 허용으로 더한다. **다른 키는 건드리지 않는다.**
 *
 * ★ `items`·`enum`·`properties` 를 잃으면 OpenAI 가 정의를 거부한다(400). 예전 코드가
 *   `{ type: [t,'null'] }` 만 돌려줘 그것들을 버렸다.
 */
function withNull(js: Record<string, unknown>): Record<string, unknown> {
  const t = js.type;
  if (t === undefined) return { ...js, type: ['null'] };
  if (Array.isArray(t)) return t.includes('null') ? js : { ...js, type: [...t, 'null'] };
  return { ...js, type: [t, 'null'] };
}

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as unknown as { _def: { typeName: string } })._def;
  const tn = def.typeName;
  if (tn === 'ZodObject') {
    const shape = (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [key, val] of Object.entries(shape)) {
      /*
         ★★★ **optional 은 null 을 허용해야 한다.** 주석은 "optionals are nullable" 이라고
           적혀 있었는데 **실제로는 그렇지 않았다.**

             z.string().optional() → ZodOptional 언랩 → { "type": "string" }
             그런데 required 에는 들어간다 → 모델은 **반드시 문자열을 넣어야 한다**

           OpenAI strict 모드에서 이것은 "빈 값을 줄 수 없다" 는 뜻이다. 그래서
           `stop`(손절가)이 없는 상황에서도 모델이 값을 채워야 하고, 결과는 둘 중 하나다:
             · 손절가를 **지어낸다** — 근거 없는 가격을 고객에게 제시하는 것이다
             · ""/"N/A" 를 넣는다 → DecimalString 검증 실패 → **검토 전체가 사라진다**
               (운영자가 본 "did not pass validation, so nothing was drawn" 이 이것이다)

         ★ 고침: optional 이면 스키마에 'null' 을 더한다. 모델이 "없음" 을 표현할 수
           있게 되고, 파싱 쪽에서 null → 필드 없음으로 되돌린다(아래 stripNulls).

         ★ required 는 그대로 전부 넣는다 — OpenAI strict 모드의 요구사항이다.
      */
      const isOptional = (val as unknown as { _def: { typeName: string } })._def.typeName === 'ZodOptional';
      const js = zodToJsonSchema(val) as Record<string, unknown>;
      properties[key] = isOptional ? withNull(js) : js;
      required.push(key);
    }
    return { type: 'object', properties, required, additionalProperties: false };
  }
  if (tn === 'ZodString') return { type: 'string' };
  if (tn === 'ZodNumber') return { type: 'number' };
  if (tn === 'ZodBoolean') return { type: 'boolean' };
  if (tn === 'ZodEnum') return { type: 'string', enum: (def as unknown as { values: string[] }).values };
  if (tn === 'ZodArray') return { type: 'array', items: zodToJsonSchema((def as unknown as { type: z.ZodTypeAny }).type) };
  if (tn === 'ZodNullable') {
    /*
       ★★★ 예전에는 `{ type: [inner.type, 'null'] }` 만 돌려줬다. **inner 의 나머지를
         전부 버렸다** — 배열의 `items`, enum 의 `enum`, 객체의 `properties` 까지.

         실측: z.array(z.string()).nullable() → {"type":["array","null"]} · items 없음
         → OpenAI 는 items 없는 array 를 거부한다(400). 오늘 낮에 겪은 그 400 과
         같은 부류다.

       ★ 그래서 inner 를 그대로 두고 type 에만 'null' 을 더한다(withNull).
    */
    return withNull(zodToJsonSchema((def as unknown as { innerType: z.ZodTypeAny }).innerType) as Record<string, unknown>);
  }
  if (tn === 'ZodOptional') return zodToJsonSchema((def as unknown as { innerType: z.ZodTypeAny }).innerType);
  /*
     ★★★ **AI 전체가 400 으로 죽은 원인이 이것이었다.**

       `z.array(...).default([])` 는 typeName 이 `ZodDefault` 다. 이 함수가 그것을
       모르고 아래 `return {}` 로 떨어져 **type 없는 빈 스키마**를 만들었다.
       OpenAI 는 함수 정의를 검증하므로 즉시 거절한다:

         400 Invalid schema for function 'review_setup':
         In context=('properties','sides','items','properties','targets'),
         schema must have a 'type' key.

       함수 정의 하나가 잘못되면 **그 호출 전체가 실패한다.** 그래서 AI 기능이
       통째로 안 됐다(프로덕션 로그로 확인).

     ★ default 는 값이 없을 때 채우는 것이므로 JSON Schema 로는 내부 타입 그대로다.
  */
  if (tn === 'ZodDefault') return zodToJsonSchema((def as unknown as { innerType: z.ZodTypeAny }).innerType);
  /*
     ★★ `.refine()` / `.superRefine()` / `.transform()` 은 typeName 이 `ZodEffects` 다.
       이것도 처리되지 않아 빈 스키마가 됐다 — **모르는 타입을 던지게 바꾸자마자
       바로 드러났다.** 그전에는 조용히 잘못된 정의가 만들어지고 있었다.

     ★ 검증·변환 규칙은 JSON Schema 로 표현할 수 없다. 구조는 내부 스키마 그대로다.
  */
  if (tn === 'ZodEffects') return zodToJsonSchema((def as unknown as { schema: z.ZodTypeAny }).schema);
  /*
     ★★★ 모르는 타입은 **조용히 넘기지 않는다.**

       예전에는 `return {}` 였다. 그래서 스키마에 새 zod 타입을 쓰는 순간 아무 경고도
       없이 잘못된 함수 정의가 만들어지고, **AI 기능 전체가 죽는다.** 실제로 그렇게
       16일간 간헐적으로(그리고 어제부터는 완전히) 실패했다.

     ★ 던지면 부팅·시험 단계에서 즉시 드러난다. 고객 앞에서 죽는 것보다 낫다.
       tool-schema 시험이 모든 스키마를 변환해 이 경로를 확인한다.
  */
  throw new Error(
    `zodToJsonSchema: 처리하지 않는 zod 타입 '${tn}' — 함수 정의가 무효가 되어 AI 호출 전체가 실패한다. 이 함수에 분기를 추가할 것.`,
  );
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
  /**
   * 이용자 본인의 종료된 주문 이력(복기용).
   *
   * ★ userId 는 서버가 세션에서 넣는다. 모델이 준 값을 쓰지 않는다 — 남의 거래를
   *   읽는 경로가 되어서는 안 된다.
   */
  get_user_trade_history(userId: string, symbol: string | null, limit: number): Promise<unknown>;
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
      /*
         ★ userId 는 ctx(세션)에서만 온다. 모델이 준 값은 쓰지 않는다 — 그러면
           남의 거래 기록을 읽는 경로가 된다.
      */
      case 'get_user_trade_history':
        return this.ds.get_user_trade_history(ctx.userId, (a.symbol as string) ?? null, a.limit as number);
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
  /*
     ★★★ **모델이 보낸 null 을 "필드 없음" 으로 되돌린다.**

       위 zodToJsonSchema 가 optional 필드에 null 을 허용하도록 바꿨다(그러지 않으면
       모델이 손절가를 지어내야 한다). 그런데 zod 의 `.optional()` 은 **null 을 받지
       않는다** — undefined 만 받는다. 그래서 되돌리지 않으면 여기서 검증이 실패하고
       검토 전체가 사라진다(고치려던 그 증상과 똑같아진다).

     ★ 재귀로 지운다. 중첩 객체·배열 안의 null 도 같은 이유로 지워야 한다.
     ★ 배열 요소의 null 은 **지우지 않고 그대로 둔다** — 배열 길이가 줄면 모델이
       의도한 순서(예: 목표가 1·2·3)가 어긋난다. 그런 경우는 검증에서 걸러야 한다.
  */
  const stripNulls = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stripNulls);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (val === null) continue;
        out[k] = stripNulls(val);
      }
      return out;
    }
    return v;
  };
  const v = PROPOSAL_TOOL_SCHEMAS[name].safeParse(stripNulls(parsed));
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
