# 비트겟 FastApi 통합 — 확정된 사실과 미해결 항목

작성 2026-09-13. 근거는 **비트겟 BD 담당자의 텔레그램 답변**과 공개 문서·실측이다.
텔레그램 대화는 사라지므로 여기에 남긴다.

파트너 링크: `https://partner.bitget.com/bg/U8TP9X` (플랫폼명 `ChartControl AI`)

---

## 1. 확정 — 답변받은 것

### ① 출금 권한은 포함되지 않는다 ✅

> "API Keys issued through Fast API will have all permissions required for the
> client's account, **except withdrawal permissions**."

우리 랜딩의 *"출금 권한 요청 0"* 과 일치한다.

**★★ 그래도 첫 사용 시 검증한다.** 서면 답변이 있어도 코드가 확인해야 한다 —
KuCoin 에서는 문서와 실제 동작이 달라 `40503 isAddressbookOnly mismatch` 를
프로덕션 로그에서 발견했다. 출금 권한이 보이면 **연결을 중단**한다.

### ② 리베이트 — **모든 요청 헤더에 채널 코드를 넣어야 한다** 🔴 정정됨

**★★★ 첫 답변이 틀렸고 BD 가 스스로 정정했다(2026-09-13).**

> 첫 답변: *"the rebate will be calculated automatically"*
> → 헤더 불필요로 이해했다.
>
> 정정: *"you're **API broker**, so plz include channel code on each API
> request header; I'll update the previous answer too to keep the answer
> correct and clear"*

```
X-CHANNEL-API-CODE: <our-channel-api-code>
```

예시 문서: `https://www.bitget.com/docs/catalog/trading/order-management`

★★★ **이것이 KuCoin 과 동일한 실패 지점이다.** KuCoin 에서 브로커 헤더를 빠뜨려
  리베이트가 **0** 이었고, 부팅 로그에 `brokerAttached` 를 찍어서야 알아챘다.
  비트겟도 같은 장치를 둔다 — 헤더가 붙지 않으면 수익이 **0** 이다.

★★ 좋은 소식: **기존 비트겟 계정도 수익이 된다.**

  운영자 질문 "기존 아이디가 있는 사람이 우리 사이트에서 비트겟 아이디로
  거래하는 건 우리 수익이 없냐" 에 대한 답이
  *"for this case, plz add your channel code in the request header"* 였다.
  즉 귀속은 **가입 경로가 아니라 요청 헤더**로 이뤄진다.

  → 이 문서에 앞서 적었던 *"우리 링크로 신규 가입한 고객만 수익"* 은 **틀렸다.**
  → `vipCode` 는 여전히 유용하다(신규 가입 전환율). 그러나 **수익의 전제는
    아니다.** 전제는 `X-CHANNEL-API-CODE` 다.

★ 조회: `/legacy-docs/classic/affiliate/customerInfo/GetDirectCommissions`
  또는 affiliate 대시보드.

### ③ 발급되는 키 종류는 **고객의 계정 모드**를 따른다 ⚠️

> "If the client uses a Unified Trading Account (UTA), a UTA API Key will be
> issued. If the client uses a Classic Account, a Classic API Key will be issued."

**우리가 고를 수 없다.** 고객이 어떤 계정을 쓰는지에 달렸다.
**★★★ 감지 방법이 확정됐다(2026-09-13). 콜백은 모드를 알려주지 않는다.**

틀린 API 를 부르면 **전용 오류 코드**가 온다:

```
40084  "You are in Classic Account mode, and the Unified Account API
        is not supported at this time"        → Classic 키다. v2 를 쓴다.

40085  "You are in Unified Account mode, and the Classic Account API
        is not supported at this time"        → UTA 키다. v3 를 쓴다.
```

★★ 그래서 **UTA(v3)를 먼저 부르고 `40084` 일 때만 Classic(v2)으로 내려간다.**
  그 밖의 오류에서는 **연결을 거부한다** — 모드를 추측해 엉뚱한 API 로 주문을
  보내면 가격·수량 단위가 어긋난다(아래 정밀도 항목).
★ 판정 결과를 자격증명에 저장한다. 매 요청마다 두 번 부르면 지연과 요청 수가
  두 배다.


실측(2026-09-13) — 두 API 모두 살아 있다:

| | 상품 조회 | 비공개 엔드포인트 |
|---|---|---|
| UTA (v3) | `/api/v3/market/instruments` 787종 | `/api/v3/account/settings` → `40037` (경로 존재) |
| Classic (v2) | `/api/v2/mix/market/contracts` 787종 | `/api/v2/mix/account/accounts` → `40037` (경로 존재) |

**★★★ 정밀도 표현이 완전히 다르다 — 여기가 가장 위험하다.**

```
PEPEUSDT 가격 단위
  UTA (v3)     priceMultiplier: "0.0000000001"   ← 문자열, 그대로 쓰면 안전
  Classic (v2) pricePlace: "10" + priceEndStep: "1"  ← 계산해야 한다
```

v2 로 계산하면 `1 / 10^10` = `1e-10` 이고, JS `String(1e-10)` 은 **`'1e-10'`** —
소수점이 없다. **이것이 KuCoin 에서 손절 없는 시장가 주문을 만든 그 버그다**
(감사 항목 ①: `pricePrec=0` → `toFixed(0)` → 손절가 0 → `hasSl` false).

→ **v3 의 `priceMultiplier` 문자열을 그대로 쓴다.** 계산하지 않으면 함정이 없다.
→ v2 를 써야 하면 `pricePlace`/`priceEndStep` 에서 **부동소수 없이** 십진 문자열로
  만든다. 현재 787종 전부 `priceEndStep = 1` 이지만 그 필드가 존재한다는 것은
  언젠가 5 가 될 수 있다는 뜻이다(tick 0.5). KuCoin 에서 `log10` 방식을 버린 이유다.

**Classic 상장폐지는 우리 범위가 아니다.** 2026-09-17 폐지 대상은 **코인마진(USD)**
9종(BTCUSD 등)이고, 우리가 쓰는 **USDT 무기한물은 해당 없다.** 다만 UTA 가
플랫폼의 장기 방향이라는 것은 사실이다.

### ④ 재인증 · 키 수명 · 권한 — 2026-09-13 확인

**재인증** → *"no new api key issued, it will use the old one"*

★ 새 키가 발급되지 않으니 **이전 키가 죽는 문제가 없다.** 그러나 반대로
  **재인증으로 문제를 해결할 수도 없다** — 키가 잘못됐으면 고객이 비트겟에서
  지우고 다시 만들어야 한다.

**키 수명** → *"apikey will not expire until the user delete it"* — 갱신 흐름 불필요.

**권한 취소 통보** → *"we'll **not** notify callback URL actively, you'll only
find out when a request fails"* ⚠️

★★★ 그래서 **요청 실패를 반드시 상태로 반영해야 한다.** 고객이 비트겟에서
  권한을 지웠는데 우리 화면이 계속 "연결됨" 을 보여주면, 고객은 주문이 나갈
  것이라 믿고 기다린다. 인증 오류를 받으면 자격증명을 `FAILED` 로 내리고
  화면에 다시 연결하라고 말해야 한다.
★ KuCoin 도 같은 문제를 갖고 있다. 이 처리는 공통으로 만든다.

**USDT 무기한물 거래 권한** → *"yes, fastapi issued apikey has the permissions
to trade usdt-margined perpetual symbols"* ✅ 우리 범위와 일치한다.

### ⑤ 데모 거래는 없다 ⚠️

> "there is no demo trading for fastapi, we recommend using a real account to
> test the authorization flow end to end."

검증에 **실계정**이 필요하다. 다만 단계를 나눌 수 있다:

- 인증 흐름 + 키 수신 + 읽기 전용 조회 → **잔고 0 인 실계정으로 가능**
- 주문 제출 → 소액(10~20 USDT) 필요

---

## 2. 미해결 — 막혀 있는 것

### ⑥ 서버 IP — **강제된다. 고정 IP 없이는 불가** 🔴 확정

> (2026-09-14) *"The IP address bound to a FastAPI key applies to **every API key
> generated under it** — **all requests using that API key must originate from the
> bound IP address**."*

★★★ **권고가 아니라 강제다.** 바인딩된 IP 밖에서 온 요청은 거부된다. 그리고 그
  바인딩은 **FastApi 로 발급되는 모든 고객 키에 적용**된다 — 즉 고객 한 명이 아니라
  전체가 막힌다.

우리 출구 IP는 **공유 대역 512개**다(실측):
```
type: shared
74.220.52.0/24
74.220.60.0/24   (Render, Singapore)
```

등록할 수 없다. 세 가지 선택지가 있다.

| 방법 | 월 비용 | 고정 IP | 주문 경로에 추가되는 것 |
|---|---|---|---|
| Render 전용 IP | **약 13만원** ($100) | 3개 | 없음 |
| **자체 VPS 프록시 2대** | **약 1.1만원** | 2개 | 프록시 1홉(우리 소유) |
| 상용 프록시(QuotaGuard 등) | 약 3~7만원 | 1~2개 | 프록시 1홉(제3자) |

★★ **기술적으로 가능함을 확인했다.** `KucoinPrivateRest` 처럼 어댑터가 `fetchImpl` 을
  주입받는 구조이므로, **비트겟 요청만** 프록시를 태우고 KuCoin 은 직접 보낼 수 있다.
  전역 프록시(`NODE_USE_ENV_PROXY`)를 쓰면 **잘 돌고 있는 KuCoin 경로에도 실패 지점을
  추가**하므로 그렇게 하지 않는다.
  · `undici` 의 `ProxyAgent` 를 `dispatcher` 로 넘긴다(Node 24 내장 fetch 가 받는다).
  · `undici` 는 Node 자신의 HTTP 클라이언트다. 새 의존성이지만 무명 패키지가 아니다.

★★★ **주문 경로에 홉이 하나 늘어난다는 사실을 숨기지 않는다.** 프록시가 죽으면
  비트겟 주문이 실패하고, 그 실패는 고객 돈이 걸린 순간에 일어난다. 그래서:
  · VPS **2대**를 두고 IP 두 개를 모두 등록한다(비트겟이 복수 IP 를 받는다)
  · 프록시 실패를 **조용히 넘기지 않는다** — 주문이 실패하면 이유를 그대로 말한다
  · KuCoin 은 프록시를 타지 않으므로 VPS 가 죽어도 영향이 없다

★ 무료 등급(Oracle Always Free 등)은 **쓰지 않는다.** 고객 돈이 걸린 주문 경로에
  "언제 끊길지 모르는 것" 을 넣는 것은 월 5천원을 아낄 자리가 아니다.

※ 판단: 비트겟이 실제로 수익을 낼지 아직 모른다(KuCoin 실주문 누적 12건). 그래서
  **13만원이 아니라 1.1만원**부터 시작한다. 거래량이 늘어 프록시가 병목이 되면
  그때 Render 전용 IP 로 옮긴다 — 그 전환은 프록시 설정만 끄면 된다.

### ⑦ `clientId` · `vipCode` · 채널 코드 — Broker Ops 확인 중

BD 담당자가 `@Bitget_Broker_Ops` 에 요청했다. 둘 다 없으면 시작할 수 없다:
- `clientId` — OAuth URL 과 서명에 들어간다
- `vipCode` / `channelCode` — **없으면 리베이트가 0 이다**(위 ② 참조)

---

## 3. 우리가 준비한 것

- **RSA 2048 키쌍 생성 완료.** 개인키는 Render 환경변수
  `BITGET_OAUTH_RSA_PRIVATE_KEY` (PKCS8 base64). 저장소에 없다.
- 문서 방식대로 왕복 검증했다:
  - 서명 `MD5withRSA`, 정렬된 `key+value` 이어붙이기 → 검증 통과
  - `data` 복호 `RSA/PKCS1v1.5` (Java `Cipher.getInstance("RSA")` 와 동일) → 통과
  - **★ Node 기본 패딩은 OAEP 다.** 명시적으로 `RSA_PKCS1_PADDING` 을 지정해야 한다.
    지정하지 않으면 조용히 복호가 실패한다.
- **★★ 비트겟 문서의 예시 키는 쓰지 않았다.** 문서에 **개인키 전문**이 실려 있다 —
  공개 문서에 실린 키는 전 세계가 가진 키다. 담당자에게 알렸고, 답변은 공개키가
  예시용이라는 것이었다(실제 위험은 개인키 쪽이다).
- `MD5withRSA` 는 약한 알고리즘이다. 비트겟이 그것으로 검증하므로 우리가 바꿀 수 없다.
- OAuth 라우트는 **만들어 두었다**(`apps/api/src/bitget-oauth-routes.ts`, 시험 18건).
  `BITGET_OAUTH_CLIENT_ID` 가 없으면 라우터가 등록되지 않는다 — 지금 배포돼 있어도
  아무 영향이 없다.
- 아직 없는 환경변수: `BITGET_OAUTH_CLIENT_ID`, `BITGET_OAUTH_REDIRECT_URI`,
  `BITGET_OAUTH_VIP_CODE`, 그리고 **채널 코드**(어댑터 작업 때 추가한다).

---

## 4. 구현 시 반드시 지킬 것

### 콜백 엔드포인트 — 가장 위험한 지점

비트겟이 **서버 대 서버**로 POST 하므로 세션 쿠키가 없다. **서명 검증이 유일한 인증**이다.
실수하면 아무나 남의 계정에 API 키를 심을 수 있다.

FastApi 문서가 요구하는 것:
1. `sign` 을 개인키로 복호해 `serialNo` 와 일치 확인
2. `timestamp` 가 현재와 5분 이내
3. `serialNo` 를 `clientUserId` 에 묶고 **다른 계정에 재사용 금지**
4. `serialNo` 만료 (권장 10분)
5. 응답은 `{"code":"00000","msg":"success","requestTime":"..."}`

### 계정 모드 감지 — 코드가 확정됐다

```
UTA(v3) 호출
  성공        → UTA 키. v3 로 고정하고 자격증명에 기록한다.
  code 40084  → Classic 키. v2 로 내려간다.
  그 밖        → **연결 거부.** 모드를 모르는 상태다.
```

★★ `40085`("UTA 모드인데 Classic API")는 우리가 v2 를 먼저 부를 때 온다. 우리는
  v3 를 먼저 부르므로 정상 흐름에서는 나오지 않는다. 나오면 순서가 뒤바뀐 것이니
  **버그로 취급**한다.
★★★ 알 수 없는 오류에서 **추측하지 않는다.** 틀린 API 로 주문을 보내면 가격·수량
  단위가 어긋나고, 그것이 KuCoin 에서 손절 없는 주문으로 이어진 실패다.

### 리베이트 헤더 — 붙지 않으면 수익이 0 이다

★★★ **모든** 비트겟 요청에 `X-CHANNEL-API-CODE` 를 넣는다. 조회든 주문이든 예외 없다.

★★ 헤더를 **한 곳에서만** 붙인다. 요청마다 손으로 넣으면 새 엔드포인트를 추가할 때
  빠뜨리고, 빠진 그 경로의 거래량은 영구히 우리 실적이 아니다. KuCoin 어댑터가
  이미 이 구조다(`brokerAttached`).
★ 부팅 로그에 채널 코드 유무를 찍는다. KuCoin 에서 리베이트 0 을 로그로 알아챈
  전례가 있다.

### 인증 실패 → 자격증명 상태

★★ 비트겟은 권한 취소를 **알려주지 않는다.** 인증 오류를 받으면 자격증명을
  `FAILED` 로 내리고 화면이 다시 연결하라고 말해야 한다. 그러지 않으면 화면은
  "연결됨" 인데 주문이 나가지 않는 상태가 유지된다.

### 단계

1. **읽기 전용** — 잔고·포지션·미체결. 돈 위험 0. 이 단계에서 tickSize 를 실제 응답으로 검증
2. **주문** — `bitget_live_trading_enabled = false` 로 시작. 운영자가 1 USDT 실주문을
   확인한 뒤 ARMED (BitMart 플래그가 이미 이 구조다)
3. **리베이트 확인** — affiliate 대시보드에서 실제로 붙는지

---

## 5. 무관한 기존 실패 (기록)

`PG_TEST_URL` 을 켜고 전체 시험을 돌리면 **1건이 실패한다.**

```
× 보관기간 파기 — 실제 Postgres > 오래된 행만 지운다 — 최근 행은 남긴다
  → audit_logs 에서 최근 행이 사라졌거나 옛 행이 남았다:
    expected [ '1.1.1.1', '2.2.2.2' ] to deeply equal [ … ]
```

**비트겟 작업과 무관하다.** 변경분을 `git stash` 로 치우고 돌려도 같이 실패한다(확인).

★★ 왜 아무도 몰랐나 — 이 시험은 `PG_TEST_URL` 없이는 **건너뛴다.** 평소 게이트
  (`pnpm -r test`)에서는 200건 이상이 skip 되고 여기도 그중 하나다. 즉 **한 번도
  돌지 않은 시험**이고, 그래서 깨진 것을 아무도 보지 못했다.

★ 별도로 봐야 한다. 보관기간 파기는 개인정보 관련이므로 조용히 둘 문제가 아니다.
