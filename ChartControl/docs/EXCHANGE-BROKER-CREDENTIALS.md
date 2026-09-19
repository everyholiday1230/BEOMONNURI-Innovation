# 거래소 브로커 자격 — 무엇을 받고, 무엇을 우리가 만드나

여러 거래소와 협약할 때 매번 같은 질문이 나온다:
**"거래소가 준 것으로 다 되는 거야?"** — 아니다. 자격은 **세 종류**이고 출처가 다르다.

이 문서에 **비밀값은 적지 않는다.** 환경변수 이름과 출처만 적는다.

---

## 0. 세 종류를 구분하라

| 종류 | 무엇에 쓰나 | 누가 만드나 |
|---|---|---|
| ① **브로커 태그** | 주문에 서명을 붙여 **수익을 귀속**시킨다 | 거래소가 **메일로 준다** |
| ② **운영자 API 키** | 우리가 얼마 벌었는지 **조회**한다 | **우리가 직접 만든다** |
| ③ **OAuth 클라이언트** | 고객이 키를 직접 붙여넣지 않고 **연결**하게 한다 | 거래소가 **메일로 준다** |

★★★ **거래소는 ②를 주지 않는다.** ①과 ③만 메일로 온다. ②는 브로커 계정에
로그인해 API 관리 화면에서 우리가 발급해야 한다. 이것을 모르면 "거래소가 준
걸로 다 넣었는데 수익이 안 보인다" 에서 막힌다 — 실제로 막혔다(2026-09-19).

★★ ①과 ②는 **다른 실패 방식**을 가진다:
- ①이 없거나 틀리면 → **거래는 되고 수익만 0.** 조용하다. 정산일에야 안다
- ②가 없거나 죽으면 → **수익은 정상 적립되고 조회만 안 된다.** 거래는 무관하다

혼동하면 엉뚱한 곳을 고친다. 실제로 ②가 죽은 것을 ①의 문제로 의심하며
시간을 썼다.

---

## 1. KuCoin

### ① 브로커 태그 — 거래소가 준다 ✔ 설정됨

현물과 선물이 **태그가 다르다.** 실적도 따로 집계된다.

| 환경변수 | 값의 성격 |
|---|---|
| `KUCOIN_BROKER_SPOT_PARTNER` / `_KEY` / `_NAME` | 현물 태그 (짧은 코드 + UUID + 코드) |
| `KUCOIN_BROKER_PARTNER` / `KUCOIN_BROKER_KEY` / `KUCOIN_BROKER_NAME` | 선물 태그 |

★ `partner` 와 `name` 이 같은 값일 수 있다. 정상이다.
★ `key` 는 UUID 형태이며 **파트너 서명의 HMAC 키**다. API 키가 아니다 —
  이것으로는 아무 조회도 못 한다.

동작 확인: 주문 감사기록의 `brokerAttached`, 그리고 브로커 대시보드의
`Total Trading Volume`.

★★ `KC-API-PARTNER-VERIFY: true` 를 **반드시 보낸다.** 공식 문서:
> When the KC-API-PARTNER-VERIFY request header is not added, the
> KC-API-PARTNER-SIGN request header fails to be signed, but the KC-API-SIGN
> signature is successful and **the order can be placed successfully without
> carry broker info.**

즉 이 헤더가 없으면 **서명이 틀려도 주문이 성공하고 수익만 사라진다.**
켜 두면 `400201` 로 즉시 거절되어 알 수 있다.

### ② 운영자 API 키 — 우리가 만든다

| 환경변수 |
|---|
| `KUCOIN_API_KEY` |
| `KUCOIN_API_SECRET` |
| `KUCOIN_API_PASSPHRASE` |

만드는 곳: **브로커 계정으로** kucoin.com 로그인 → API 관리 → API 키 생성.

- 권한은 **General(읽기 전용)** 로 충분하다.
  공식 문서의 `queryMyCommission` 항목에 `api-permission: General` 로 적혀 있다.
  거래·출금 권한은 주지 않는다 — 이 키는 보고서만 읽는다.
- **반드시 브로커 계정에서 만든다.** 다른 계정의 키로는 우리 실적이 안 보인다.
- ★★★ **IP 화이트리스트를 걸지 않는다.** Render 는 고정 IP 가 아니다.
  걸어야 한다면 먼저 전용 IP 를 확보해야 한다(미구매).

동작 확인: 부팅 로그
```
[api] kucoin operator credential: VERIFIED (revenue can be read)
[api] ★ kucoin operator credential FAILED: <code> ... (실패 시)
```

★ `400003 The API key does not exist or site mismatch` 는 **서명이 틀려도
  나온다.** "키가 없다" 의 증거가 아니다 — KuCoin 의 포괄적 인증 실패 코드다.

### ③ OAuth 클라이언트 — 거래소가 준다 ✔ 설정됨

| 환경변수 | 비고 |
|---|---|
| `KUCOIN_OAUTH_CLIENT_ID` | 현물 태그와 같은 값일 수 있다 |
| `KUCOIN_OAUTH_CLIENT_SECRET` | |
| `KUCOIN_OAUTH_REDIRECT_URI` | 거래소에 **등록한 값과 정확히 일치**해야 한다 |
| `KUCOIN_OAUTH_GROUPS` | ★ `API_WITHDRAW_OAUTH` 는 **false** — 출금 권한을 받지 않는다 |

### 조회 경로 (실측 2026-08-10)

브로커 종류에 따라 **도메인이 갈린다.** 바꾸면 전부 404 다.

| 경로 | `api.kucoin.com` | `api-broker.kucoin.com` |
|---|---|---|
| `/api/v2/broker/queryMyCommission` | 있음 | 404 |
| `/api/v2/broker/queryUser` | 있음 | 404 |
| `/api/v1/broker/nd/info` | 404 | 있음 |

우리는 고객이 **자기 키로** 거래하는 형태이므로 **Broker Pro**(`api.kucoin.com`)다.

★ 조회할 때 `siteType=all` 을 보낸다. 실적이 `global` 이 아닌 사이트
  (예: `europe`)에 기록될 수 있고, 안 보내면 그것이 빠진다.

---

## 2. Bitget

### ① 브로커 태그 — 거래소가 준다 ★ 미설정

| 환경변수 | 상태 |
|---|---|
| `BITGET_CHANNEL_CODE` | **없음 → 거래해도 수익 0** |

헤더 `X-CHANNEL-API-CODE` 로 귀속된다. 값만 넣으면 즉시 동작한다.

★★ 비트겟 BD 확인: **기존 계정도 수익이 된다.** 귀속은 가입 경로가 아니라
  **요청 헤더**로 이뤄진다. 추천코드(`vipCode`)는 전환율에는 유용하지만
  수익의 전제가 아니다.

동작 확인: 부팅 로그 `bitget adapters (rebate header OFF — ★ NO REBATE ...)`

### ② 운영자 API 키

미설정. 조회 경로는
`/legacy-docs/classic/affiliate/customerInfo/GetDirectCommissions` 또는
affiliate 대시보드.

### ③ OAuth 클라이언트 — 거래소에서 받아야 함

`BITGET_OAUTH_CLIENT_ID` + redirect URI 미설정 → FastApi OAuth 라우터 비활성.

---

## 3. 새 거래소를 붙일 때 확인 목록

1. **①태그를 모든 REST 요청에 붙이는가.** 일부만 붙이면 그 거래는 귀속되지 않는다
2. **서명 오류를 시끄럽게 만드는 장치가 있는가.** KuCoin 의 `PARTNER-VERIFY` 처럼.
   없으면 수익 누락을 정산일에야 안다
3. **거래소가 모르는 필드를 무시하는가.** Bitget 은 **조용히 무시한다** —
   손절 필드 이름을 틀려도 주문은 성공하고 손절만 없다. 되읽어 검증해야 한다
4. **②운영자 키가 실제로 되는지 부팅 때 물어보는가.** 존재 확인은 확인이 아니다
5. **현물·선물 태그가 갈리는가.** KuCoin 은 갈린다
6. **귀속 결과를 거래소에 되물을 수 있는가.** 우리 쪽 플래그(`brokerAttached`)는
   "헤더를 넣었다" 는 **주장**일 뿐이다. 심판은 거래소다

★★★ 6번이 이 문서의 핵심이다. 우리 로그의 `true` 를 확인으로 착각하면
  수익이 0 인 채로 몇 주가 지난다.
