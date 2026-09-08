/**
 * 일일 손실 한도 — **걸지 않는 것이 기본**임을 고정한다 (운영 결정, 2026-09-08).
 *
 * ★★ 왜 걸지 않는가
 *
 *   우리는 분석 소프트웨어를 공급하고, 주문은 고객이 자기 계정·자기 판단으로 낸다.
 *   손실 한도는 고객의 자금 관리 영역이고 강제 종료는 거래소가 청산으로 처리한다.
 *   그리고 우리가 판정하려면 실현손익을 집계해야 하는데, KuCoin 은 **선물만** 그 값을
 *   주고 현물은 경로가 없다. **반쪽 보호를 걸어 두고 "손실 한도 있음" 이라고 말하는
 *   것이 더 나쁘다.**
 *
 * ★ 그래도 값을 넣으면 즉시 켜진다. 그때 fail-open 이 되지 않는지도 함께 고정한다 —
 *   고객이 거래 저널에 아무것도 적지 않으면 저널은 `0` 을 돌려주고, 예전에는 그것을
 *   실측으로 오인해 `0 ≤ 1000` 으로 **통과**시켰다. 한도를 걸어 뒀는데 아무것도 막지
 *   못하는 상태였다.
 */
import { describe, it, expect } from 'vitest';
import { runRiskEngine } from '../trading/risk-engine.js';
import { readFileSync } from 'node:fs';

/** 손실 항목만 보기 위한 최소 입력. 다른 게이트는 통과시킨다. */
const base = {
  mode: 'LIVE_TRADE' as const,
  symbol: {
    id: 'BTCUSDT', tickSize: '0.1', stepSize: '0.001',
    minQty: '0.001', quantityPrecision: 3, pricePrecision: 1,
  },
  price: '90000', quantity: '0.043', leverage: 3, marginMode: 'isolated' as const,
  side: 'long' as const, orderType: 'limit' as const,
  availableBalance: '100000',
  policy: {
    maxLeverage: 20, dailyOrderLimit: 50,
    dailyLossLimit: '', maxOpenPositions: 5, priceDeviationLimitPct: 5,
    /* ★ allowedSymbols 는 policy 안에 있다. 빠뜨리면 심볼 게이트가 던진다. */
    allowedSymbols: ['*'],
  },
  dailyOrderCount: 0,
  dailyLossSoFar: '0',
  dailyLossKnown: false,
  openPositions: 0,
  liveTradingEnabled: true,
  emergencyKillSwitch: false,
  controlsUnknown: false,
  credentialStatus: 'VERIFIED',
  futureTradePermissionVerified: true,
  userStatus: 'active',
  previewExpired: false,
  previewTokenValid: true,
  confirmationTokenValid: true,
  idempotencyKeyValid: true,
  marketDataStatus: 'LIVE',
} as unknown as Parameters<typeof runRiskEngine>[0];

const lossGate = (i: Parameters<typeof runRiskEngine>[0]) =>
  runRiskEngine(i).gates.find((g) => g.id === 'policy.dailyLoss');

describe('일일 손실 한도 — 기본은 걸지 않음', () => {
  it('한도가 없으면 통과하고, 고객이 위험을 진다고 말한다', () => {
    const g = lossGate(base);
    expect(g?.status).toBe('ok');
    expect(g?.detail).toMatch(/no operator cap/i);
  });

  it('한도가 없으면 측정값이 없어도 막지 않는다', () => {
    const g = lossGate({ ...base, dailyLossSoFar: null, dailyLossKnown: false } as never);
    expect(g?.status).toBe('ok');
  });

  it('★ 한도를 켰는데 실측이 없으면 거부한다 (저널의 0 을 실측으로 오인하지 않는다)', () => {
    /*
       고객이 저널에 아무것도 적지 않으면 저널은 0 을 돌려준다. 그것을 통과시키면
       한도가 걸려 있는데 아무것도 막지 못한다.
    */
    const g = lossGate({
      ...base,
      policy: { ...(base as never as { policy: object }).policy, dailyLossLimit: '1000' },
      dailyLossSoFar: '0',
      dailyLossKnown: false,      // 저널만 있는 상태
    } as never);
    expect(g?.status).toBe('fail');
    expect(g?.detail).toMatch(/not measured/i);
  });

  it('한도를 켜고 거래소 실측이 있으면 정상 판정한다', () => {
    const p = { ...(base as never as { policy: object }).policy, dailyLossLimit: '1000' };
    const under = lossGate({ ...base, policy: p, dailyLossSoFar: '999', dailyLossKnown: true } as never);
    const over = lossGate({ ...base, policy: p, dailyLossSoFar: '1001', dailyLossKnown: true } as never);
    expect(under?.status).toBe('ok');
    expect(over?.status).toBe('fail');
  });
});

describe('설정 파일', () => {
  it('render.yaml 에 TRADE_DAILY_LOSS_LIMIT 선언이 없다', () => {
    /*
       ★ 되살아나면 안 된다. 값을 넣으면 즉시 한도가 켜지고, 거래소 실측이 없는
         고객은 주문이 **거부**된다. 켜는 것은 의식적인 결정이어야 한다.
    */
    const yaml = readFileSync(new URL('../../../../render.yaml', import.meta.url), 'utf-8');
    expect(/- key:\s*TRADE_DAILY_LOSS_LIMIT/.test(yaml)).toBe(false);
    /* 왜 없는지는 주석으로 남아 있어야 한다 — 없으면 다음 사람이 실수로 넣는다. */
    expect(yaml).toContain('TRADE_DAILY_LOSS_LIMIT');
  });
});
