import { evaluateRiskGates, type RiskGate } from '@quantumtrade/domain';
import { evaluateLiveTradingGate, type ExecutionMode, type GateResult } from '@quantumtrade/exchange-bitmart';
import type { SymbolInfo } from '@quantumtrade/schemas';

/**
 * Server-side Risk Engine (docs PHASE3-04). Re-validates ALL client checks on the server and adds
 * live-trading policy limits + the live-trading gate. NEVER trusts client-only validation.
 */
export interface TradingPolicy {
  allowedSymbols: string[];
  maxOrderNotional: string;
  maxLeverage: number;
  maxOpenPositions: number;
  dailyOrderLimit: number;
  dailyLossLimit: string;
  priceDeviationLimitPct: number; // e.g. 5 = 5%
}

export interface RiskEngineInput {
  /*
     심볼 카탈로그가 적재됐는가.

     ★ 넘기지 않으면(undefined) 예전과 같은 문구가 나온다 — 호출자를 강제로
       고치게 만들지 않되, 넘긴 곳은 고객에게 정확히 말할 수 있다.
  */
  catalogueLoaded?: boolean;
  mode: ExecutionMode;
  symbol: SymbolInfo | undefined;
  side: 'long' | 'short';
  orderType: 'market' | 'limit';
  price?: string;
  quantity: string;
  leverage: number;
  stopLoss?: string;
  takeProfit?: string;
  riskReward?: string;
  maxEstLoss?: string;
  positionValue?: string;
  /*
     주문에 쓸 수 있는 견적통화 잔고. **null = 측정 불가**(0 과 다르다).

     ★★ 이 값이 없어서 고객이 거래소까지 갔다 와서 실패를 알았다. 실서비스 기록:
       09-01 14:54 현물 XRPUSDT 매수가 'Balance insufficient!' 로 거부됐다.
       우리는 잔고를 조회할 수 있었는데 주문 전에 보지 않았다.
  */
  availableQuote?: string | null;
  /** 현물인가. 필요 금액 계산이 다르다(현물은 전액, 선물은 증거금). */
  isSpot?: boolean;
  /** 수수료율(테이커). 필요 금액에 더한다 — 딱 맞는 잔고로는 주문이 안 나간다. */
  takerFeeRate?: string;
  marketDataStatus: string;
  referencePrice?: string; // current mark/last for deviation check
  policy: TradingPolicy;
  // live-gate context
  liveTradingEnabled: boolean;
  emergencyKillSwitch: boolean;
  credentialStatus: string;
  futureTradePermissionVerified: boolean;
  userStatus: string;
  previewExpired: boolean;
  confirmationTokenValid: boolean;
  idempotencyKeyValid: boolean;
  exchangeConnectivityHealthy: boolean;
  dailyOrderCount: number;
  dailyLossSoFar: string;
  /*
     ★★ dailyLossSoFar 가 **실제로 측정된 값인지** 여부.

       이 값은 현재 '0' 으로 고정돼 있다(측정 경로가 아직 없다). 그 상태에서
       운영자가 일일 손실 한도를 설정하면 `0 <= 한도` 가 언제나 참이므로 게이트가
       영원히 통과한다 — 한도를 걸었다고 믿는데 실제로는 아무 것도 막지 않는다.
       그 착각이 이 게이트의 가장 큰 위험이라, 측정 여부를 명시적으로 받는다.
  */
  dailyLossKnown?: boolean;
  openPositions: number;
}

export interface RiskEngineResult {
  pass: boolean;
  gates: RiskGate[];
  liveGate: GateResult;
  failCount: number;
  reasons: string[];
}

const num = (s?: string) => (s === undefined ? NaN : Number(s));

export function runRiskEngine(i: RiskEngineInput): RiskEngineResult {
  // 1) base gates (Phase 1, Decimal-safe) — symbol metadata/precision/direction/RR/freshness.
  const base = evaluateRiskGates({
    symbol: i.symbol,
    side: i.side,
    orderType: i.orderType,
    price: i.price,
    quantity: i.quantity,
    leverage: i.leverage,
    stopLoss: i.stopLoss,
    takeProfit: i.takeProfit,
    riskReward: i.riskReward,
    maxEstLoss: i.maxEstLoss,
    marketDataStatus: i.marketDataStatus,
    // ★ 규격이 없을 때 "우리 문제" 와 "심볼 문제" 를 구분하게 넘긴다.
    catalogueLoaded: i.catalogueLoaded,
  });
  const gates: RiskGate[] = [...base.gates];
  const add = (id: string, label: string, ok: boolean, detail: string) =>
    gates.push({ id, label, status: ok ? 'ok' : 'fail', detail });
  /*
     ★ 기존 add 는 boolean 이라 ok/fail 뿐이다. 잔고 게이트는 **모른다(warn)** 가
       필요하다 — 모르는 것을 ok 나 fail 로 적으면 둘 다 거짓말이 된다.
  */
  const add2 = (id: string, label: string, status: RiskGate['status'], detail: string) =>
    gates.push({ id, label, status, detail });

  // 2) live policy limits.
  const symbolAllowed =
    i.policy.allowedSymbols.includes('*') || i.policy.allowedSymbols.includes(i.symbol?.id ?? '');
  add('policy.symbol', 'Symbol allowed by policy', symbolAllowed, `allowed: ${i.policy.allowedSymbols.join(',')}`);
  /*
     레버리지 상한 — **거래소가 정한 값**을 기준으로 삼는다.

     ★★ 전에는 우리 정책값(기본 20×)만 봤다. 그런데 거래소는 종목마다 상한이
       다르다(BTC 125× · 알트는 20~50×). 우리 값이 더 낮으면, 거래소에서 허용하는
       주문이 우리 쪽에서 거부된다 — 사용자는 이유를 알 수 없다. 반대로 우리 값이
       더 높으면 거래소가 거부하므로 어차피 나가지 않는다.

     ★ 그래서 심볼 메타데이터의 maxLeverage(거래소가 준 값)를 기준으로 하고,
       운영자가 TRADE_MAX_LEVERAGE 를 **명시**했을 때만 그것을 추가 상한으로 겹친다.
       기본값(0)은 "거래소를 따른다" 는 뜻이다.
  */
  const exchangeLev = Number(i.symbol?.maxLeverage);
  const operatorLev = Number(i.policy.maxLeverage);
  const caps = [
    Number.isFinite(exchangeLev) && exchangeLev > 0 ? exchangeLev : null,
    Number.isFinite(operatorLev) && operatorLev > 0 ? operatorLev : null,
  ].filter((n): n is number => n !== null);
  const levCap = caps.length > 0 ? Math.min(...caps) : null;
  const levSource = levCap === null
    ? 'no cap known'
    : (levCap === exchangeLev ? `exchange max ${exchangeLev}x` : `operator cap ${operatorLev}x`);
  add('policy.leverage', 'Leverage within limit', levCap === null || i.leverage <= levCap, `${i.leverage}x ≤ ${levCap ?? '?'}x (${levSource})`);
  const notional = num(i.positionValue);
  /*
     주문 금액 상한.

     ★ 거래소도 위험 한도(risk limit) 로 금액을 제한하고, 초과하면 거래소가 거부한다.
       우리 값은 **운영자가 명시했을 때만** 겹치는 추가 상한이다. 빈 값·0 이면 검사하지
       않는다 — 우리가 모르는 기준으로 거래소가 허용하는 주문을 막지 않는다.
  */
  const notionalCap = num(i.policy.maxOrderNotional);
  const notionalCapped = Number.isFinite(notionalCap) && notionalCap > 0;
  add(
    'policy.notional',
    'Order notional within cap',
    !notionalCapped || !Number.isFinite(notional) || notional <= notionalCap,
    notionalCapped ? `${i.positionValue ?? '?'} ≤ ${i.policy.maxOrderNotional}` : 'no operator cap — exchange risk limit applies',
  );
  /*
     ★★ 잔고로 이 주문을 낼 수 있는가.

       이 게이트가 없어서 고객이 **거래소까지 갔다 와서** 실패를 알았다. 실서비스
       기록: 09-01 14:54 현물 XRPUSDT 매수 → 거래소가 'Balance insufficient!'.
       우리는 잔고를 조회할 수 있었는데 보지 않았고, 고객이 받은 문구는 거래소
       원문이라 **얼마가 부족한지도 알 수 없었다.**

     ★★ 측정 불가(null)를 거부로 다루지 않는다. 조회가 잠깐 실패했을 때 잔고가
       충분한 고객의 주문을 우리가 막으면, 거래소가 막는 것보다 나쁘다 — 고객은
       돈이 있는데 쓸 수 없다. 그래서 'warn' 으로 사실만 밝히고 통과시킨다.
       거래소가 최종 판단자이므로 우리가 모를 때는 거래소에 맡긴다.

     ★ 필요 금액은 현물과 선물이 다르다.
         현물 매수: 명목 전액이 필요하다(레버리지가 없다).
         선물: 명목 / 레버리지 = 개시증거금.
       둘 다 수수료를 더한다 — 딱 맞는 잔고로는 주문이 나가지 않는다.
  */
  {
    const avail = i.availableQuote === null || i.availableQuote === undefined ? null : num(i.availableQuote);
    const lev = i.isSpot ? 1 : (Number.isFinite(i.leverage) && i.leverage > 0 ? i.leverage : 1);
    const feeRate = num(i.takerFeeRate);
    const margin = Number.isFinite(notional) ? notional / lev : NaN;
    const fee = Number.isFinite(notional) && Number.isFinite(feeRate) ? notional * feeRate : 0;
    const need = Number.isFinite(margin) ? margin + fee : NaN;
    const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(4).replace(/\.?0+$/, '') : '?');

    if (avail === null) {
      /*
         ★ "모른다" 를 그대로 말한다. 'ok' 로 적으면 검사한 것처럼 보이고,
           'fail' 로 적으면 우리가 고객 돈을 막는다.
      */
      add2('funds.available', 'Balance covers this order', 'warn',
        i.availableQuote === undefined
          ? 'balance not checked on this deployment — the exchange will decide'
          : 'could not read your balance — the exchange will decide');
    } else if (!Number.isFinite(need)) {
      add2('funds.available', 'Balance covers this order', 'warn', `balance ${fmt(avail)} — order size unknown, cannot compare`);
    } else if (avail >= need) {
      add2('funds.available', 'Balance covers this order', 'ok',
        `need ${fmt(need)} (${i.isSpot ? 'full amount' : `margin at ${lev}x`}${fee > 0 ? ' + fee' : ''}) ≤ have ${fmt(avail)}`);
    } else {
      /*
         ★★ 부족한 **금액**을 말한다. "잔고 부족" 만으로는 고객이 얼마를 넣어야
           하는지 모른다 — 거래소 원문이 정확히 그래서 쓸모없었다.
      */
      add2('funds.available', 'Balance covers this order', 'fail',
        `need ${fmt(need)} (${i.isSpot ? 'full amount' : `margin at ${lev}x`}${fee > 0 ? ' + fee' : ''}) but have ${fmt(avail)} — short by ${fmt(need - avail)}`);
    }
  }
  /*
     ★★ 일일 주문 수 · 일일 손실 · 동시 포지션 수: 기본은 **제한 없음** 이다.

       이건 비수탁 도구다. 고객의 거래소 계정, 고객의 돈, 고객의 위험이다. 포지션을
       몇 개 열지, 하루에 몇 번 매매할지, 얼마까지 잃을지를 우리가 정할 근거가 없다.
       레버리지·주문금액 상한을 이미 '거래소를 따른다' 로 둔 것과 같은 이유다.

     ★ 게다가 이 세 게이트는 막지도 못하면서 막는 척했다. dailyLossSoFar 는 '0' 으로
       고정돼 있어 언제나 통과했고, openPositions 는 조회 실패를 0 으로 취급해
       무제한 통과했다. 그런 상태의 상한은 안전장치가 아니라 착각을 만드는 표시다.

     ★★ 0(또는 빈 값)이면 검사하지 않고, 이유를 그대로 밝힌다. 운영자가 값을 넣으면
       그때만 적용된다. 다만 값을 넣더라도 위 두 입력이 실제 값이 되기 전까지는
       일일 손실 게이트를 신뢰할 수 없다 — 그래서 unknownInputs 로 함께 보고한다.
  */
  const orderCap = Number(i.policy.dailyOrderLimit);
  const orderCapped = Number.isFinite(orderCap) && orderCap > 0;
  add(
    'policy.dailyOrders', 'Daily order count within limit',
    !orderCapped || i.dailyOrderCount < orderCap,
    orderCapped ? `${i.dailyOrderCount} < ${orderCap}` : 'no operator cap — the customer sets their own pace',
  );

  const lossCap = num(i.policy.dailyLossLimit);
  const lossCapped = Number.isFinite(lossCap) && lossCap > 0;
  const lossKnown = i.dailyLossKnown === true;
  if (!lossCapped) {
    add('policy.dailyLoss', 'Daily loss within limit', true,
      'no operator cap — the customer bears their own risk');
  } else if (!lossKnown) {
    /*
       ★★ 한도는 설정됐는데 오늘 손실을 측정할 수 없다 → **통과시키지 않는다.**

         한도를 건 운영자의 의도는 "이만큼 잃으면 멈춰라" 다. 측정값이 없다고
         조용히 통과시키면 그 의도가 무력화되고, 화면에는 'ok' 로 찍혀 보호받는
         것처럼 보인다. 막는 쪽이 시끄럽지만 정직하다 — 한도를 지우면 즉시 풀린다.
    */
    add('policy.dailyLoss', 'Daily loss within limit', false,
      `cap ${i.policy.dailyLossLimit} is set but today's realised loss is not measured — refusing rather than reporting a cap that cannot fire`);
  } else {
    add('policy.dailyLoss', 'Daily loss within limit',
      num(i.dailyLossSoFar) <= lossCap,
      `${i.dailyLossSoFar} ≤ ${i.policy.dailyLossLimit}`);
  }

  const posCap = Number(i.policy.maxOpenPositions);
  const posCapped = Number.isFinite(posCap) && posCap > 0;
  add(
    'policy.openPositions', 'Open positions within limit',
    !posCapped || i.openPositions < posCap,
    posCapped ? `${i.openPositions} < ${posCap}` : 'no operator cap — exchange margin rules apply',
  );
  if (i.price && i.referencePrice) {
    const dev = Math.abs((num(i.price) - num(i.referencePrice)) / num(i.referencePrice)) * 100;
    add('policy.priceDeviation', 'Price deviation within limit', dev <= i.policy.priceDeviationLimitPct, `${dev.toFixed(2)}% ≤ ${i.policy.priceDeviationLimitPct}%`);
  }

  const failCount = gates.filter((g) => g.status === 'fail').length;

  // 3) live-trading gate (only decisive for TRADE mode; informational otherwise).
  const liveGate = evaluateLiveTradingGate({
    mode: i.mode,
    liveTradingEnabled: i.liveTradingEnabled,
    emergencyKillSwitch: i.emergencyKillSwitch,
    credentialStatus: i.credentialStatus,
    futureTradePermissionVerified: i.futureTradePermissionVerified,
    userStatus: i.userStatus,
    riskCheckPassed: failCount === 0,
    previewExpired: i.previewExpired,
    confirmationTokenValid: i.confirmationTokenValid,
    idempotencyKeyValid: i.idempotencyKeyValid,
    marketDataStale: i.marketDataStatus !== 'LIVE',
    exchangeConnectivityHealthy: i.exchangeConnectivityHealthy,
    symbol: i.symbol?.id ?? '',
    allowedSymbols: i.policy.allowedSymbols,
  });

  const reasons = gates.filter((g) => g.status === 'fail').map((g) => `${g.id}: ${g.detail}`);
  return { pass: failCount === 0, gates, liveGate, failCount, reasons };
}
