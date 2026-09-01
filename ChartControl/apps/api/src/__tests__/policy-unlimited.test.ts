import { describe, it, expect } from 'vitest';
import { validateOrderIntent } from '../portfolio/order-validation';
import { runRiskEngine } from '../trading/risk-engine';
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

/*
   DAILY-LOSS-HONEST — 설정된 한도가 작동할 수 없으면 통과로 보고하지 않는다.

   ★★ dailyLossSoFar 는 아직 '0' 으로 고정돼 있다(측정 경로가 없다). 그 상태에서
     운영자가 한도를 걸면 `0 <= 한도` 가 언제나 참이라 게이트가 영원히 통과한다.
     운영자는 한도를 걸었다고 믿지만 실제로는 아무 것도 막지 않는다 — 이 착각이
     리스크 게이트에서 가장 위험한 실패다. 그래서 측정 불가 + 한도 설정 상태는
     통과가 아니라 거부로 처리한다.
*/
describe('DAILY-LOSS-HONEST 측정 못 하는 한도는 ok 로 보고하지 않는다', () => {
  const gates = (policy: Record<string, unknown>, known?: boolean) => {
    const out = runRiskEngine({
      mode: 'MOCK',
      symbol: { id: 'BTCUSDT', base: 'BTC', quote: 'USDT', contractType: 'perpetual',
        pricePrecision: 1, quantityPrecision: 3, tickSize: '0.1', stepSize: '0.001',
        minQty: '0.001', maxLeverage: 125 },
      side: 'long', orderType: 'limit', price: '68000', quantity: '0.01', leverage: 5,
      policy: {
        allowedSymbols: ['*'], maxOrderNotional: '', maxLeverage: 0,
        maxOpenPositions: 0, dailyOrderLimit: 0, dailyLossLimit: '',
        priceDeviationLimitPct: 5, ...policy,
      },
      dailyOrderCount: 0, openPositions: 0, dailyLossSoFar: '0',
      ...(known === undefined ? {} : { dailyLossKnown: known }),
    } as unknown as Parameters<typeof runRiskEngine>[0]);
    return (Array.isArray(out) ? out : out.gates).find((g: { id: string }) => g.id === 'policy.dailyLoss');
  };

  it('[1] 한도 없음 → ok, 이유를 밝힌다', () => {
    const g = gates({});
    expect(g!.status).toBe('ok');
    expect(g!.detail).toContain('no operator cap');
  });

  it('[2] ★★ 한도 설정 + 측정 불가 → fail (통과로 위장하지 않는다)', () => {
    const g = gates({ dailyLossLimit: '200' });
    expect(g!.status).toBe('fail');
    expect(g!.detail).toContain('not measured');
  });

  it('[3] 한도 설정 + 측정 가능 + 한도 안쪽 → ok', () => {
    const g = gates({ dailyLossLimit: '200' }, true);
    expect(g!.status).toBe('ok');
  });
});
