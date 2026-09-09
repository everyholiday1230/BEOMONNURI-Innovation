import { z } from 'zod';
import { D, checkPrecision, computeOrderMath } from '@quantumtrade/domain';
import type { SymbolInfo } from '@quantumtrade/schemas';
import type { TradingPolicy } from '../trading/risk-engine';

/**
 * B4 — order draft / validation domain.
 *
 * This module answers one question and refuses to answer any other: given an order intent, WOULD it be
 * acceptable, and if not, exactly why. It has no I/O, no exchange client and no submit path, so there is
 * no code path here that could be coaxed into transmitting an order.
 *
 * The result always carries `executable: false`. That is not a placeholder awaiting a flag — it is the
 * contract. `allowed` is computed from the gates, and executability is a strictly stronger property that
 * this deployment never grants.
 */

/** Decimal strings only. A JSON number would already have been rounded before validation saw it. */
const Decimal = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, 'must be a non-negative decimal string');

export const OrderIntentSchema = z
  .object({
    symbol: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]{2,20}$/i)
      .transform((s) => s.toUpperCase()),
    side: z.enum(['long', 'short']),
    type: z.enum(['market', 'limit', 'stop', 'stop_limit']),
    quantity: Decimal,
    // Required for limit/stop_limit; the cross-field rule below enforces that rather than a vague optional.
    price: Decimal.optional(),
    stopPrice: Decimal.optional(),
    leverage: z.coerce.number().int().min(1).max(125).optional(),
    marginMode: z.enum(['cross', 'isolated']).optional(),
    stopLoss: Decimal.optional(),
    takeProfit: Decimal.optional(),
    reduceOnly: z.boolean().optional(),
    /** Client's provenance for the intent. Advisory only: it never affects what is allowed. */
    origin: z.enum(['manual', 'ai_suggestion']).optional(),
  })
  .strict()
  .superRefine((o, ctx) => {
    if ((o.type === 'limit' || o.type === 'stop_limit') && o.price === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price'], message: 'price required for limit orders' });
    }
    if ((o.type === 'stop' || o.type === 'stop_limit') && o.stopPrice === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['stopPrice'], message: 'stopPrice required for stop orders' });
    }
    // A market order with a price is an ambiguous instruction, not a harmless extra field.
    if (o.type === 'market' && o.price !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['price'], message: 'market order must not carry a price' });
    }
  });

export type OrderIntent = z.infer<typeof OrderIntentSchema>;

export interface RiskCheck {
  id: string;
  label: string;
  status: 'ok' | 'fail' | 'warn';
  detail: string;
}

export interface Reason {
  code: string;
  message: string;
}

export interface ValidationContext {
  symbolInfo: SymbolInfo | undefined;
  /*
     심볼 카탈로그가 적재됐는가.

     ★★ 이것을 구분하지 않으면 "symbol X is not supported" 라고 말하게 된다.
       실제로는 **우리가 규격을 못 받은 것**인데 고객은 자기 심볼이 지원되지
       않는다고 읽고 다른 심볼을 찾아 헤맨다. 실서비스에서 그런 일이 있었다
       (고객이 90분간 8번 재시도).
  */
  catalogueLoaded?: boolean;
  policy: TradingPolicy;
  /** Reference price used for market orders and deviation checks; null when the feed is unavailable. */
  referencePrice: string | null;
  /** Freshness of that reference price. A stale price cannot support a notional check. */
  referenceStale: boolean;
  minNotional: string;
  takerFeeRate: string;
  makerFeeRate: string;
  liveTradingEnabled: boolean;
  killSwitchActive: boolean;
  /*
     ★★ **킬스위치 상태를 읽지 못한 상태.** killSwitchActive 로는 표현할 수 없다.

       `OperationalControls.killActive()` 는 DB 를 한 번도 읽지 못했으면 false(차단
       아님)를 돌려준다. 그래서 "운영자가 스위치를 걸지 않았다" 와 "스위치 상태를
       모른다" 가 **똑같이 false** 로 들어온다. 전혀 다른 상황인데 구분이 없었다.

     ★★ 이 값이 없으면 이 화면이 거짓을 말한다:

         운영자가 global_live_trading 을 걸었다
           → DB 를 못 읽는 상황이 겹친다
           → 이 검증은 "gate.killSwitch: ok" → 고객 화면에 "주문 가능"
           → 실제 제출은 trading-routes 에서 거부된다

       실주문이 나가지는 않지만 **화면이 사실과 다른 것을 말한다.** 그리고 고객은
       가능하다고 본 뒤 제출에서 막힌다.

     ★ 실주문 경로(trading-routes → runRiskEngine)는 이미 이 값을 본다. 같은 질문에
       두 경로가 다르게 답하면 어느 쪽이 맞는지 알 수 없다 — 그것을 맞춘다.

     ★ 필수(옵셔널 아님)로 둔다. 선택으로 두면 주입하는 쪽이 빠뜨려도 컴파일이
       통과하고, 빠진 곳이 곧 구멍이 된다. trading-routes 가 같은 이유로 필수다.
  */
  controlsUnknown: boolean;
  /** new_positions 킬스위치. true 면 reduceOnly 가 아닌(=포지션을 새로 열거나 늘리는) 주문을 막는다. */
  newPositionsHalted?: boolean;
  tradingMode: string;
  /** Available balance as a decimal string, or null when the account has no balance snapshot. */
  availableBalance: string | null;
  openPositions: number;
  dailyOrderCount: number;
}

export interface ValidationResult {
  valid: boolean;
  allowed: boolean;
  /** Always false. Declared as the literal type so a future edit cannot widen it silently. */
  executable: false;
  blockingReasons: Reason[];
  warnings: Reason[];
  normalizedOrder: {
    symbol: string;
    side: string;
    type: string;
    quantity: string;
    price: string | null;
    stopPrice: string | null;
    leverage: number | null;
    marginMode: string | null;
    stopLoss: string | null;
    takeProfit: string | null;
    reduceOnly: boolean;
    notional: string | null;
  };
  estimatedFees: { maker: string | null; taker: string | null; assumed: 'maker' | 'taker'; rate: string } | null;
  riskChecks: RiskCheck[];
}

/**
 * Validate an order intent.
 *
 * Fail-closed throughout: anything that cannot be checked (no symbol metadata, no reference price for a
 * market order, no balance snapshot) produces a BLOCKING reason, not a pass. A validator that answers
 * "probably fine" for an order it could not actually evaluate is worse than one that refuses.
 */
export function validateOrderIntent(intent: OrderIntent, ctx: ValidationContext): ValidationResult {
  const checks: RiskCheck[] = [];
  const blocking: Reason[] = [];
  const warnings: Reason[] = [];
  const add = (id: string, label: string, status: RiskCheck['status'], detail: string) =>
    checks.push({ id, label, status, detail });
  const block = (code: string, message: string) => blocking.push({ code, message });

  const sym = ctx.symbolInfo;

  // ---- symbol ---------------------------------------------------------------
  if (!sym && ctx.catalogueLoaded === false) {
    /*
       ★★ 우리 쪽 문제임을 분명히 말하고, 다른 코드로 구분한다. 고객이 지원되지
         않는 심볼이라고 오해하면 있는 기능을 없다고 믿게 된다.
    */
    add('symbol.known', 'Symbol is in the catalogue', 'fail', 'catalogue not loaded on our side');
    block('SYMBOL_CATALOGUE_UNAVAILABLE', 'our exchange symbol catalogue has not loaded yet — this is not your input; please retry shortly');
  } else if (!sym) {
    add('symbol.known', 'Symbol is in the catalogue', 'fail', `${intent.symbol} not found`);
    block('UNKNOWN_SYMBOL', `symbol ${intent.symbol} is not supported`);
  } else {
    add('symbol.known', 'Symbol is in the catalogue', 'ok', sym.id);
  }
  const symbolAllowed = ctx.policy.allowedSymbols.includes(intent.symbol);
  add('policy.symbol', 'Symbol allowed by policy', symbolAllowed ? 'ok' : 'fail', `allowed: ${ctx.policy.allowedSymbols.join(',')}`);
  if (!symbolAllowed) block('SYMBOL_NOT_PERMITTED', `symbol ${intent.symbol} is outside the trading policy`);

  // ---- quantity -------------------------------------------------------------
  const qty = D(intent.quantity);
  if (qty.lte(0)) {
    add('qty.positive', 'Quantity is positive', 'fail', intent.quantity);
    block('QUANTITY_NOT_POSITIVE', 'quantity must be greater than zero');
  } else {
    add('qty.positive', 'Quantity is positive', 'ok', intent.quantity);
  }
  if (sym && qty.gt(0) && D(sym.minQty).gt(qty)) {
    add('qty.min', 'Quantity meets the minimum', 'fail', `${intent.quantity} < ${sym.minQty}`);
    block('BELOW_MIN_QUANTITY', `quantity must be at least ${sym.minQty}`);
  } else if (sym) {
    add('qty.min', 'Quantity meets the minimum', 'ok', `min ${sym.minQty}`);
  }

  // ---- precision / tick / step ---------------------------------------------
  if (sym) {
    const p = checkPrecision(sym, intent.price, intent.quantity);
    add('precision', 'Price and quantity match exchange precision', p.ok ? 'ok' : 'fail', p.ok ? `tick ${sym.tickSize} / step ${sym.stepSize}` : p.errors.join('; '));
    if (!p.ok) block('PRECISION_VIOLATION', p.errors.join('; '));
    if (intent.stopPrice !== undefined) {
      const ps = checkPrecision(sym, intent.stopPrice, intent.quantity);
      add('precision.stop', 'Stop price matches exchange tick size', ps.ok ? 'ok' : 'fail', ps.ok ? `tick ${sym.tickSize}` : ps.errors.join('; '));
      if (!ps.ok) block('STOP_PRECISION_VIOLATION', ps.errors.join('; '));
    }
  }

  // ---- reference / effective price -----------------------------------------
  // A market order has no price of its own, so its notional can only be estimated from a reference. If
  // there is no fresh reference, the notional and minimum-notional checks are not evaluable.
  const effectivePrice = intent.price ?? ctx.referencePrice;
  if (intent.type === 'market') {
    if (ctx.referencePrice === null) {
      add('price.reference', 'Reference price available for a market order', 'fail', 'no reference price');
      block('NO_REFERENCE_PRICE', 'a market order cannot be evaluated without a reference price');
    } else if (ctx.referenceStale) {
      add('price.reference', 'Reference price is fresh', 'fail', 'reference price is stale');
      block('STALE_REFERENCE_PRICE', 'reference price is stale; refusing to evaluate a market order against it');
    } else {
      add('price.reference', 'Reference price is fresh', 'ok', ctx.referencePrice);
    }
  }

  // ---- notional / min notional --------------------------------------------
  let notional: string | null = null;
  if (effectivePrice !== null && effectivePrice !== undefined && qty.gt(0)) {
    notional = D(effectivePrice).mul(qty).toString();
    const meetsMin = D(notional).gte(D(ctx.minNotional));
    add('notional.min', 'Order notional meets the minimum', meetsMin ? 'ok' : 'fail', `${notional} ≥ ${ctx.minNotional}`);
    if (!meetsMin) block('BELOW_MIN_NOTIONAL', `order notional must be at least ${ctx.minNotional}`);

    /*
       ★★ 빈 값·0 = 상한 없음. 그런데 예전 코드는 D(maxOrderNotional) 을 무조건
         호출했다. 프로덕션 설정이 바로 빈 값(TRADE_MAX_ORDER_NOTIONAL='')이라
         D('') 가 DecimalError 를 던진다 — 상한을 풀어둔 설정이 오히려 예외를
         만드는 셈이다. risk-engine 쪽과 같은 규칙으로 맞춘다.
    */
    const capRaw = String(ctx.policy.maxOrderNotional ?? '').trim();
    const capNum = capRaw === '' ? 0 : Number(capRaw);
    const notionalCapped = Number.isFinite(capNum) && capNum > 0;
    const withinCap = !notionalCapped || D(notional).lte(D(capRaw));
    add('policy.notional', 'Order notional within cap', withinCap ? 'ok' : 'fail',
      notionalCapped ? `${notional} ≤ ${capRaw}` : 'no operator cap — exchange risk limit applies');
    if (!withinCap) block('NOTIONAL_ABOVE_CAP', `order notional exceeds the cap of ${capRaw}`);
  } else {
    add('notional.min', 'Order notional meets the minimum', 'fail', 'notional not computable');
    block('NOTIONAL_NOT_COMPUTABLE', 'order notional could not be computed');
  }

  // ---- leverage -------------------------------------------------------------
  const lev = intent.leverage ?? 1;
  const levOk = lev <= ctx.policy.maxLeverage && (!sym || lev <= sym.maxLeverage);
  add('policy.leverage', 'Leverage within policy and symbol limit', levOk ? 'ok' : 'fail', `${lev}x ≤ min(${ctx.policy.maxLeverage}, ${sym?.maxLeverage ?? '?'})`);
  if (!levOk) block('LEVERAGE_ABOVE_LIMIT', `leverage ${lev}x exceeds the permitted maximum`);

  // ---- stop loss / take profit direction ----------------------------------
  if (effectivePrice !== null && effectivePrice !== undefined) {
    const entry = D(effectivePrice);
    if (intent.stopLoss !== undefined) {
      // For a long, a stop above entry would trigger instantly at a loss — it is a direction error, not
      // a preference.
      const ok = intent.side === 'long' ? D(intent.stopLoss).lt(entry) : D(intent.stopLoss).gt(entry);
      add('sl.direction', 'Stop loss is on the correct side of entry', ok ? 'ok' : 'fail', `${intent.stopLoss} vs ${effectivePrice}`);
      if (!ok) block('STOP_LOSS_WRONG_SIDE', 'stop loss is on the wrong side of the entry price');
    }
    if (intent.takeProfit !== undefined) {
      const ok = intent.side === 'long' ? D(intent.takeProfit).gt(entry) : D(intent.takeProfit).lt(entry);
      add('tp.direction', 'Take profit is on the correct side of entry', ok ? 'ok' : 'fail', `${intent.takeProfit} vs ${effectivePrice}`);
      if (!ok) block('TAKE_PROFIT_WRONG_SIDE', 'take profit is on the wrong side of the entry price');
    }
    if (intent.price !== undefined && ctx.referencePrice !== null && !ctx.referenceStale) {
      const dev = D(intent.price).minus(D(ctx.referencePrice)).abs().div(D(ctx.referencePrice)).mul(100);
      const within = dev.lte(ctx.policy.priceDeviationLimitPct);
      add('policy.priceDeviation', 'Limit price near the reference price', within ? 'ok' : 'fail', `${dev.toFixed(2)}% ≤ ${ctx.policy.priceDeviationLimitPct}%`);
      if (!within) block('PRICE_DEVIATION_TOO_LARGE', `limit price deviates ${dev.toFixed(2)}% from the reference price`);
    }
  }

  // ---- balance --------------------------------------------------------------
  if (notional !== null) {
    const required = D(notional).div(lev);
    if (ctx.availableBalance === null) {
      // Unknown balance is NOT treated as sufficient. Assuming funds exist is the failure mode that
      // produces a rejected order at the exchange after the user was told it was fine.
      add('balance.sufficient', 'Sufficient available balance', 'fail', 'no balance snapshot available');
      block('BALANCE_UNKNOWN', 'available balance is unknown; cannot confirm sufficient margin');
    } else {
      const ok = D(ctx.availableBalance).gte(required);
      add('balance.sufficient', 'Sufficient available balance', ok ? 'ok' : 'fail', `${ctx.availableBalance} ≥ ${required.toString()}`);
      if (!ok) block('INSUFFICIENT_BALANCE', `required margin ${required.toString()} exceeds available ${ctx.availableBalance}`);
    }
  }

  // ---- counts ---------------------------------------------------------------
  /*
     ★★ 0(또는 미설정) = 제한 없음. maxLeverage·maxOrderNotional 과 같은 규칙이다.

       비수탁 도구에서 고객의 포지션 수·매매 횟수를 우리가 정할 근거가 없다.
       운영자가 명시적으로 값을 넣을 때만 상한이 걸린다.

     ★★ 여기가 실제로 주문을 **막는** 경로다. 0 을 '제한 없음' 으로 다루지 않으면
       `0 < 0` 이 거짓이 되어 **모든 주문이 차단된다.** 상한을 없애려고 값을 0 으로
       둔 순간 서비스가 멈추는 셈이다 — 그래서 이 분기가 반드시 필요하다.
  */
  const posCap = Number(ctx.policy.maxOpenPositions);
  const posCapped = Number.isFinite(posCap) && posCap > 0;
  const posOk = !posCapped || ctx.openPositions < posCap;
  add('policy.openPositions', 'Open positions within limit', posOk ? 'ok' : 'fail',
    posCapped ? `${ctx.openPositions} < ${posCap}` : 'no operator cap — exchange margin rules apply');
  if (!posOk) block('TOO_MANY_OPEN_POSITIONS', 'open position limit reached');

  const dayCap = Number(ctx.policy.dailyOrderLimit);
  const dayCapped = Number.isFinite(dayCap) && dayCap > 0;
  const dayOk = !dayCapped || ctx.dailyOrderCount < dayCap;
  add('policy.dailyOrders', 'Daily order count within limit', dayOk ? 'ok' : 'fail',
    dayCapped ? `${ctx.dailyOrderCount} < ${dayCap}` : 'no operator cap — the customer sets their own pace');
  if (!dayOk) block('DAILY_ORDER_LIMIT_REACHED', 'daily order limit reached');

  // ---- risk/reward advisory -------------------------------------------------
  if (sym && effectivePrice && intent.stopLoss && intent.takeProfit) {
    const math = computeOrderMath({
      side: intent.side,
      entryPrice: effectivePrice,
      quantity: intent.quantity,
      leverage: lev,
      stopLoss: intent.stopLoss,
      takeProfit: intent.takeProfit,
    });
    // Advisory: a thin risk/reward is a judgement call, not an error, so it is a warning.
    if (math.riskReward !== undefined && D(math.riskReward).lt('1')) {
      warnings.push({ code: 'LOW_RISK_REWARD', message: `risk/reward is ${math.riskReward}` });
    }
    add('rr.computed', 'Risk/reward computed', 'ok', String(math.riskReward ?? '—'));
  }

  if (intent.origin === 'ai_suggestion') {
    // An AI-originated intent is advisory and must be visibly marked as such wherever it surfaces.
    warnings.push({ code: 'AI_ORIGINATED_ADVISORY', message: 'intent originated from an AI suggestion; advisory only' });
  }

  // ---- deployment gates (always blocking here) -----------------------------
  add('gate.liveTrading', 'Live trading enabled', ctx.liveTradingEnabled ? 'ok' : 'fail', `liveTradingEnabled=${ctx.liveTradingEnabled}`);
  if (!ctx.liveTradingEnabled) block('LIVE_TRADING_DISABLED', 'live trading is disabled in this deployment');
  add('gate.killSwitch', 'Kill switch inactive', ctx.killSwitchActive ? 'fail' : 'ok', `killSwitchActive=${ctx.killSwitchActive}`);
  if (ctx.killSwitchActive) block('KILL_SWITCH_ACTIVE', 'emergency kill switch is active');
  /*
     ★★ **상태를 모르면 "통과" 라고 말하지 않는다.**

       위 gate.killSwitch 는 killSwitchActive=false 를 보고 'ok' 를 찍는다. 그런데 그
       false 가 "안 걸렸다" 가 아니라 "못 읽었다" 일 수 있다. 그 경우 'ok' 는 검증되지
       않은 주장이다.

     ★ 이 저장소의 규칙: **측정할 수 없는 안전 검사를 통과로 보고하지 않는다.**
       청산가 위험 검사에서 같은 실수를 이미 고쳤다(-NaN% 를 "안전" 으로 보고했다).

     ★ 별도 게이트로 둔다. gate.killSwitch 를 'fail' 로 바꾸면 "스위치가 걸렸다" 는
       뜻이 되어 또 다른 거짓이 된다. 걸린 것과 모르는 것은 다르다.

     ★ 코드는 KILL_SWITCH_ACTIVE 를 재사용하지 않는다. 운영자가 로그를 볼 때 "스위치가
       걸려서 막혔다" 와 "상태를 못 읽어서 막혔다" 는 대응이 전혀 다르다 — 후자는
       DB 를 봐야 한다.
  */
  add('gate.controlsKnown', 'Kill-switch state readable', ctx.controlsUnknown ? 'fail' : 'ok', `controlsUnknown=${ctx.controlsUnknown}`);
  if (ctx.controlsUnknown) block('CONTROLS_UNKNOWN', 'kill-switch state could not be read — refusing to report this order as allowed');
  // new_positions 킬스위치: 포지션을 새로 열거나 늘리는 주문만 막는다(청산/reduceOnly 는 허용).
  const opensPosition = !(intent.reduceOnly ?? false);
  add('gate.newPositions', 'New positions allowed', ctx.newPositionsHalted && opensPosition ? 'fail' : 'ok', `newPositionsHalted=${ctx.newPositionsHalted ?? false}`);
  if (ctx.newPositionsHalted && opensPosition) block('NEW_POSITIONS_HALTED', 'opening new positions is halted by the operator');

  // `valid` describes the ORDER (would the exchange accept its shape and size). `allowed` additionally
  // requires the deployment gates. Keeping them separate is what lets the UI say "your order is fine but
  // this system will not send it" instead of blaming the user's input.
  /*
     ★ CONTROLS_UNKNOWN 도 배포 게이트다 — **고객 입력 문제가 아니다.**

       이 목록에서 빠지면 `valid: false` 가 되어 화면이 "주문 내용이 잘못됐다" 고
       말한다. 고객은 자기 숫자를 고치려 하는데 고칠 것이 없다. 우리 쪽 상태를
       고객 잘못으로 표시하는 것이 이 목록의 존재 이유다.
  */
  const orderLevelBlocking = blocking.filter((b) => b.code !== 'LIVE_TRADING_DISABLED' && b.code !== 'KILL_SWITCH_ACTIVE' && b.code !== 'NEW_POSITIONS_HALTED' && b.code !== 'CONTROLS_UNKNOWN');
  const valid = orderLevelBlocking.length === 0;

  const feeRate = intent.type === 'market' ? ctx.takerFeeRate : ctx.makerFeeRate;
  const estimatedFees =
    notional === null
      ? null
      : {
          maker: D(notional).mul(D(ctx.makerFeeRate)).toString(),
          taker: D(notional).mul(D(ctx.takerFeeRate)).toString(),
          assumed: (intent.type === 'market' ? 'taker' : 'maker') as 'maker' | 'taker',
          rate: feeRate,
        };

  return {
    valid,
    // Never true in this deployment, but computed rather than hard-coded so the reason list and the
    // verdict cannot disagree.
    allowed: blocking.length === 0,
    executable: false,
    blockingReasons: blocking,
    warnings,
    normalizedOrder: {
      symbol: intent.symbol,
      side: intent.side,
      type: intent.type,
      quantity: intent.quantity,
      price: intent.price ?? null,
      stopPrice: intent.stopPrice ?? null,
      leverage: intent.leverage ?? null,
      marginMode: intent.marginMode ?? null,
      stopLoss: intent.stopLoss ?? null,
      takeProfit: intent.takeProfit ?? null,
      reduceOnly: intent.reduceOnly ?? false,
      notional,
    },
    estimatedFees,
    riskChecks: checks,
  };
}
