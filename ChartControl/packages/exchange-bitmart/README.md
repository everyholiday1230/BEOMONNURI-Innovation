# packages/exchange-bitmart — 이름과 달리, 지우면 거래가 멈춥니다

## 먼저 알아야 할 것

BitMart 는 **지금 연결할 수 없는 거래소**입니다(파트너이지만 이 배포는 `DATA_MODE` 로
고른 어댑터 **하나**만 띄웁니다). 그래서 "쓰지 않는 거래소니 이 패키지를 지우자" 는
판단이 나올 수 있습니다.

**지우면 KuCoin 거래가 멈춥니다.** 실제로 거래를 처리하는 KuCoin 어댑터가 이 패키지를
의존하고 있었기 때문입니다.

## 그래서 무엇을 했는가

거래소 중립 계약을 `@quantumtrade/exchange-core` 로 **분리했습니다.**

| 옮긴 것 | 이유 |
|---|---|
| `interfaces.ts` (118줄) | `ExchangeContext`, `IExchangeTradingAdapter`, `NormalizedOrder` 등 — BitMart 언급이 주석 1곳뿐인 완전 중립 타입 |
| `modes.ts` | 실행 모드(READ_ONLY/SHADOW/LIVE_TRADE)와 라이브 게이트 — BitMart 언급 0 |

런타임 코드가 아니라 **타입과 순수 함수**만 옮겼습니다. 그래서 동작이 바뀌지 않습니다
(전체 테스트 1240 + 133 통과로 확인).

KuCoin 어댑터 두 개(`kucoin-trading-adapter.ts`, `kucoin-spot-trading-adapter.ts`)와
`trading-routes.ts` 는 이제 `@quantumtrade/exchange-core` 에서 직접 가져옵니다. 살아 있는
거래 경로가 경쟁 거래소 이름의 패키지를 의존하지 않습니다.

## 이 패키지에 남은 것 (BitMart 고유)

| 파일 | BitMart 언급 |
|---|---|
| `broker-rebate.ts` | 22 |
| `signature.ts` | 7 |
| `futures-rest-adapter.ts` | 7 |
| `private-ws-adapter.ts` | 6 |
| `rate-limit.ts` | 5 |
| `futures-ws.ts` | 4 |

서명 방식, 요율 제한, 브로커 리베이트는 거래소마다 다릅니다. 여기 있는 것이 맞습니다.

## 왜 패키지 이름을 바꾸지 않았는가

이름만 바꾸면(예: `exchange`) **반대 방향으로 오해**를 만듭니다 — 안에 BitMart 전용
구현이 들어 있으니까요. 문제는 이름이 아니라 **중립 계약이 거래소 전용 패키지에 섞여
있던 것**이었고, 그것을 분리했습니다.

## 아직 이 패키지를 쓰는 KuCoin 파일

`kucoin-account-adapter.ts`, `kucoin-rebate-source.ts`, `broker-rebate-source.ts`,
`live-order-service.ts`, `risk-engine.ts`, `stage-a-probe.ts` — 리베이트처럼 BitMart 고유
타입을 함께 쓰기 때문입니다. 더 분리할 수 있지만 라이브 주문 경로를 건드리는 일이라
필요할 때 하나씩 하는 편이 안전합니다.

**주문이 무장된 상태(`LIVE_TRADING_ENABLED=true`)에서 이 경로를 크게 손대지 마십시오.**
