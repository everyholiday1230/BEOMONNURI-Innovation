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
  add('policy.symbol', 'Symbol allowed by policy', i.policy.allowedSymbols.includes(i.symbol?.id ?? ''), `allowed: ${i.policy.allowedSymbols.join(',')}`);
  add('policy.leverage', 'Leverage within policy', i.leverage <= i.policy.maxLeverage, `${i.leverage}x ≤ ${i.policy.maxLeverage}x`);
  const notional = num(i.positionValue);
  add('policy.notional', 'Order notional within cap', !Number.isFinite(notional) || notional <= num(i.policy.maxOrderNotional), `${i.positionValue ?? '?'} ≤ ${i.policy.maxOrderNotional}`);
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
