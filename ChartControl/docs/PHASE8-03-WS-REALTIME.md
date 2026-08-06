# PHASE8-03 — BitMart 선물 WebSocket 실시간 연동

작성 2026-08-03. 이 문서의 모든 프로토콜 사실은 **실 엔드포인트 실측**이며, 문서와 다른 부분은 그렇게 표시했습니다.

## 1. 요약

브라우저 → 우리 게이트웨이(`apps/market-gateway`, :8790) → BitMart 선물 공개 WS.
브라우저는 BitMart에 직접 붙지 않습니다. 이유는 두 가지입니다.

- BitMart는 **IP당 연결 500개** 제한이 있습니다. 클라이언트가 직접 붙으면 사용자 수만큼 소비됩니다.
- 자격증명이 브라우저에 도달하지 않습니다(공개 채널은 무인증이지만 비공개 채널로 확장할 때 이 경계가 필요).

## 2. 기존 코드에서 발견한 버그 — 동작한 적이 없음

`apps/market-gateway/src/upstream.ts`의 `BitMartPublicUpstream`은 **한 번도 데이터를 받은 적이 없습니다.**
그리고 받지 못하고 있다는 사실을 보고할 수도 없었습니다.

| # | 문제 | 결과 |
|---|---|---|
| 1 | `{op:'subscribe'}` 전송 | 서버는 `action`을 기대. 구독 자체가 무시됨 |
| 2 | `spot/ticker:<symbol>` 구독 | **선물 플랫폼에서 spot 채널.** 실측: `Invalid channel: not found spot/ticker:BTCUSDT` |
| 3 | ack를 `catch {}`로 폐기 | 위 거부 메시지가 어디에도 남지 않음 |
| 4 | 모든 프레임을 `type:'ticker'`로 라벨 | 캔들이 `candleCache`에 도달 불가 |
| 5 | `msg.data?.[0]?.symbol` | 선물 payload는 객체. symbol이 항상 빈 문자열 → 키가 `ticker:`로 붕괴 |
| 6 | ping 없음 | 무데이터 20초면 서버가 연결 종료 |
| 7 | 재연결 없음 | 한 번 끊기면 영구 정지 |
| 8 | `status().connected`가 위 전부에서 `true` 유지 | 조용한 실패 |

추가로 게이트웨이 서버 쪽 설계 결함 1건:

**구독 키에 타임프레임이 없었습니다.** `SubscriptionManager`는 키로 중복 제거하므로 `candle:BTCUSDT` 하나를
1m 구독자와 1h 구독자가 공유했고, 먼저 연 쪽의 봉이 양쪽에 전달됩니다. `candleCache.upsert(symbol, '1m', ...)`는
타임프레임을 `'1m'`으로 **하드코딩**하고 있어 캐시도 같은 거짓에 동의합니다.
→ 키를 `candle@1m:BTCUSDT`로 한정(`src/stream-key.ts`). 심볼은 마지막 위치를 유지해 기존 `split(':')[1]`이 계속 동작합니다.

## 3. 문서가 틀린 곳 (실측 기준)

### 3.1 kline payload 구조

문서: `data: {symbol, o, h, l, c, v, ts}`
실제: `data: {symbol, items: [{o, h, l, c, v, ts}]}`

```
{"group":"futures/klineBin1m:BTCUSDT",
 "data":{"symbol":"BTCUSDT","items":[{"o":"63090.9","h":"63090.9","l":"63075.2","c":"63075.2","v":"19672","ts":1785727320}]}}
```

envelope에서 `o`를 읽으면 `undefined` → `NaN` → 아무것도 그려지지 않습니다.

### 3.2 ping 응답

문서: "Expect for a text string 'pong'"
실제: `{"group":"System","data":"pong+8f0547ab-3f55-455f-90d5-602ca741517e"}`

`raw === 'pong'`으로 비교하는 클라이언트는 응답을 영원히 못 보고, ping 주기마다 건강한 연결을 스스로 끊습니다.

### 3.3 3분봉 채널이 없음

문서의 채널 목록에 `klineBin3m`이 없고, 실측도 `Invalid channel: not found futures/klineBin3m:BTCUSDT`입니다.
우리 내부 `TIMEFRAMES`에는 `3m`이 있습니다.

**처리:** `klineTopic('BTCUSDT','3m')`은 `null`을 반환합니다. 인접 구간(1m/5m)으로 대체하지 않습니다 —
3m 구독자에게 1m 봉을 주면 화면은 맞아 보이고 실제로는 틀립니다.
게이트웨이 기본 `GATEWAY_TIMEFRAMES`에서 3m을 제외해 **입구에서 거부**하고, 운영자가 명시적으로 켜면
`stream_unavailable` 프레임으로 경고합니다. REST `step=3`은 유효하므로 히스토리는 조회 가능합니다.

## 4. 타임프레임 표기가 세 가지

| 계층 | `1h` | `4h` | `1d` | 비고 |
|---|---|---|---|---|
| 내부 enum (`@quantumtrade/config`) | `1h` | `4h` | `1d` | 소문자 |
| REST `step` | `60` | `240` | `1440` | **분 단위 정수** |
| WS 채널 | `klineBin1H` | `klineBin4H` | `klineBin1D` | **대문자 H/D/W** |

실측: `futures/klineBin1h` → `Invalid channel`. REST `timeframe=1H` → `400 BAD_REQUEST`.
변환은 `packages/exchange-bitmart/src/futures-ws.ts` 한 곳에만 있습니다.

## 5. 그 외 채널별 실측 사실

| 채널 | data 형태 | 시간 필드 | 비고 |
|---|---|---|---|
| `futures/klineBin*` | 객체 + `items[]` | `ts` **초** | 스트림 봉은 진행 중이라 `closed:false` |
| `futures/ticker` | 객체 | 없음 | `range`는 **비율** → ×100이 퍼센트 |
| `futures/bookticker` | 객체 | `ms_t` **밀리초** | |
| `futures/trade` | **배열** | `created_at` RFC3339 나노초 | `trade_id`는 큰 정수 → 문자열 보존 |
| `futures/depth20` | 객체 | `ms_t` 밀리초 | **`way:1`(bid)/`way:2`(ask) 분리 전송** |

`range`가 비율인 것은 REST `change_24h`와 동일한 문제입니다(PHASE8-02 참조). 같은 `ratioToPercent()`를 적용합니다.

## 6. 구현 파일

| 파일 | 역할 |
|---|---|
| `packages/exchange-bitmart/src/futures-ws.ts` | 순수 프로토콜 변환. 소켓·상태 없음. 토픽 생성, 프레임 파싱, REST kline URL/파싱 |
| `apps/market-gateway/src/stream-key.ts` | 타임프레임 한정 스트림 키 |
| `apps/market-gateway/src/upstream.ts` | `BitMartPublicUpstream` 재작성 — 구독/ping/재연결/진단 |
| `apps/market-gateway/src/server.ts` | 키에 타임프레임 반영, 히스토리 시딩, `/health/ready` 진단 노출 |
| `apps/broker-web/src/lib/gatewayStream.ts` | 브라우저 클라이언트. 공유 소켓 + 참조 카운트, `useLiveCandles`/`useLiveTicker` |

## 7. 설계 결정

1. **거부·미지원을 진단에 기록.** `/health/ready`가 `acked`/`rejected`/`unsupported`/`reconnects`/`unknownFrames`를 노출합니다. 기존 버그가 오래 남은 이유가 이 정보의 부재입니다.
2. **`connected`는 소켓 상태 AND ack 존재.** 소켓은 열렸지만 모든 토픽이 거부되었다면 동작하는 upstream이 아닙니다.
3. **구독 시 REST 히스토리 시딩.** `klineBin`은 변화 시에만 push하므로 1d 구독자는 오래 빈 화면을 봅니다. 200봉을 즉시 전달합니다.
4. **스트림 봉은 `closed:false`, REST 봉은 `closed:true`.**
5. **동일 `ts` 재수신은 교체.** BitMart는 진행 중 봉을 같은 `ts`로 반복 push합니다. append하면 구간당 수십 개 중복 캔들이 생깁니다.
6. **재연결 백오프 상한 30초(서버)/15초(클라이언트).** 즉시 재시도 루프는 500 연결 한도를 스스로 소진합니다.
7. **클라이언트는 공유 소켓 1개 + 참조 카운트.** `/multi-chart` 6패널이 소켓 6개를 열면 히스토리도 6번 받습니다.
8. **참조 0 → 250ms 유예 후 종료.** React는 새 effect보다 이전 cleanup을 먼저 실행하므로, 타임프레임 변경 시 참조가 한 틱 0이 됩니다. 즉시 종료하면 클릭마다 재연결합니다.
9. **`/markets`는 WS를 쓰지 않습니다.** `futures/ticker`는 심볼별이고 이 페이지는 1,215개 계약을 나열하는데 사용자당 구독 한도는 20개입니다. 15초 REST 폴링이고, subtitle에 "15초 갱신"으로 표시합니다(이전 "실시간" 표기는 최대 15초 과장이라 수정).
10. **MOCK upstream의 티커 형태(`{price,ts}`)는 클라이언트가 거부.** `price`를 `last`에 매핑하고 나머지를 지어내면 가짜 mark/index price가 실제처럼 표시됩니다.

## 8. 검증 (전부 실제 실행)

### 단위·통합
```
packages/exchange-bitmart  futures-ws.test.ts        34 passed
apps/market-gateway        bitmart-upstream.test.ts  30 passed
apps/market-gateway        gateway-server.test.ts    14 passed (12→14)
apps/broker-web            gateway-stream.test.ts    24 passed
```
프로토콜 테스트의 payload는 **실 엔드포인트 캡처 그대로**입니다(문서 전사 아님).

### 전체 회귀
```
pnpm -r typecheck  exit 0, TS errors 0
pnpm -r test       exit 0, 1441 passed
pnpm build         exit 0
pnpm lint          exit 0, 경고 6건 (전부 기존 apps/web/authApi.ts)
```

### 실 BitMart E2E (게이트웨이 :8790, `GATEWAY_UPSTREAM=BITMART_PUBLIC`)
```
악성 origin              → 403 거부
http://localhost:5174    → 수락
history                  1건 200봉
candle@15m:BTCUSDT       실시간 7건 / 20초
ticker:ETHUSDT           실시간 8건 / 20초
마지막 캔들  {"time":1785728700000,"open":"63042.4","high":"63042.4","low":"62764.3","close":"62908.9","volume":"954898","closed":false}
마지막 티커  {"symbol":"ETHUSDT","last":"1858.53","markPrice":"1858.47","indexPrice":"1859.35604651","changePct":-0.8964,...}
candle@3m                → INVALID invalid timeframe (기본 허용목록에서 제외)
connected=true  acked=["futures/klineBin15m:BTCUSDT","futures/ticker:ETHUSDT"]
rejected=[]  reconnects=0  unknownFrames=0
```

별도 실행에서 1m/1h 동시 구독도 확인:
`acked=["futures/klineBin1m:BTCUSDT","futures/klineBin1H:BTCUSDT","futures/ticker:ETHUSDT"]`,
`candle@1m` 8건 / `candle@1h` 3건 — 서로 섞이지 않음.

## 9. 미검증 / 남은 작업

- **비공개 채널**(`futures/order`, `futures/position`, `futures/asset`)은 미구현. 로그인 서명은
  `HmacSHA256(timestamp + "#" + memo + "#" + "bitmart.WebSocket", secret)`으로 REST 서명과 payload가 다릅니다.
  실 사용자 API 키가 필요해 미검증.
- **게이트웨이 인증이 dev 수준.** `?token=user:<id>`를 그대로 신뢰합니다(`GATEWAY_DEV_AUTH`).
  프로덕션은 공유 세션 스토어 검증이 필요합니다. **현재 상태로 외부 노출 불가.**
- `depth`를 `orderbook_snapshot(partial)`로 전달하며 양쪽 조립은 하지 않았습니다. `/trade` 오더북 작업에서 처리.
- `restGapFill`은 시퀀스가 게이트웨이 자체 번호라 시간 범위로 환산할 수 없어, 최근 히스토리 재조회로 구현했습니다.
- 3m 실시간은 구조적으로 불가. REST 폴링이 필요하면 별도 작업.
