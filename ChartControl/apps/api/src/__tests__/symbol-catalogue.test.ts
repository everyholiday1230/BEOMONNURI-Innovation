import { describe, it, expect } from 'vitest';
import { evaluateRiskGates } from '@quantumtrade/domain';
import { validateOrderIntent } from '../portfolio/order-validation';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
   심볼 카탈로그 적재 실패를 고객 탓으로 말하지 않는다.

   ★★ 실서비스 사고 (production 데이터로 확인)

     08-30, 한 고객의 주문 9건이 'symbol metadata unavailable' 로 막혔다.
     02:54 부터 09:44 까지 XRPUSDT · ENAUSDT · SOLUSDT 로 8번 다시 눌렀다.
     고객 입력에는 아무 문제가 없었다 — **우리가 거래소 심볼 카탈로그를 받지
     못한 상태**였다.

     두 가지가 겹쳐서 이 사고가 길어졌다:

       1. 적재 실패가 `catch { }` 로 **완전히 조용**했다. 거래 가능 여부를
          좌우하는 데이터인데 로그가 한 줄도 없었다. 운영자는 고객이 왜 거래를
          못 하는지 알 수 없었다.

       2. 고객이 본 문구가 **자기 잘못처럼 읽혔다.** "symbol metadata
          unavailable" 은 심볼을 잘못 골랐다는 뜻으로 읽힌다. 그래서 계속
          다시 눌렀다.

     세 번째 문제도 있었다: 재시도 간격이 10분뿐이라, 부팅 직후 한 번 실패하면
     최소 10분간 BTC/ETH 외 모든 주문이 막혔다. 배포마다 그 창이 생겼고 배포는 잦다.
*/

const ROOT = join(__dirname, '..', '..', '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const SYM = { id: 'XRPUSDT', tickSize: '0.00001', stepSize: '10', minQty: '10', pricePrecision: 5, qtyPrecision: 0 };

describe('SYMBOL-CATALOGUE — 적재 실패를 고객 탓으로 말하지 않는다', () => {
  it('[1] 카탈로그 미적재는 "우리 문제"라고 말한다', () => {
    const r = evaluateRiskGates({
      symbol: undefined, side: 'long', orderType: 'limit', price: '1', quantity: '10', leverage: 1,
      catalogueLoaded: false,
    } as never);
    const g = r.gates.find((x) => x.id === 'metadata')!;
    expect(g.status).toBe('fail');
    /*
       ★★ 고객이 자기 입력을 의심하며 반복 시도하는 것을 막는 것이 목적이다.
         그래서 "네 입력 문제가 아니다" 와 "잠시 뒤 다시" 가 둘 다 있어야 한다.
    */
    expect(g.detail).toMatch(/not your input/i);
    expect(g.detail).toMatch(/retry/i);
    // ★ 옛 문구가 남아 있으면 같은 오해가 반복된다.
    expect(g.detail).not.toBe('symbol metadata unavailable');
  });

  it('[2] 카탈로그가 있는데 그 심볼이 없으면 "다른 시장을 고르라"고 말한다', () => {
    const r = evaluateRiskGates({
      symbol: undefined, side: 'long', orderType: 'limit', price: '1', quantity: '10', leverage: 1,
      catalogueLoaded: true,
    } as never);
    const g = r.gates.find((x) => x.id === 'metadata')!;
    expect(g.status).toBe('fail');
    // 이 경우는 실제로 고객이 행동해야 한다 — 두 상황의 안내가 달라야 한다.
    expect(g.detail).toMatch(/pick another market/i);
    expect(g.detail).not.toMatch(/not your input/i);
  });

  it('[3] 규격이 있으면 통과한다', () => {
    const r = evaluateRiskGates({
      symbol: SYM, side: 'long', orderType: 'limit', price: '1', quantity: '10', leverage: 1,
      catalogueLoaded: true,
    } as never);
    expect(r.gates.find((x) => x.id === 'metadata')!.status).toBe('ok');
  });

  it('[4] paper 주문 경로도 두 경우를 다른 코드로 구분한다', () => {
    const base = {
      policy: {
        allowedSymbols: ['*'], maxOrderNotional: '', maxLeverage: 0,
        maxOpenPositions: 0, dailyOrderLimit: 0, dailyLossLimit: '', priceDeviationLimitPct: 5,
      },
      referencePrice: '68000', referenceStale: false,
      minNotional: '1', takerFeeRate: '0.0006', makerFeeRate: '0.0002',
      liveTradingEnabled: false, killSwitchActive: false,
      tradingMode: 'MOCK', availableBalance: '1000000',
      openPositions: 0, dailyOrderCount: 0,
    };
    const intent = { symbol: 'XRPUSDT', side: 'long', orderType: 'limit', price: '1', quantity: '10', leverage: 1 };

    const ours = validateOrderIntent(
      intent as never,
      { ...base, symbolInfo: undefined, catalogueLoaded: false } as never,
    );
    const theirs = validateOrderIntent(
      intent as never,
      { ...base, symbolInfo: undefined, catalogueLoaded: true } as never,
    );

    /*
       ★★ 코드가 달라야 한다. 같은 코드면 화면·로그·고객 문의에서 두 상황을
         구분할 수 없고, 결국 다시 "지원하지 않는 심볼" 로 뭉개진다.
    */
    expect(ours.blockingReasons.map((b) => b.code)).toContain('SYMBOL_CATALOGUE_UNAVAILABLE');
    expect(theirs.blockingReasons.map((b) => b.code)).toContain('UNKNOWN_SYMBOL');

    const msg = ours.blockingReasons.find((b) => b.code === 'SYMBOL_CATALOGUE_UNAVAILABLE')!.message;
    expect(msg).toMatch(/not your input/i);
  });

  it('[5] 적재 실패가 로그에 남는다 — 조용한 catch 가 사고를 길게 만들었다', () => {
    const src = read('apps/api/src/index.ts');
    for (const fn of ['refreshSymbolInfo', 'refreshSpotSymbolInfo']) {
      const start = src.indexOf(`async function ${fn}(`);
      expect(start, `${fn} 를 찾을 수 없다`).toBeGreaterThan(0);
      const body = src.slice(start, start + 1800);
      /*
         ★★ catch 에 로그가 없으면 이 사고가 그대로 반복된다. 실패를 삼키는 것
           자체가 문제가 아니라(주문 경로를 죽이면 안 된다), **삼킨 사실을 아무도
           모르는 것**이 문제였다.
      */
      expect(body, `${fn}: 실패를 기록하지 않는다`).toMatch(/console\.error/);
      // ★ 빈 응답을 성공으로 취급하면 폴백뿐인 상태가 '정상' 으로 기록된다.
      expect(body, `${fn}: 빈 카탈로그를 성공으로 본다`).toMatch(/length === 0/);
    }
  });

  it('[6] 첫 성공까지 빠르게 재시도한다 — 10분 간격만 있으면 배포마다 창이 생긴다', () => {
    const src = read('apps/api/src/index.ts');
    for (const fn of ['loadSymbolCatalogueWithRetry', 'loadSpotCatalogueWithRetry']) {
      const start = src.indexOf(`async function ${fn}(`);
      expect(start, `${fn} 가 없다`).toBeGreaterThan(0);
      const body = src.slice(start, start + 700);
      // 즉시 시도 + 점증 대기. 첫 지연이 10분이면 목적을 잃는다.
      expect(body).toMatch(/const delays = \[0,/);
    }
  });

  it('[7] 운영자 상태창이 카탈로그 적재 여부를 보여준다', () => {
    const src = read('apps/api/src/index.ts');
    /*
       ★ 이것이 없어서 사고를 놓쳤다. 거래 가능 여부를 좌우하는 값이면
         상태창에 있어야 한다 — 없으면 운영자는 고객 문의를 받고서야 안다.
    */
    expect(src).toMatch(/symbolCatalogueFutures:/);
    expect(src).toMatch(/symbolCatalogueSpot:/);
    // 실패 시 원인을 그대로 보여준다. "실패" 만 있으면 다음 행동을 정할 수 없다.
    expect(src).toMatch(/last error: \$\{st\.lastError\}/);
  });

  it('[8] 적재 여부는 맵 크기 추측이 아니라 실제 사실로 판단한다', () => {
    const routes = read('apps/api/src/trading-routes.ts');
    /*
       ★★ 처음에는 맵 크기로 추측했다(폴백 2개보다 많으면 적재됨). 틀렸다 —
         mock 배포는 진짜 카탈로그가 2건이라 폴백과 구분되지 않아 "미적재" 로
         잘못 판단했다. 추측이 개입하면 두 상황을 거꾸로 말할 수 있다.
    */
    expect(routes).toMatch(/d\.catalogueReady/);
    expect(routes).not.toMatch(/STATIC_SYMBOL_FALLBACK_COUNT/);
  });
});
