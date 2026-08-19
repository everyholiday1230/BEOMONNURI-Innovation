/*
   주문 라우트가 **시장에 맞는 어댑터**를 고르는지
   ------------------------------------------------------------
   ★★ 왜 이것을 검사로 묶는가

     현물과 선물은 수량 의미가 다르다. 선물은 계약수(BTC 1계약 = 0.001 BTC),
     현물은 기초자산 수량 그대로다. 그래서 어댑터를 잘못 고르면 **오류가 나지
     않고 주문 수량이 승수 배(BTC 는 1000배) 틀린다.**

     화면에도 오류가 없고 거래소도 정상 응답을 준다. 이용자가 잔고를 확인할
     때까지 아무도 모른다. 그런 종류의 실패는 검사로만 막을 수 있다.

   ★ 왜 라우트 전체가 아니라 선택 함수를 검사하는가

     주문 경로에는 게이트가 여러 겹 있다(모드 · 시세 신선도 · 자격증명 검증 ·
     선물 권한 확인 · 최종 확인 토큰). 그 전부를 통과시켜야 어댑터 호출까지
     도달하는데, 그렇게 만든 검사는 게이트가 하나 바뀔 때마다 깨지고 **정작
     확인하려던 규칙은 그 안에 묻힌다.**

     그래서 선택 규칙을 순수 함수로 빼고 그것을 직접 검사한다. 게이트는 다른
     검사들이 본다(risk-engine · trading-routes).
*/

import { describe, it, expect } from 'vitest';
import { selectTradingAdapter } from '../trading-routes';

/** 이름만 다른 표식. 어느 쪽이 선택됐는지 구분하는 용도다. */
const futures = { name: 'futures' } as never;
const spot = { name: 'spot' } as never;

describe('ORD-MARKET 어댑터 선택', () => {
  it("[1] ★★ market='spot' 이면 현물 어댑터", () => {
    expect(selectTradingAdapter('spot', { futures, spot })).toBe(spot);
  });

  it('[2] market 이 없으면 선물 어댑터 (기존 동작 유지)', () => {
    expect(selectTradingAdapter(undefined, { futures, spot })).toBe(futures);
    expect(selectTradingAdapter('', { futures, spot })).toBe(futures);
  });

  it("[3] market='futures' 는 선물 어댑터", () => {
    expect(selectTradingAdapter('futures', { futures, spot })).toBe(futures);
  });

  it('[4] 대소문자·공백을 허용한다', () => {
    /*
       클라이언트가 'Spot' 이나 ' spot ' 을 보낼 수 있다. 그때 선물로 떨어지면
       1000배 틀린 주문이 나간다 — 표기 차이로 상품이 바뀌면 안 된다.
    */
    expect(selectTradingAdapter('SPOT', { futures, spot })).toBe(spot);
    expect(selectTradingAdapter(' Spot ', { futures, spot })).toBe(spot);
  });

  it('[5] ★★ 현물 어댑터가 없으면 선물로 대신 보내지 않는다', () => {
    /*
       이용자가 현물을 요청했는데 선물 주문이 나가면, 요청하지 않은 상품에
       주문을 낸 것이다. undefined 면 호출자가 전송을 막는다.
    */
    expect(selectTradingAdapter('spot', { futures })).toBeUndefined();
  });

  it('[6] 선물 어댑터가 없으면 현물로 대신 보내지 않는다', () => {
    expect(selectTradingAdapter('futures', { spot })).toBeUndefined();
    expect(selectTradingAdapter(undefined, { spot })).toBeUndefined();
  });

  it('[7] 알 수 없는 값은 현물로 보내지 않는다', () => {
    /*
       오타나 새로운 시장 이름이 들어왔을 때 현물로 떨어지면, 이용자가 모르는
       상품에 주문이 나간다. 선물(기본)로 가면 기존 동작과 같고, 그쪽은 별도
       게이트가 다시 검증한다.
    */
    expect(selectTradingAdapter('margin', { futures, spot })).toBe(futures);
    expect(selectTradingAdapter(null, { futures, spot })).toBe(futures);
    expect(selectTradingAdapter(123, { futures, spot })).toBe(futures);
  });
});
