/**
 * BitMart live trading modes (docs PHASE3-00). READ_ONLY and SHADOW never send orders to BitMart.
 * TRADE is the ONLY mode that can place real orders and is gated by ALL of the checks in
 * `evaluateLiveTradingGate` — a UI toggle can never bypass the server gate.
 */
export const BITMART_MODES = ['BITMART_LIVE_READ_ONLY', 'BITMART_LIVE_SHADOW', 'BITMART_LIVE_TRADE'] as const;
export type BitMartMode = (typeof BITMART_MODES)[number];

export interface LiveTradingGateInput {
  mode: BitMartMode;
  liveTradingEnabled: boolean; // BITMART_LIVE_TRADING_ENABLED
  emergencyKillSwitch: boolean; // BITMART_EMERGENCY_KILL_SWITCH (true = blocked)
  credentialStatus: string; // must be 'VERIFIED'
  futureTradePermissionVerified: boolean;
  userStatus: string; // must be 'active'
  riskCheckPassed: boolean;
  previewExpired: boolean;
  confirmationTokenValid: boolean;
  idempotencyKeyValid: boolean;
  marketDataStale: boolean;
  exchangeConnectivityHealthy: boolean;
  symbol: string;
  allowedSymbols: string[];
}

export interface GateResult {
  allowed: boolean;
  reasons: string[];
}

/** Returns allowed=true ONLY when EVERY protection passes. Default config → always false. */
export function evaluateLiveTradingGate(i: LiveTradingGateInput): GateResult {
  const reasons: string[] = [];
  if (i.mode !== 'BITMART_LIVE_TRADE') reasons.push(`mode ${i.mode} does not permit live orders`);
  if (!i.liveTradingEnabled) reasons.push('BITMART_LIVE_TRADING_ENABLED is false');
  if (i.emergencyKillSwitch) reasons.push('emergency kill switch active');
  if (i.credentialStatus !== 'VERIFIED') reasons.push('credential not VERIFIED');
  if (!i.futureTradePermissionVerified) reasons.push('Future-Trade permission not verified');
  if (i.userStatus !== 'active') reasons.push('user not active');
  if (!i.riskCheckPassed) reasons.push('server risk check did not pass');
  if (i.previewExpired) reasons.push('order preview expired');
  if (!i.confirmationTokenValid) reasons.push('final confirmation token invalid');
  if (!i.idempotencyKeyValid) reasons.push('idempotency key invalid');
  if (i.marketDataStale) reasons.push('market data is stale');
  if (!i.exchangeConnectivityHealthy) reasons.push('exchange connectivity unhealthy');
  /*
     심볼 화이트리스트. `'*'` 가 들어 있으면 제한을 두지 않는다.

     ★ 상장 종목이 664개인데 화이트리스트를 손으로 관리하면, 새 종목은 주문
       확인창을 통과한 뒤 전송 단계에서 거부된다 — 사용자에게는 이유 없는 실패다.
       제한을 열 때는 레버리지·금액·일일 한도가 유일한 방어선이 된다.
  */
  if (!i.allowedSymbols.includes('*') && !i.allowedSymbols.includes(i.symbol)) {
    reasons.push(`symbol ${i.symbol} not allowed`);
  }
  return { allowed: reasons.length === 0, reasons };
}

/** READ_ONLY forbids any order mutation. */
export function isOrderMutationAllowed(mode: BitMartMode): boolean {
  return mode === 'BITMART_LIVE_TRADE'; // SHADOW builds but never transmits; READ_ONLY blocks
}
