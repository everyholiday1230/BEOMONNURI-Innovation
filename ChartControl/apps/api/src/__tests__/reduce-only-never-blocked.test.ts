/*
   ★★★ **청산 주문은 노출 제한 게이트로 막지 않는다.**

   사고(2026-09-19): 운영자가 포지션을 닫으려는데
   `Order blocked before reaching the exchange` 가 떴다.

   원인: 위험 엔진이 `reduceOnly` 를 **아예 몰랐다.** 그 값은 거래소 어댑터에만
   전달됐고, 위험 엔진은 모든 주문을 신규로 봤다. 그래서 노출을 제한하려고 만든
   게이트가 청산까지 막았다.

   ★★ 막히는 조건과 닫아야 하는 상황이 **정확히 일치한다** — 이것이 이 결함의
     성질이다:
       · 손실이 커져 증거금이 묶임   → `funds.available` 실패   → 닫을 수 없다
       · 포지션이 상한까지 찼음      → `policy.openPositions` 실패 → 닫을 수 없다
       · 일일 손실 한도 도달         → `policy.dailyLoss` 실패    → 닫을 수 없다
     즉 가장 위험한 순간에 탈출구가 잠긴다.

   ★ 프로덕션에 `TRADE_MAX_OPEN_POSITIONS=5`, `TRADE_DAILY_ORDER_LIMIT=50` 이 걸려
     있었으므로 실제로 발동할 수 있는 상태였다.
*/
import { describe, it, expect } from 'vitest';
import { runRiskEngine } from '../trading/risk-engine';

/*
   모든 노출 제한을 **일부러 위반하는** 입력. 신규라면 전부 떨어져야 한다.
   ★ 입력 형태는 기존 `funds-gate.test.ts` 의 BASE 를 따른다 — 심볼은 `id` 키다.
*/
function hostileInput(reduceOnly: boolean | undefined): Record<string, unknown> {
  const i: Record<string, unknown> = {
    mode: 'LIVE_TRADE',
    symbol: { id: 'BTCUSDT', tickSize: '0.1', stepSize: '0.001', minQty: '0.001' },
    side: 'short', orderType: 'market', quantity: '1',
    leverage: 20,                     // > maxLeverage(2)
    positionValue: '80000',           // > maxOrderNotional(100)
    takerFeeRate: '0.0006',
    availableQuote: '0',              // 잔고 0 — 증거금이 없다
    policy: {
      allowedSymbols: ['BTCUSDT'],
      maxOrderNotional: '100',
      maxLeverage: 2,
      maxOpenPositions: 5,
      dailyOrderLimit: 50,
      dailyLossLimit: '10',
      priceDeviationLimitPct: 5,
    },
    credentialStatus: 'VERIFIED', futureTradePermissionVerified: true,
    dailyOrderCount: 50,              // == 상한 → 신규는 실패
    dailyLossSoFar: '500',            // > 한도
    dailyLossKnown: true,
    openPositions: 5,                 // == 상한 → 신규는 실패
    marketDataStatus: 'LIVE',
    liveTradingEnabled: true, emergencyKillSwitch: false,
    referencePrice: '80000', catalogueLoaded: true,
  };
  if (reduceOnly !== undefined) i.reduceOnly = reduceOnly;
  return i;
}
const run = (i: Record<string, unknown>) => runRiskEngine(i as never);

const EXPOSURE_GATES = [
  'funds.available',
  'policy.openPositions',
  'policy.dailyOrders',
  'policy.dailyLoss',
  'policy.notional',
  'policy.leverage',
];

describe('청산 주문은 노출 제한으로 막히지 않는다', () => {
  it('신규 주문은 노출 제한을 위반하면 막힌다 (대조군)', () => {
    const r = run(hostileInput(false));
    const failed = r.gates.filter((g) => g.status === 'fail').map((g) => g.id);
    /* ★ 대조군이 통과하면 이 시험 자체가 아무것도 증명하지 못한다. */
    expect(failed.length, '노출 제한이 아무것도 막지 못했다 — 시험 입력이 잘못됐다')
      .toBeGreaterThan(0);
    expect(r.pass).toBe(false);
  });

  /*
     ★★★ 같은 입력에 `reduceOnly: true` 만 붙이면 노출 제한이 전부 통과해야 한다.
       하나라도 남으면 고객이 포지션에 갇힌다.
  */
  it('같은 입력이라도 청산이면 노출 게이트가 전부 통과한다', () => {
    const r = run(hostileInput(true));
    const stillFailing = r.gates
      .filter((g) => g.status === 'fail' && EXPOSURE_GATES.includes(g.id))
      .map((g) => `${g.id}(${g.detail})`);
    expect(stillFailing, `청산을 막는 게이트가 남아 있다: ${stillFailing.join(' | ')}`).toEqual([]);
  });

  it('청산이면 위험 검사 전체가 통과한다', () => {
    const r = run(hostileInput(true));
    const failed = r.gates.filter((g) => g.status === 'fail').map((g) => `${g.id}:${g.detail}`);
    expect(failed, `청산인데 떨어진 게이트: ${failed.join(' | ')}`).toEqual([]);
    expect(r.pass, '청산인데 위험 검사가 통과하지 않는다').toBe(true);
  });

  /*
     ★★ 면제를 **감추지 않는다.** 게이트를 목록에서 빼면 운영자가 "왜 통과했는지"
       를 알 수 없고 상한이 동작하는지도 확인할 수 없다. `ok` 로 남기고 이유를 적는다.
  */
  it('면제한 이유를 게이트에 적어 둔다', () => {
    const r = run(hostileInput(true));
    for (const id of EXPOSURE_GATES) {
      const g = r.gates.find((x) => x.id === id);
      expect(g, `${id} 게이트가 목록에서 사라졌다 — 감추면 안 된다`).toBeDefined();
      expect(g!.detail, `${id} 에 면제 이유가 없다`).toMatch(/reduce-only/u);
    }
  });

  /*
     ★★★ 면제하면 **안 되는** 것: 종목·가격 이탈. 노출 제한이 아니라 주문 자체가
       올바른지 보는 검사다. 엉뚱한 종목이나 가격으로 청산하는 것도 손해다.
  */
  it('종목과 가격 이탈 검사는 청산에도 적용된다', () => {
    const base = hostileInput(true);
    const wrongSymbol = run({ ...base, symbol: { ...(base.symbol as object), id: 'DOGEUSDT' } });
    const sym = wrongSymbol.gates.find((g) => g.id === 'policy.symbol');
    expect(sym?.status, '허용되지 않은 종목인데 청산이라고 통과시켰다').toBe('fail');

    const farPrice = run({ ...base, orderType: 'limit', price: '50000', referencePrice: '80000' });
    const dev = farPrice.gates.find((g) => g.id === 'policy.priceDeviation');
    expect(dev?.status, '가격이 37% 벗어났는데 청산이라고 통과시켰다').toBe('fail');
  });

  /*
     ★ 값이 없으면 **신규로 간주**한다. 모르는 것을 청산으로 취급하면 상한을
       우회하는 길이 된다(킬스위치 쪽에서 이미 같은 결정을 했다).
  */
  it('reduceOnly 가 없으면 신규로 본다', () => {
    /* ★ 필드를 아예 넣지 않는다 — false 로 넣는 것과 다른 상황이다. */
    const r = run(hostileInput(undefined));
    expect(r.pass, 'reduceOnly 를 모르는데 청산처럼 통과시켰다').toBe(false);
  });
});

describe('차단은 로그에 남는다', () => {
  /*
     ★★★ 이 사고에서 가장 오래 걸린 부분이 원인 찾기였다. 차단이 **DB 에만**
       기록되고 로그에는 흔적이 없어서, 고객이 알려줘도 어느 게이트가 떨어졌는지
       알 수 없었다.
  */
  it('어느 게이트가 떨어졌는지 로그로 남긴다', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const src = readFileSync(join(__dirname, '../trading-routes.ts'), 'utf8');
    expect(src, '차단을 로그에 남기지 않는다').toMatch(/order-audit\] order\.blocked/u);
    /* ★ 청산 여부를 적어야 한다 — 청산이 막혔다면 그것만으로 사고다. */
    expect(src, '로그에 청산 여부가 없다').toMatch(/order\.blocked[^`]*reduceOnly=/u);
    /* ★ 떨어진 게이트 이름이 없으면 로그가 쓸모없다. */
    expect(src, '떨어진 게이트를 적지 않는다').toMatch(/status === 'fail'\)\.map\(\(g\) => `\$\{g\.id\}/u);
  });
});
