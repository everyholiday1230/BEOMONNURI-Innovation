/**
 * 실행 모드 (docs PHASE3-00). READ_ONLY 와 SHADOW 는 거래소로 주문을 보내지 않는다.
 * TRADE 만 실주문이 가능하고, `evaluateLiveTradingGate` 의 **모든** 검사를 통과해야 한다 —
 * 화면 토글로 서버 게이트를 우회할 수 없다.
 *
 * ★★ 이름에서 거래소를 뗐다.
 *
 *   값이 BITMART_LIVE_TRADE 였는데 이것이 통제하는 것은 **지금 붙어 있는 거래소**
 *   (KuCoin)의 실주문이다. 거래소를 더 붙이면(BitGet 등) 어느 값이 어느 거래소를
 *   켜는지 알 수 없게 된다.
 *
 * ★ 옛 값은 지우지 않고 **읽을 때 변환**한다(normalizeExecutionMode). 프로덕션 env 가
 *   LIVE_EXECUTION_MODE=BITMART_LIVE_TRADE 로 설정돼 있으므로, 옛 값을 거부하면
 *   배포하는 순간 모드가 READ_ONLY 로 떨어져 **거래가 멈춘다.**
 */
export const EXECUTION_MODES = ['LIVE_READ_ONLY', 'LIVE_SHADOW', 'LIVE_TRADE'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/** 옛 이름 → 새 이름. env 나 저장된 값이 옛 이름일 때만 쓴다. */
const LEGACY_MODE_ALIASES: Record<string, ExecutionMode> = {
  BITMART_LIVE_READ_ONLY: 'LIVE_READ_ONLY',
  BITMART_LIVE_SHADOW: 'LIVE_SHADOW',
  BITMART_LIVE_TRADE: 'LIVE_TRADE',
};

/**
 * 문자열을 실행 모드로 바꾼다. 새 이름과 옛 이름을 모두 받는다.
 *
 * ★★ 알 수 없는 값은 **가장 안전한 모드**(LIVE_READ_ONLY)로 떨어진다. 오타 하나가
 *   실주문을 켜는 일이 없어야 한다 — 반대 방향의 실패는 주문이 안 나가는 것뿐이다.
 */
export function normalizeExecutionMode(raw: string | undefined | null): ExecutionMode {
  const v = String(raw ?? '').trim().toUpperCase();
  if ((EXECUTION_MODES as readonly string[]).includes(v)) return v as ExecutionMode;
  return LEGACY_MODE_ALIASES[v] ?? 'LIVE_READ_ONLY';
}

/** 옛 이름이 쓰였는지. 부팅 로그에서 정리 대상을 알리는 데 쓴다. */
export function isLegacyModeName(raw: string | undefined | null): boolean {
  const v = String(raw ?? '').trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(LEGACY_MODE_ALIASES, v);
}

export interface LiveTradingGateInput {
  mode: ExecutionMode;
  liveTradingEnabled: boolean; // LIVE_TRADING_ENABLED
  emergencyKillSwitch: boolean; // EMERGENCY_KILL_SWITCH (true = blocked)
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
  if (i.mode !== 'LIVE_TRADE') reasons.push(`mode ${i.mode} does not permit live orders`);
  if (!i.liveTradingEnabled) reasons.push('LIVE_TRADING_ENABLED is false');
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
export function isOrderMutationAllowed(mode: ExecutionMode): boolean {
  return mode === 'LIVE_TRADE'; // SHADOW builds but never transmits; READ_ONLY blocks
}
