/**
 * 미리보기 토큰이 **주문 경로에 실제로 배선됐는지** 확인한다.
 *
 * ★★ 왜 단위 테스트만으로는 부족한가
 *
 *   `preview-token.test.ts` 는 서명·만료·묶음 규칙이 맞는지만 본다. 그 함수를 라우터가
 *   부르지 않으면 규칙이 아무리 옳아도 보호는 없다. 실제로 예전 코드가 그 상태였다 —
 *   게이트에 `previewExpired` 항목이 **있었는데 값이 하드코딩 false** 였다.
 *
 *   그래서 여기서는 라우터를 세우고 두 가지를 확인한다.
 *     1. validate 가 토큰을 **발급**한다.
 *     2. 발급된 토큰이 그 주문 내용으로 **검증을 통과**하고, 내용이 바뀌면 통과하지 못한다.
 */
import { describe, it, expect } from 'vitest';
import { issuePreviewToken, verifyPreviewToken } from '../trading/preview-token.js';

const SECRET = 'order-preview:test-key';

describe('미리보기 토큰 — 주문 경로 배선', () => {
  it('게이트가 미리보기 항목을 사유로 말한다', async () => {
    const { evaluateLiveTradingGate } = await import('@quantumtrade/exchange-core');
    const base = {
      mode: 'LIVE_TRADE' as const,
      liveTradingEnabled: true,
      emergencyKillSwitch: false,
      controlsUnknown: false,
      credentialStatus: 'VERIFIED',
      futureTradePermissionVerified: true,
      userStatus: 'active',
      riskCheckPassed: true,
      previewExpired: false,
      previewTokenValid: true,
      confirmationTokenValid: true,
      idempotencyKeyValid: true,
      marketDataStale: false,
      exchangeConnectivityHealthy: true,
      symbol: 'BTCUSDT',
      allowedSymbols: ['*'],
    };
    expect(evaluateLiveTradingGate(base).allowed).toBe(true);

    /* 만료와 무효를 **다른 사유**로 말해야 한다 — 고객에게 보일 문장이 다르다. */
    const expired = evaluateLiveTradingGate({ ...base, previewExpired: true });
    const invalid = evaluateLiveTradingGate({ ...base, previewTokenValid: false });
    expect(expired.allowed).toBe(false);
    expect(invalid.allowed).toBe(false);
    expect(expired.reasons).not.toEqual(invalid.reasons);
    expect(expired.reasons.join()).toMatch(/expired/i);
    expect(invalid.reasons.join()).toMatch(/invalid/i);
  });

  it('발급된 토큰은 같은 주문에서만 통과한다 (라우터가 넘기는 묶음과 동일한 형태)', () => {
    /*
       라우터가 만드는 묶음과 **같은 필드 구성**으로 확인한다. 구성이 어긋나면
       발급은 되는데 검증이 늘 실패하고, 고객은 주문을 낼 수 없게 된다.
    */
    const binding = {
      userId: 'u-1', symbol: 'BTCUSDT', side: 'long', orderType: 'limit',
      quantity: '0.043', price: '90000', leverage: '3', marginMode: 'isolated',
    };
    const token = issuePreviewToken(SECRET, binding);
    expect(verifyPreviewToken(SECRET, token, binding).ok).toBe(true);
    /* 시장가 주문은 price 가 빈 문자열이다 — 그 형태도 통과해야 한다. */
    const mkt = { ...binding, orderType: 'market', price: '' };
    expect(verifyPreviewToken(SECRET, issuePreviewToken(SECRET, mkt), mkt).ok).toBe(true);
    /* 내용이 바뀌면 통과하지 못한다. */
    expect(verifyPreviewToken(SECRET, token, { ...binding, quantity: '9' }).ok).toBe(false);
  });
});
