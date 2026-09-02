import { describe, it, expect } from 'vitest';
import { runRiskEngine } from '../trading/risk-engine';

/*
   주문 전 잔고 확인.

   ★★ 실서비스 기록으로 확인한 문제

     09-01 14:54, 현물 XRPUSDT 매수가 거래소에서 거부됐다. 사유는 거래소가 보낸
     원문 그대로 **'Balance insufficient!'** 였다.

     세 가지가 잘못됐다:

       1. 우리는 잔고를 조회할 수 있었는데 **주문 전에 보지 않았다.** 고객은
          거래소까지 갔다 와서야 실패를 알았다.
       2. 거래소 원문에는 **얼마가 부족한지가 없다.** 고객은 얼마를 더 넣어야
          하는지 모른 채 다시 시도해야 한다.
       3. 리스크 게이트 목록에 잔고 항목이 아예 없었다 — 심볼·레버리지·명목·
          일손실·포지션수·가격편차만 있었다. "이 주문을 낼 돈이 있는가" 라는
          가장 기본적인 질문이 빠져 있었다.

   ★★ 모르는 것을 거부로 만들지 않는다.

     잔고 조회가 실패했을 때 막으면, 돈이 충분한 고객의 주문을 **우리가** 막는다.
     거래소가 막는 것보다 나쁘다 — 고객은 돈이 있는데 쓸 수 없고, 우리 잘못이
     고객 잘못처럼 보인다. 그래서 'warn' 으로 사실만 밝히고 통과시킨다.
     최종 판단자는 거래소다.
*/

const BASE = {
  mode: 'LIVE_TRADE',
  symbol: { id: 'XRPUSDT', tickSize: '0.00001', stepSize: '10', minQty: '10' },
  side: 'long', orderType: 'limit', price: '2', quantity: '100', leverage: 5,
  positionValue: '200', takerFeeRate: '0.0006',
  policy: {
    allowedSymbols: ['*'], maxOrderNotional: '', maxLeverage: 0,
    maxOpenPositions: 0, dailyOrderLimit: 0, dailyLossLimit: '', priceDeviationLimitPct: 5,
  },
  credentialStatus: 'VERIFIED', futureTradePermissionVerified: true, dailyOrderCount: 0,
  dailyLossSoFar: '0', dailyLossKnown: true, openPositions: 0, marketDataStatus: 'LIVE',
  liveTradingEnabled: true, emergencyKillSwitch: false, referencePrice: '2', catalogueLoaded: true,
};

const run = (extra: Record<string, unknown>) =>
  runRiskEngine({ ...BASE, ...extra } as never);
const funds = (extra: Record<string, unknown>) =>
  run(extra).gates.find((g) => g.id === 'funds.available')!;

describe('FUNDS-GATE — 주문 전에 잔고를 본다', () => {
  it('[1] 잔고 게이트가 존재한다 — 예전에는 목록에 아예 없었다', () => {
    const ids = run({ availableQuote: '100' }).gates.map((g) => g.id);
    expect(ids).toContain('funds.available');
  });

  it('[2] 선물은 증거금 + 수수료만 필요하다', () => {
    // 명목 200, 5배 → 증거금 40, 수수료 200×0.0006 = 0.12 → 40.12
    const g = funds({ availableQuote: '100' });
    expect(g.status).toBe('ok');
    expect(g.detail).toContain('40.12');
    // ★ 레버리지를 밝힌다. 왜 40 만 필요한지 고객이 알 수 있어야 한다.
    expect(g.detail).toMatch(/margin at 5x/);
  });

  it('[3] 현물은 전액이 필요하다 — 레버리지가 없다', () => {
    const g = funds({ availableQuote: '100', isSpot: true, leverage: 1 });
    expect(g.status).toBe('fail');
    /*
       ★ 현물을 선물처럼 증거금으로 계산하면 "돈이 있다" 고 잘못 말한다.
         실제 거부가 일어난 것이 바로 현물 주문이었다.
    */
    expect(g.detail).toContain('200.12');
    expect(g.detail).toMatch(/full amount/);
  });

  it('[4] 부족하면 얼마가 부족한지 말한다 — 거래소 원문이 정확히 이걸 안 해줬다', () => {
    const g = funds({ availableQuote: '30' });
    expect(g.status).toBe('fail');
    expect(g.detail).toMatch(/short by/);
    expect(g.detail).toContain('10.12');
    // ★ 가진 금액과 필요 금액을 둘 다 보여준다. 하나만으로는 판단할 수 없다.
    expect(g.detail).toContain('30');
    expect(g.detail).toContain('40.12');
  });

  it('[5] 부족하면 주문이 실제로 막힌다 — 표시만 하고 통과시키면 의미가 없다', () => {
    expect(run({ availableQuote: '30' }).pass).toBe(false);
  });

  it('[6] 잔고를 모를 때는 우리가 막지 않는다 — 거래소가 판단한다', () => {
    const g = funds({ availableQuote: null });
    /*
       ★★ 이것이 이 게이트에서 가장 중요한 성질이다. 조회 실패를 거부로 바꾸면
         잔고가 충분한 고객의 주문을 우리가 막는다. 그건 거래소 거부보다 나쁘다.
    */
    expect(g.status).toBe('warn');
    expect(g.detail).toMatch(/exchange will decide/i);
    expect(run({ availableQuote: null }).pass).toBe(true);
  });

  it('[7] 잔고 기능이 없는 배포는 "확인하지 않았다"고 말한다', () => {
    const g = funds({});
    expect(g.status).toBe('warn');
    /*
       ★ "확인했고 문제없다" 와 "확인하지 않았다" 는 다른 말이다. 후자를 ok 로
         적으면 검사한 것처럼 보인다 — 이 프로젝트가 반복해서 겪은 실패 방식이다.
    */
    expect(g.detail).toMatch(/not checked/i);
    expect(g.detail).not.toMatch(/could not read/i);
  });

  it('[8] 주문 크기를 모르면 비교했다고 하지 않는다', () => {
    const g = funds({ availableQuote: '100', positionValue: undefined });
    expect(g.status).toBe('warn');
    expect(g.detail).toMatch(/cannot compare/i);
  });

  it('[9] 잔고 0 은 측정값이므로 거부한다 — null 과 다르다', () => {
    const zero = funds({ availableQuote: '0' });
    expect(zero.status).toBe('fail');
    const unknown = funds({ availableQuote: null });
    expect(unknown.status).toBe('warn');
    // ★ 두 상태가 같은 결과를 내면 "0 과 모름을 구분한다" 는 말이 거짓이 된다.
    expect(zero.status).not.toBe(unknown.status);
  });
});
