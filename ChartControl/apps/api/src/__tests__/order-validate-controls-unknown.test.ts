import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateOrderIntent } from '../portfolio/order-validation';

const read = (p: string) => readFileSync(join(__dirname, p), 'utf8');

/*
   ★★ **주문 검증과 주문 제출이 같은 답을 내는지** 잠근다.

     실주문 경로(trading-routes → runRiskEngine)는 킬스위치 상태를 못 읽으면
     (`controlsUnknown`) 주문을 거부한다. 그런데 주문 **검증** 경로
     (portfolio/order-routes → validateOrderIntent)는 그 값을 아예 받지 않았다.

     결과:

       운영자가 global_live_trading 을 걸었다
         → DB 를 못 읽는 상황이 겹친다
         → /orders/validate 는 "gate.killSwitch: ok" → 고객 화면 "주문 가능"
         → 실제 제출은 거부된다

     실주문이 나가지는 않지만 **화면이 사실과 다른 것을 말한다.** 그리고 고객은
     가능하다고 본 뒤 제출에서 막힌다.

   ★ 같은 질문("이 주문 나갈 수 있나?")에 두 경로가 다르게 답하면 어느 쪽이 맞는지
     알 수 없다. 이 저장소에서 방향 가드가 경로별로 갈렸던 것과 같은 구조의 결함이다.
*/

const SYM = {
  id: 'BTCUSDT', base: 'BTC', quote: 'USDT', contractType: 'perpetual',
  pricePrecision: 1, quantityPrecision: 3, tickSize: '0.1', stepSize: '0.001',
  minQty: '0.001', maxLeverage: 125,
};

const INTENT = {
  symbol: 'BTCUSDT', side: 'long', orderType: 'limit',
  price: '68000', quantity: '0.01', leverage: 5,
} as unknown as Parameters<typeof validateOrderIntent>[0];

/* 킬스위치 관련 값만 바꿔가며 검사한다. 그 밖의 게이트는 통과하도록 맞춘 문맥. */
const baseCtx = (over: Record<string, unknown> = {}) => ({
  symbolInfo: SYM,
  catalogueLoaded: true,
  policy: {
    /* ★ 이 파일은 킬스위치만 본다. 다른 게이트는 전부 통과하는 값으로 고정한다. */
    allowedSymbols: ['BTCUSDT'], maxOrderNotional: '', maxLeverage: 125,
    maxOpenPositions: 0, dailyOrderLimit: 0, dailyLossLimit: '',
    priceDeviationLimitPct: 5,
  },
  referencePrice: '68000', referenceStale: false,
  minNotional: '1', takerFeeRate: '0.0006', makerFeeRate: '0.0002',
  liveTradingEnabled: true,
  killSwitchActive: false,
  newPositionsHalted: false,
  controlsUnknown: false,
  tradingMode: 'KUCOIN_LIVE',
  availableBalance: '1000000',
  openPositions: 0, dailyOrderCount: 0,
  ...over,
} as unknown as Parameters<typeof validateOrderIntent>[1]);

const gate = (r: ReturnType<typeof validateOrderIntent>, id: string) =>
  r.riskChecks.find((g) => g.id === id);
const blockedFor = (r: ReturnType<typeof validateOrderIntent>, code: string) =>
  r.blockingReasons.some((b) => b.code === code);

describe('주문 검증 — 킬스위치 상태를 모르면 "가능" 이라고 말하지 않는다', () => {
  it('정상 상태에서는 허용된다 (기준선)', () => {
    const r = validateOrderIntent(INTENT, baseCtx());
    expect(gate(r, 'gate.controlsKnown')?.status).toBe('ok');
    expect(r.allowed).toBe(true);
  });

  it('★ 상태를 모르면 allowed 가 false 다', () => {
    const r = validateOrderIntent(INTENT, baseCtx({ controlsUnknown: true }));
    expect(r.allowed, '상태를 모르는데 허용했다').toBe(false);
    expect(blockedFor(r, 'CONTROLS_UNKNOWN')).toBe(true);
  });

  /*
     ★★ "걸렸다" 와 "모른다" 를 **다른 코드**로 구분한다.

       운영자가 로그를 볼 때 대응이 전혀 다르다 — 후자는 DB 를 봐야 한다.
       하나로 합치면 운영자가 스위치를 찾다가 시간을 버린다.
  */
  it('★ 모르는 것을 "스위치가 걸렸다" 로 보고하지 않는다', () => {
    const r = validateOrderIntent(INTENT, baseCtx({ controlsUnknown: true }));
    expect(blockedFor(r, 'KILL_SWITCH_ACTIVE'), '모르는 것을 걸린 것으로 보고했다').toBe(false);
    /* gate.killSwitch 자체도 'fail' 로 바뀌지 않아야 한다 — 그것은 또 다른 거짓이다. */
    expect(gate(r, 'gate.killSwitch')?.status).toBe('ok');
    expect(gate(r, 'gate.controlsKnown')?.status).toBe('fail');
  });

  /*
     ★★ 고객 잘못으로 표시하지 않는다.

       `valid` 는 "주문의 형태·크기가 맞는가", `allowed` 는 "이 시스템이 보낼 것인가" 다.
       우리 쪽 상태를 valid=false 로 만들면 화면이 "주문 내용이 잘못됐다" 고 말하고,
       고객은 고칠 것이 없는 숫자를 고치려 한다.
  */
  it('★ 우리 쪽 상태를 고객 입력 오류로 표시하지 않는다', () => {
    const r = validateOrderIntent(INTENT, baseCtx({ controlsUnknown: true }));
    expect(r.valid, '우리 상태를 주문 형태 오류로 보고했다').toBe(true);
    expect(r.allowed).toBe(false);
  });

  it('킬스위치가 실제로 걸린 경우는 그대로 보고한다', () => {
    const r = validateOrderIntent(INTENT, baseCtx({ killSwitchActive: true }));
    expect(blockedFor(r, 'KILL_SWITCH_ACTIVE')).toBe(true);
    expect(r.allowed).toBe(false);
  });
});

describe('주문 검증 라우터 — controlsUnknown 을 실제로 물어본다', () => {
  /*
     ★ 타입만 필수로 바꿔도 라우터가 물어보지 않으면 의미가 없다. 주입 지점이
       빠지면 컴파일은 통과하고 값은 항상 false 가 된다.
  */
  it('라우터가 controls.controlsUnknown() 을 호출한다', () => {
    const src = read('../portfolio/order-routes.ts');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code, 'controlsUnknown 을 묻지 않는다').toMatch(/controlsUnknown:\s*d\.controls\s*\?\s*d\.controls\.controlsUnknown\(\)/);
  });

  /*
     ★★ controls 자체가 없는 배포(개발·모의)에서는 **모르는 것이 아니다** —
       강제할 대상이 없는 것이다. 그때 막으면 개발에서 주문 검증을 할 수 없다.
  */
  it('controls 가 없는 배포에서는 막지 않는다', () => {
    const src = read('../portfolio/order-routes.ts');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    /* d.controls 가 없으면 false — 즉 '모른다' 가 아니다. */
    expect(code).toMatch(/d\.controls\s*\?\s*d\.controls\.controlsUnknown\(\)\s*:\s*false/);
  });

  /*
     ★★ 타입이 필수인지 확인한다. 선택으로 두면 주입하는 쪽이 빠뜨려도 컴파일이
       통과하고, 빠진 곳이 곧 구멍이 된다 — 이 결함이 정확히 그렇게 생겼다.
  */
  it('controls 타입이 controlsUnknown 을 필수로 요구한다', () => {
    const src = read('../portfolio/order-routes.ts');
    expect(src).toMatch(/controls\?:\s*\{[^}]*controlsUnknown\(\):\s*boolean[^}]*\}/);
  });
});
