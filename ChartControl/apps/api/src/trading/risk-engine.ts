import { evaluateRiskGates, type RiskGate } from '@quantumtrade/domain';
import { evaluateLiveTradingGate, type BitMartMode, type GateResult } from '@quantumtrade/exchange-bitmart';
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
  mode: BitMartMode;
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
  });
  const gates: RiskGate[] = [...base.gates];
  const add = (id: string, label: string, ok: boolean, detail: string) =>
    gates.push({ id, label, status: ok ? 'ok' : 'fail', detail });

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
  add('policy.dailyOrders', 'Daily order count within limit', i.dailyOrderCount < i.policy.dailyOrderLimit, `${i.dailyOrderCount} < ${i.policy.dailyOrderLimit}`);
  add('policy.dailyLoss', 'Daily loss within limit', num(i.dailyLossSoFar) <= num(i.policy.dailyLossLimit), `${i.dailyLossSoFar} ≤ ${i.policy.dailyLossLimit}`);
  add('policy.openPositions', 'Open positions within limit', i.openPositions < i.policy.maxOpenPositions, `${i.openPositions} < ${i.policy.maxOpenPositions}`);
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
