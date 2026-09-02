import { describe, it, expect } from 'vitest';
import {
  EXECUTION_MODES,
  normalizeExecutionMode,
  isLegacyModeName,
  isOrderMutationAllowed,
  evaluateLiveTradingGate,
  type ExecutionMode,
} from '../modes';

/*
   ============================================================
   MODE-NEUTRAL — 실행 모드 값에서 거래소 이름을 뗀 뒤의 안전성.

   ★★ 왜 이 검사가 필요한가

     프로덕션 env 는 LIVE_EXECUTION_MODE=BITMART_LIVE_TRADE 다. 새 이름만 받도록
     바꾸면 옛 값이 "알 수 없는 값" 이 되어 기본 LIVE_READ_ONLY 로 떨어지고,
     **배포하는 순간 모든 실주문이 멈춘다.** 이름 정리가 서비스 중단이 되는 셈이다.

     반대 방향의 실패도 막아야 한다: 오타나 빈 값이 실주문 모드로 해석되면
     의도하지 않은 주문이 나간다. 그래서 모르는 값은 가장 안전한 모드로 간다.
   ============================================================ */

describe('MODE-NEUTRAL 실행 모드 값', () => {
  it('[1] 값에 거래소 이름이 없다', () => {
    for (const m of EXECUTION_MODES) expect(m).not.toMatch(/BITMART|KUCOIN|BITGET/i);
  });

  it('[2] ★★ 옛 값(BITMART_LIVE_TRADE)이 실주문 모드로 해석된다 — 아니면 배포가 거래를 멈춘다', () => {
    expect(normalizeExecutionMode('BITMART_LIVE_TRADE')).toBe('LIVE_TRADE');
  });

  it('[3] 옛 값 나머지도 대응된다', () => {
    expect(normalizeExecutionMode('BITMART_LIVE_READ_ONLY')).toBe('LIVE_READ_ONLY');
    expect(normalizeExecutionMode('BITMART_LIVE_SHADOW')).toBe('LIVE_SHADOW');
  });

  it('[4] 새 값은 그대로 통과한다', () => {
    for (const m of EXECUTION_MODES) expect(normalizeExecutionMode(m)).toBe(m);
  });

  it('[5] 대소문자·공백을 흡수한다', () => {
    expect(normalizeExecutionMode('  live_trade  ')).toBe('LIVE_TRADE');
    expect(normalizeExecutionMode('bitmart_live_trade')).toBe('LIVE_TRADE');
  });

  it('[6] ★★ 모르는 값·빈 값은 가장 안전한 모드로 떨어진다 — 오타가 실주문을 켜면 안 된다', () => {
    for (const bad of ['', '   ', undefined, null, 'LIVE_TRADEE', 'TRADE', 'KUCOIN_LIVE_TRADE', 'true']) {
      expect(normalizeExecutionMode(bad as string)).toBe('LIVE_READ_ONLY');
    }
  });

  it('[7] 옛 이름 사용 여부를 알려준다 (부팅 경고용)', () => {
    expect(isLegacyModeName('BITMART_LIVE_TRADE')).toBe(true);
    expect(isLegacyModeName('LIVE_TRADE')).toBe(false);
    expect(isLegacyModeName(undefined)).toBe(false);
  });

  it('[8] 주문 변경은 LIVE_TRADE 에서만 허용된다', () => {
    expect(isOrderMutationAllowed('LIVE_TRADE')).toBe(true);
    expect(isOrderMutationAllowed('LIVE_SHADOW')).toBe(false);
    expect(isOrderMutationAllowed('LIVE_READ_ONLY')).toBe(false);
  });

  /*
     ★ 게이트가 새 값으로도 동일하게 판정하는지 확인한다. 값 이름만 바꾸는 변경이
       게이트 로직을 건드리지 않았음을 고정한다.
  */
  const passing = (mode: ExecutionMode) => ({
    mode,
    liveTradingEnabled: true,
    emergencyKillSwitch: false,
    credentialStatus: 'VERIFIED',
    futureTradePermissionVerified: true,
    userStatus: 'active',
    riskCheckPassed: true,
    previewExpired: false,
    confirmationTokenValid: true,
    idempotencyKeyValid: true,
    marketDataStale: false,
    exchangeConnectivityHealthy: true,
    symbol: 'BTCUSDT',
    allowedSymbols: ['*'],
  });

  it('[9] 모든 보호를 통과한 LIVE_TRADE 만 실주문이 허용된다', () => {
    expect(evaluateLiveTradingGate(passing('LIVE_TRADE')).allowed).toBe(true);
    expect(evaluateLiveTradingGate(passing('LIVE_SHADOW')).allowed).toBe(false);
    expect(evaluateLiveTradingGate(passing('LIVE_READ_ONLY')).allowed).toBe(false);
  });

  it('[10] 거부 사유에도 거래소 이름이 남지 않는다', () => {
    const r = evaluateLiveTradingGate({ ...passing('LIVE_TRADE'), liveTradingEnabled: false });
    expect(r.allowed).toBe(false);
    expect(r.reasons.join(' ')).toContain('LIVE_TRADING_ENABLED');
    expect(r.reasons.join(' ')).not.toMatch(/BITMART/i);
  });
});
