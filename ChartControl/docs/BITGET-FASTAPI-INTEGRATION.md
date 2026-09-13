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

### ② 리베이트는 자동이다 — 요청 헤더가 필요 없다 ✅

> "users registered through your referral code, the rebate will be calculated
> automatically based on these users' trading volume"

KuCoin 보다 단순하다(KuCoin 은 브로커 헤더를 빠뜨리면 리베이트가 0 이었다).

**★★★ 그러나 결정적인 조건이 있다 — "registered through your referral code".**

  이미 비트겟 계정이 있는 고객이 우리 앱에서 그 계정을 연결하면 **리베이트가 없다.**
  즉 우리 수익은 "우리 링크로 **신규 가입**한 고객" 에서만 나온다.

  → 그래서 OAuth URL 에 `vipCode` 를 붙이는 것이 **선택이 아니라 수익의 전제**다
    (FastApi 문서 "Supplementary Information" 항목). 가입 화면에 추천 코드가
    자동 입력되게 만들어야 한다.
  → 화면 문구도 이 사실에 맞아야 한다. "기존 계정도 연결 가능" 은 사실이지만
    그 경우 우리 수익이 0 이라는 것을 **우리가 알고 설계**해야 한다.

조회 API: `/legacy-docs/classic/affiliate/customerInfo/GetDirectCommissions`
또는 affiliate 대시보드.

### ③ 발급되는 키 종류는 **고객의 계정 모드**를 따른다 ⚠️

> "If the client uses a Unified Trading Account (UTA), a UTA API Key will be
> issued. If the client uses a Classic Account, a Classic API Key will be issued."

**우리가 고를 수 없다.** 고객이 어떤 계정을 쓰는지에 달렸다.

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

### ④ 데모 거래는 없다 ⚠️

> "there is no demo trading for fastapi, we recommend using a real account to
> test the authorization flow end to end."

검증에 **실계정**이 필요하다. 다만 단계를 나눌 수 있다:

- 인증 흐름 + 키 수신 + 읽기 전용 조회 → **잔고 0 인 실계정으로 가능**
- 주문 제출 → 소액(10~20 USDT) 필요

---

## 2. 미해결 — 막혀 있는 것

### ⑤ 서버 IP — CIDR 불가 🔴

> "sorry, fastapi doesn't support CIDR ranges; it supports multi IPs, we will
> double check the maximum number allowed with dev team"

우리 출구 IP는 **공유 대역 512개**다(실측):
```
type: shared
74.220.52.0/24
74.220.60.0/24   (Render, Singapore)
```

**등록할 수 없다.** 최대 개수 답변을 기다리는 중이며, 답에 따라 비용 결정이 필요하다:

| 방법 | 비용 | 고정 IP 수 |
|---|---|---|
| Render 전용 IP | $100/월 + Pro 워크스페이스 | 3개 |
| 프록시(QuotaGuard·Fixie 등) | 월 2~5만원대 | 1~2개 |

허용 개수가 3 이상이면 Render 전용 IP 로 끝난다. 1~2개면 프록시가 싸다.

### ⑥ `clientId` · `vipCode` — Broker Ops 로 넘어감

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

### 계정 모드 감지 — 실패를 결론으로 바꾸지 않는다

UTA 엔드포인트를 먼저 부르고, **특정한** 오류일 때만 Classic 으로 내려간다.
알 수 없는 오류면 **연결을 거부**한다 — 추측해서 잘못된 API 로 주문을 보내면
수량·가격 단위가 어긋난다.

### 단계

1. **읽기 전용** — 잔고·포지션·미체결. 돈 위험 0. 이 단계에서 tickSize 를 실제 응답으로 검증
2. **주문** — `bitget_live_trading_enabled = false` 로 시작. 운영자가 1 USDT 실주문을
   확인한 뒤 ARMED (BitMart 플래그가 이미 이 구조다)
3. **리베이트 확인** — affiliate 대시보드에서 실제로 붙는지
