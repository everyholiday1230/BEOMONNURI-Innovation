import { describe, it, expect } from 'vitest';
import { validateOrderIntent } from '../portfolio/order-validation';
import type { SymbolInfo } from '@quantumtrade/schemas';

/*
   POLICY-UNLIMITED — 동시 포지션 수 · 일일 주문 수 상한의 기본은 "제한 없음" 이다.

   ★★ 왜 이 검사가 필요한가

     이건 비수탁 도구다. 고객의 거래소 계정, 고객의 돈, 고객의 위험이다. 포지션을
     몇 개 열지, 하루에 몇 번 매매할지를 우리가 정할 근거가 없다. 레버리지·주문금액
     상한을 이미 "거래소를 따른다" 로 둔 것과 같은 이유로 이 둘도 기본 무제한이다.

   ★★ 그리고 이 파일의 검사는 **서비스 정지를 막는 안전장치**다.

     비교식이 `openPositions < maxOpenPositions` 였다. 상한을 없애려고 값을 0 으로
     두면 `0 < 0` 이 거짓이 되어 **모든 주문이 차단된다.** 즉 "제한을 푼다" 는 설정이
     "전면 중단" 으로 뒤바뀐다. 아래 [1][2] 가 그 회귀를 잡는다.
*/

const SYM: SymbolInfo = {
  id: 'BTCUSDT', base: 'BTC', quote: 'USDT', contractType: 'perpetual',
  pricePrecision: 1, quantityPrecision: 3, tickSize: '0.1', stepSize: '0.001',
  minQty: '0.001', maxLeverage: 125,
};

/** 상한 세 개만 바꿔가며 검사한다. 그 밖의 게이트는 통과하도록 맞춘 문맥. */
function ctxWith(policyOverride: Record<string, unknown>, counts: { openPositions: number; dailyOrderCount: number }) {
  return {
    symbolInfo: SYM,
    policy: {
      allowedSymbols: ['*'], maxOrderNotional: '', maxLeverage: 0,
      maxOpenPositions: 0, dailyOrderLimit: 0, dailyLossLimit: '',
      priceDeviationLimitPct: 5,
      ...policyOverride,
    },
    referencePrice: '68000', referenceStale: false,
    minNotional: '1', takerFeeRate: '0.0006', makerFeeRate: '0.0002',
    liveTradingEnabled: false, killSwitchActive: false,
    tradingMode: 'MOCK', availableBalance: '1000000',
    ...counts,
  } as unknown as Parameters<typeof validateOrderIntent>[1];
}

const INTENT = {
  symbol: 'BTCUSDT', side: 'long', orderType: 'limit',
  price: '68000', quantity: '0.01', leverage: 5,
} as unknown as Parameters<typeof validateOrderIntent>[0];

const gate = (r: ReturnType<typeof validateOrderIntent>, id: string) =>
  r.riskChecks.find((g) => g.id === id);
const blockedFor = (r: ReturnType<typeof validateOrderIntent>, code: string) =>
  r.blockingReasons.some((b) => b.code === code);

describe('POLICY-UNLIMITED 상한 0 은 제한 없음이다 (전면 차단이 아니다)', () => {
  it('[1] ★★ 포지션 상한 0 이면 이미 포지션이 많아도 막지 않는다', () => {
    const r = validateOrderIntent(INTENT, ctxWith({}, { openPositions: 99, dailyOrderCount: 0 }));
    expect(gate(r, 'policy.openPositions')!.status).toBe('ok');
    expect(blockedFor(r, 'TOO_MANY_OPEN_POSITIONS')).toBe(false);
  });

  it('[2] ★★ 일일 주문 상한 0 이면 주문 수가 많아도 막지 않는다', () => {
    const r = validateOrderIntent(INTENT, ctxWith({}, { openPositions: 0, dailyOrderCount: 5000 }));
    expect(gate(r, 'policy.dailyOrders')!.status).toBe('ok');
    expect(blockedFor(r, 'DAILY_ORDER_LIMIT_REACHED')).toBe(false);
  });

  it('[3] 상한을 켜지 않았다는 사실을 이유에 밝힌다 — 통과 이유를 숨기지 않는다', () => {
    const r = validateOrderIntent(INTENT, ctxWith({}, { openPositions: 3, dailyOrderCount: 3 }));
    expect(gate(r, 'policy.openPositions')!.detail).toContain('no operator cap');
    expect(gate(r, 'policy.dailyOrders')!.detail).toContain('no operator cap');
  });

  it('[4] 운영자가 값을 넣으면 그때는 실제로 막는다', () => {
    const r = validateOrderIntent(
      INTENT,
      ctxWith({ maxOpenPositions: 5, dailyOrderLimit: 50 }, { openPositions: 5, dailyOrderCount: 0 }),
    );
    expect(gate(r, 'policy.openPositions')!.status).toBe('fail');
    expect(blockedFor(r, 'TOO_MANY_OPEN_POSITIONS')).toBe(true);
  });

  it('[5] 운영자가 넣은 일일 주문 상한도 실제로 막는다', () => {
    const r = validateOrderIntent(
      INTENT,
      ctxWith({ maxOpenPositions: 5, dailyOrderLimit: 50 }, { openPositions: 0, dailyOrderCount: 50 }),
    );
    expect(gate(r, 'policy.dailyOrders')!.status).toBe('fail');
    expect(blockedFor(r, 'DAILY_ORDER_LIMIT_REACHED')).toBe(true);
  });

  it('[6] 상한 안쪽이면 통과한다', () => {
    const r = validateOrderIntent(
      INTENT,
      ctxWith({ maxOpenPositions: 5, dailyOrderLimit: 50 }, { openPositions: 2, dailyOrderCount: 10 }),
    );
    expect(gate(r, 'policy.openPositions')!.status).toBe('ok');
    expect(gate(r, 'policy.dailyOrders')!.status).toBe('ok');
  });
});
