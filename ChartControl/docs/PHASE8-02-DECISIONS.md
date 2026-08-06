# PHASE 8 · 02 — 확정된 사업/기술 결정

**작성일**: 2026-08-02
**출처**: 사용자(운영 주체) 결정 + BitMart 공식 문서 확인

이 문서는 `PHASE8-01-GAP-ANALYSIS.md`가 남겨둔 블로커에 대한 답을 기록한다. 여기서 확정된 내용은
갭 분석의 일부 항목을 무효화하므로, 두 문서를 함께 읽어야 한다.

---

## 1. 사업 모델 — BitMart API 브로커 (non-custodial)

운영 주체는 **BitMart API Broker**다. Broker ID: `BEOMONNURI12345`, 티어: **Standard (40%)**.

BitMart 공식 문서(`developer-pro.bitmart.com/en/broker/` · Access Process)에서 확인한 흐름:

| 단계 | 내용 |
|---|---|
| 1 | 브로커가 심사 통과 → BitMart가 BrokerID 발급, 리베이트 비율/기간 파라미터 설정. 리베이트는 브로커의 **BitMart 스팟 지갑**으로 입금 |
| 2 | **사용자가 본인 BitMart 계정 등록 + 최소 개인 LV1 KYC 통과.** spot trading + read-only 권한 API Key 생성 |
| 3 | 사용자가 그 API Key를 우리 플랫폼에 바인딩 |
| 4 | **우리가 사용자 대신 주문 전송 시 `사용자 APIKey + BrokerID`를 함께 전송** |
| 5 | 체결 시 BitMart가 수수료를 분할해 우리 스팟 지갑에 리베이트 |
| 6 | 우리는 전용 API로 리베이트 명세 조회 |

### 결과: 커스터디 = non-custodial

- 사용자 자금은 **사용자 본인의 거래소 계정**에 있다.
- **KYC는 거래소가 수행**한다 (BitMart LV1 이상).
- 우리는 자금을 보관하지 않는다.

### 갭 분석 무효화 항목

| 항목 | 원래 설계 | 확정 후 |
|---|---|---|
| G2 KYC | 벤더(Onfido/Jumio/Sumsub) 연동 + 심사 큐 | ❌ **불필요** — 거래소가 수행 |
| G3 입금 | "자산을 QuantumTrade AI 지갑으로 입금" | ❌ **불필요** |
| G4 출금 | 우리 지갑 → 외부 출금 + 승인 큐 | ❌ **불필요** |
| G5 트랜잭션 원장 | 우리 원장의 입출금 기록 | ⚠️ **성격 변경** — 거래소 잔고·체결·수수료·리베이트 조회로 |
| G11 Hot/Cold 자산 | Hot $4.2M / Cold $28.4M / Reserve Ratio 112% | ❌ **불필요** — 보관 자산이 없어 준비금 개념이 성립하지 않음 |

디자이너는 커스터디형 거래소를 전제로 그렸다. 해당 페이지들은 브로커 모델에 맞게 재설계하거나
제거해야 한다. **구현하기 전에 재설계 필요.**

### 소멸한 블로커

- KYC 벤더 선정 → 불필요
- 커스터디 방식 선정 → 불필요
- 운영자 BitMart 키 + AWS Secrets Manager → 불필요 (사용자가 본인 키 입력)

---

## 2. Broker ID 연동

### (a) 주문 요청 헤더 — ✅ 구현 완료 (2026-08-02)

| 파일 | 변경 |
|---|---|
| `packages/config/src/index.ts` | `BITMART_BROKER_ID = 'BEOMONNURI12345'` 상수 (ADR-0002: 상수는 config에만) |
| `packages/exchange-bitmart/src/signature.ts` | `BROKER_ID_HEADER`, `withBrokerId()`, `buildSignedHeaders()`·`buildKeyedHeaders()`에 optional `brokerId` |
| `packages/exchange-bitmart/src/futures-rest-adapter.ts` | `BitMartFuturesConfig.brokerId` → signed GET/POST 양쪽에 전달 |
| `apps/api/src/env.ts` | `bitmartBrokerId` (`BITMART_BROKER_ID` 환경변수, 빈 문자열이면 상수로 폴백) |
| `apps/api/src/index.ts` | 어댑터 생성 시 `brokerId: env.bitmartBrokerId` |
| `apps/api/src/trading/stage-a-probe.ts` | 검증 경로와 프로덕션 경로가 갈라지지 않도록 동일 헤더 세트 사용 |
| `.env.example` | `BITMART_BROKER_ID=` (문서 주석 포함) |
| `packages/exchange-bitmart/src/__tests__/broker-id.test.ts` | 15 tests |

**서명 계산식은 변경되지 않았다.** 공식 문서와 제공된 Java 샘플 양쪽에서 확인:

```
X-BM-SIGN = HMAC_SHA256(secretKey, `${timestamp}#${memo}#${queryString}`)
```

테스트 `BRK-02[2]`가 broker ID 유무에 따른 서명이 **byte 동일**함을 고정한다. broker ID가 서명
payload로 새어 들어가면 모든 인증 호출이 `30005 Header X-BM-SIGN is wrong`으로 실패하므로 이
불변식을 테스트로 잠갔다.

**빈 값 처리**: BitMart 샘플은 `"X-BM-BROKER-ID", ""`를 보내지만 이것은 통합자가 채워야 할
빈칸이다. 빈 값은 아무것도 귀속시키지 않으므로 전송하지 않고 **헤더 자체를 생략**한다. 설정
누락이 설정된 것처럼 보이지 않게 하기 위한 것이다.

**환경변수 폴백**: `env.BITMART_BROKER_ID?.trim() || BITMART_BROKER_ID` — `??`가 아니라 `||`다.
빈 문자열은 "브로커 없음"이라는 의도가 아니라 설정 실수이며, 귀속 손실은 에러를 내지 않으므로
조용한 매출 손실이 된다. 따라서 상수로 폴백한다.

#### 검증 (실제 실행)

- `pnpm --filter @quantumtrade/exchange-bitmart exec vitest run src/__tests__/broker-id.test.ts`
  → **15 passed**, exit 0
- 전체 회귀: typecheck exit 0 (TS errors 0) · test exit 0 (**1,038 passed / 39 skipped**;
  exchange-bitmart 31→46) · build exit 0 · lint exit 0
- **소켓 레벨 확인**: 로컬 http 서버를 띄워 어댑터로 요청한 뒤 수신 헤더를 확인.
  `fetch` 스파이가 아니라 실제 전송을 검증했다.

  ```
  x-bm-key         = ak
  x-bm-sign        = d77897060aee2c5b... (len=64)
  x-bm-timestamp   = 1785713960302
  x-bm-broker-id   = BEOMONNURI12345
  ```

#### 미검증

실제 BitMart 서버가 이 헤더를 받아 리베이트를 귀속시키는지는 **확인 불가**하다. 실 API 키와
체결이 필요하다. 우리가 보증할 수 있는 것은 "문서가 요구하는 헤더를 문서가 요구하는 형식으로
전송한다"까지다.

### (b) 리베이트 조회 API — ✅ 구현 완료 (2026-08-02)

```
GET https://api-cloud.bitmart.com/spot/v1/broker/rebate?start_time=&end_time=
인증: KEYED (X-BM-KEY만; 서명 불필요)
파라미터 미지정 시 최근 180일
응답: { code:1000, data: { rebates: { "2022-10-22": [{ currency, rebate_amount }] } } }
```

| 파일 | 역할 |
|---|---|
| `packages/exchange-bitmart/src/broker-rebate.ts` | 클라이언트 + 파서 + 합계 |
| `apps/api/src/trading/broker-rebate-source.ts` | 운영자 자격증명 해석. 미설정 시 `undefined` |
| `apps/api/src/admin/admin-routes.ts` | `GET /admin/broker/rebates` |
| `packages/admin-domain/src/permissions.ts` | 권한 `admin.broker.rebate.read` (ADMIN·SUPER_ADMIN만) |
| `packages/admin-schemas/src/index.ts` | `BrokerRebateQuerySchema` (`from`/`to` 초, `.strict()`) |
| 테스트 | `broker-rebate.test.ts` 21 + `broker-rebate-api.test.ts` 21 = **42 tests** |

#### 중요한 정정 — 이것은 사용자 페이백의 데이터 소스가 아니다

앞서 이 API를 `/fees`·`/referral`의 소스로 기재했으나 **부정확했다.** BitMart 응답은
**일자별·통화별 합계**이며 사용자나 주문 차원이 없다. 따라서:

- 이 API = **우리 회사 수익** (관리자 화면)
- 사용자 개인 페이백 = **우리가 중계한 체결 기록으로 직접 계산** (별도 작업)

응답에 `scope: 'operator'`, `perUserAttributionAvailable: false`를 명시해 클라이언트가 사용자
데이터로 오해할 수 없게 했고, 테스트 `RBA-02[2]`가 이를 고정한다.

#### 운영자 API 키가 필요하다 (앞선 판단 정정)

리베이트는 우리 수익이므로 조회에 **운영자 본인의 BitMart API 키**가 필요하다. "브로커 모델에서
운영자 키 불필요"라는 앞선 결론은 **거래 경로에 한해** 맞고, 리베이트 정산 조회에는 읽기 전용
운영자 키가 필요하다. Stage A probe와 동일한 fail-closed 경로(`resolveCredentialProvider` →
프로덕션 AWS Secrets Manager, 개발 env)를 재사용한다.

자격증명은 **요청마다 로드하고 캐시하지 않는다.** 드문 관리자 작업이므로 운영자 시크릿을 프로세스
메모리에 상주시킬 이유가 없다.

#### 설계 결정

1. **미설정 ≠ 수익 0.** 운영자 키가 없으면 `503 NOT_CONFIGURED` + `configured: false`이고
   `records` 필드를 넣지 않는다. 빈 배열은 "못 벌었다"로 읽힌다.
2. **선물은 throw, 빈 배열 아님.** `getFuturesRebates()`는 미구현이며 호출 시 throw한다.
3. **HTTP 200 + code≠1000은 에러다.** BitMart는 앱 오류를 200으로 보낸다
   (`53005` = 키에 브로커 인터페이스 권한 없음). status만 보면 통과해버린다.
4. **금액은 십진 문자열 + BigInt 합산.** `10.238 + 21.9895`는 부동소수점에서
   `32.227499999999996`. 테스트 `RBT-02[1]`이 `32.2275`를 고정한다.
5. **법정통화 총액을 만들지 않는다.** 환율이 없으므로 지어낸 총액은 총액 없음보다 나쁘다.
6. **파싱 불가 행은 버린다.** 0으로 변환하지 않는다. 버려진 행은 BitMart 명세서와의 차액으로
   드러나지만 조용한 0은 드러나지 않는다.
7. **권한 분리.** `admin.broker.rebate.read`를 READ_ONLY 묶음에 넣지 않았다. SUPPORT·ANALYST는
   운영 상태를 보는 역할이며 회사 매출을 볼 업무상 이유가 없다.

#### 시간 단위 불확실성

BitMart 문서는 `start_time`/`end_time`을 `long`으로만 기술하고 단위를 명시하지 않는다. curl 예시의
`end_time=1683367993`은 10자리(초)이지만 같은 예시의 `start_time=16833656781`은 11자리로 어느
단위로도 타당한 날짜가 아니어서 문서 오타로 보인다. **초 단위로 구현**했고 변환은
`getSpotRebates()` 한 곳에서만 일어난다.

#### 검증 (실제 실행)

- `broker-rebate.test.ts` → **21 passed**
- `broker-rebate-api.test.ts` → **21 passed** (실 SQLite + 실 AuthService + 실 라우터, RBAC 전 역할)
- 전체 회귀: typecheck exit 0 (TS errors 0) · test exit 0 (**1,080 passed / 39 skipped**;
  exchange-bitmart 46→67, apps/api 534→555) · build exit 0 · lint exit 0
- 실서버 기동(`API_PORT=8801`):
  - 부팅 로그 `[api] broker rebate reader: not configured (no operator BitMart credential)`
  - `GET /api/admin/broker/rebates` 미인증 → `401 UNAUTHENTICATED`

작업 중 typecheck 오류 1건: `vi.fn(async () => ...)`이 인자 없는 튜플로 추론되어
`mock.calls[0][0]` 인덱싱 실패. 목에 파라미터 타입 명시로 해결.

#### 미검증

실제 BitMart 서버 응답으로는 확인하지 못했다. 운영자 BitMart API 키(브로커 계정)가 필요하다.
검증된 범위는 "문서에 기재된 URL·인증·파라미터로 요청하고 문서에 기재된 응답 형식을 파싱한다"까지다.


### (c) 사용자 API 키 권한

브로커 프로그램 요구사항은 **spot trading + read-only**. 기존 구현
(`apps/api/src/exchanges/exchange-catalog.ts`의 `requiredPermissions: ['Read','Trade']`,
`forbiddenPermissions: ['Withdraw']`)과 일치하므로 변경 불필요.

---

## 3. 미해결 리스크

### 🔴 선물(USD-M Futures) 리베이트 대상 여부 — 미확인

사용자는 "될 것"으로 예상하지만 **BitMart 확인은 받지 못했다.** 공식 브로커 문서에는:

- 리베이트 조회 엔드포인트가 `/spot/v1/broker/rebate` **하나뿐**
- Access Process 2단계가 "API Key with **spot trading** privileges"로 기술
- 문서 섹션 제목이 "Spot Endpoints"

우리 서비스는 파생상품 중심(`packages/exchange-bitmart/src/futures-rest-adapter.ts`)이므로 선물이
리베이트 대상이 아니면 수익 모델의 대부분이 사라진다.

**조치**: BitMart 담당자(`partner@bitmart.com` / Telegram `@BM_Institution`)에게 서면 확인.
그때까지 구현은 이 가정에 의존하지 않도록 spot/futures 리베이트를 **분리 집계**한다.

### 🟡 referral 링크 ↔ broker 리베이트 상호 배타

BitMart 문서 5단계 원문:

> "It is necessary to determine whether the user who placed the order has an inviter or not.
> **If there is an affiliate rebate, then no refund will be given to the API broker.**"

즉 사용자가 우리 referral 링크로 가입하면 affiliate 리베이트가 적용되고 **broker 리베이트
(40%)를 받지 못한다.** 둘을 동시에 받을 수 없다.

**현재 결정**: referral 링크는 **그대로 유지**. BitMart 담당자 확인 후 재검토.
나머지 7개 거래소는 브로커 계약이 없으므로 referral 링크가 유일한 수익 경로이며 영향 없다.

### 🟢 stage-a-probe 테스트 1건 skip 유지

`apps/api/src/__tests__/stage-a-probe.test.ts:46` — 운영자 키를 AWS Secrets Manager에서 읽는
라이브 검증. 브로커 모델에서 운영자 키가 불필요하므로 **의도적 skip 유지**.

---

## 4. 프론트엔드 — 옵션 B 확정

기존 백엔드(`apps/api` 등)를 그대로 쓰고, 프론트엔드만 2026-08-02 핸드오프(42라우트)로 신규 구축.

새 앱: **`apps/broker-web`** (dev 포트 5174, `apps/web`의 5173과 병행 가능)

기존 `apps/web`(15라우트)은 삭제하지 않는다. 인증·차트·레이아웃 엔진의 API 연동이 이미 동작하는
참조 구현이므로 이식 시 대조 대상으로 쓴다.

### CSS 처리 — 중복 복사하지 않음

핸드오프 CSS 6개를 기존 `packages/design-tokens`와 비교한 결과:

| 파일 | 비교 결과 | 조치 |
|---|---|---|
| `components.css` | **byte 동일** (diff 0) | 기존 재사용 |
| `widgets.css` | **byte 동일** (diff 0) | 기존 재사용 |
| `tokens.css` | 기존이 상위 집합 (한글 폰트 폴백 추가) | 기존 유지 |
| `base.css` | 기존이 상위 집합 (`prefers-reduced-motion` 블록 추가) | 기존 유지 |
| `pages.css` | 기존에 없음 | **추가** |
| `pages-auth.css` | 기존에 없음 | **추가** |

`packages/design-tokens/src/all.css` 배럴과 `package.json` exports를 갱신했다.

### 프로젝트/브랜드 이름 — 미확정

폴더명은 기술적 이름(`broker-web`)으로 두었다. 브랜드명이 바뀔 때마다 폴더를 옮기면 git 이력이
손상되므로 분리한다. `team_delivery`에 "QuantumTrade"가 **56회**(18개 파일) 등장하므로, 브랜드
변경 시 그 문구를 일괄 교체한다. 패키지 스코프(`@quantumtrade/*`, 22개)는 내부 식별자이므로
브랜드와 무관하게 유지 가능.

---

## 5. `/wallet` 재설계 (G3·G4 일부 반영) — 2026-08-03

`apps/broker-web/src/pages/wallet/WalletPage.tsx` 이식 시 브로커 모델에 맞게 조정했다.

### 탭 구성 변경

프로토타입은 4탭(거래소 연동 / 자산 잔고 / 입금 / 출금)이었다.

| 탭 | 조치 | 근거 |
|---|---|---|
| 거래소 연동 | 유지 · **실 API 연동** | 브로커 모델의 핵심 화면 |
| 자산 잔고 | 유지하되 **미연결 명시** | 잔고는 사용자 거래소 계정에 있음. 연동 키로 거래소에서 조회하는 엔드포인트가 아직 없음 |
| 입금 | **삭제** | 우리는 자금을 보관하지 않는다. 입금받을 지갑이 없음 |
| 출금 | **삭제** | 위와 같음 |

입출금 탭을 남겨두면 존재하지 않는 커스터디 서비스를 광고하는 것이 된다. 테스트
`WLT-03[2]`가 두 탭의 부재를 고정한다.

자산 잔고 탭은 mock 숫자로 채우지 않았다. `GET /account/assets`는 우리 시뮬레이션 투영값이며
거래소 실 잔고가 아니다. 화면에 "아직 연결되지 않았다"고 적었다.

### 연동 가능 거래소는 현재 BitMart 하나

`POST /trading/credentials`는 `accessKey`·`secretKey`·**`memo`**를 요구한다. `memo`는 BitMart
고유 필드이며, `SqliteCredentialRepo.create()`는 `exchange`를 `'bitmart'`로 하드코딩한다. 나머지
7개 거래소는 referral 링크만 동작하고 어댑터가 없다.

따라서 카드 8개 중 7개의 Connect 버튼은 **비활성 + 이유 표시**이고, 페이지 상단에도 한 번 명시했다
(툴팁만으로는 부족). 테스트 `WLT-01[3][4]`가 이를 고정한다.

referral 링크는 **8개 전부 동작**한다 — 연동 불가와 무관하게 수익 경로이기 때문이다.

### 마법사의 "테스트" 단계를 실제 검증으로 교체

프로토타입 3단계는 `setTimeout` 후 두 필드가 8자 이상이면 성공으로 처리했다. 이식 버전은
`POST /trading/credentials` → `POST /trading/credentials/:id/verify` 순으로 호출하며, verify는
거래소에 **읽기 전용 잔고 조회**를 실제로 보낸다.

`verify`는 실패해도 **HTTP 200**에 `connectionStatus: 'FAILED'`를 담아 응답한다. status만 보면
성공으로 오인하므로 본문을 검사한다. 테스트 `WLT-04[4]`가 이 경로를 고정한다.

### 백엔드 변경 1건

`apps/api/src/trading-routes.ts` — `GET /trading/connection-status` 응답에 `exchange`와 `label`
추가. 행에 이미 있는 값이며, 없으면 UI가 저장된 키가 어느 거래소 것인지 표시할 수 없다.

### 검증 (실서버, 실제 실행)

```
POST /api/auth/register                → 201
POST /api/auth/login                   → 200 + csrfToken
GET  /api/trading/connection-status    → mode=BITMART_LIVE_READ_ONLY, credentials=0
POST /api/trading/credentials          → 201 {accessKeyMasked:"test…3456", connectionStatus:"UNVERIFIED"}
GET  /api/trading/connection-status    → exchange=bitmart label="Main Trading" masked=test…3456
                                         응답에 secretKey 없음 · memo 없음 (확인)
POST /api/trading/credentials/:id/verify → HTTP 200 + {connectionStatus:"FAILED", reason:"http_401"}
GET  /api/trading/connection-status    → status=FAILED (반영됨)
```

`http_401`은 **BitMart 실서버**(`api-cloud-v2.bitmart.com`)가 가짜 키를 거부한 응답이다. 자격증명
경로가 실제로 거래소와 통신함을 의미한다.

---

## 6. G3·G4·G5 non-custodial 재설계 완료 — 2026-08-03

### G5 트랜잭션 원장 → 거래소 선물 계정 자금 흐름

프로토타입의 6종(deposit·withdraw·transfer·trade·fee·rebate)은 **존재하지 않는 우리 원장**을 전제했습니다.
실제로 조회 가능한 것은 사용자 본인 거래소 계정의 자금 흐름이고, 이미 받은 **Read 권한만으로 조회됩니다.**

`BitMart /contract/private/transaction-history` (KEYED, Read-only):
`flow_type` 1 Transfer · 2 Realized PNL · 3 Funding Fee · 4 Commission Fee · 5 Liquidation Clearance

구현:
- `packages/exchange-bitmart/src/transaction-history.ts` — 파싱·집계·쿼리 빌드 (22 tests)
- `packages/exchange-bitmart/src/futures-rest-adapter.ts` — `getTransactionHistory()`
- `packages/schemas/src/market.ts` — `ExchangeTransactionQuerySchema` (`.strict()`)
- `apps/api/src/trading-routes.ts` — `GET /trading/transactions`
- `apps/broker-web/src/pages/wallet/WalletTransactionsPage.tsx`

**주의한 상류 특성 2건:**
- `amount`는 **부호 있는** 십진 문자열(`"-0.37500000"`). 수수료·손실이 음수로 오므로 부호를 보존해야 하며,
  버리면 수수료가 수입으로 표시됩니다.
- `time`은 **밀리초 문자열**(`"1570608000000"`). kline의 `ts`는 초 단위라 같은 처리를 하면 전 행이 1970년이 됩니다.

**입금·출금은 이 목록에 없습니다** — 거래소 현물 계정에서 일어나고 우리를 통과하지 않습니다. 화면에 명시했습니다.

### G3 입금 / G4 출금 → 거래소 안내 페이지 (폼 없음)

프로토타입은 둘 다 동작하는 폼이었습니다: 자산·네트워크별 QuantumTrade 지갑 주소 발급, 그리고 한도·주소록·2FA·
관리자 승인 큐가 있는 출금 폼.

**둘 다 성립할 수 없습니다.** 우리는 지갑도 주소도 잔고도 없습니다.
특히 **입금 주소는 이 제품에서 가짜로 만들면 가장 위험한 것**입니다 — 누구에게도 속하지 않은 주소로 보낸 자금은
되돌릴 수 없이 사라집니다. 따라서 두 라우트에 **입력 폼을 두지 않았습니다**(테스트가 `input` 개수 0을 고정).

대신 실제 수행 위치를 설명하고 거래소 페이지로 연결합니다. 출금 페이지는 추가로 다음을 명시합니다:
- 우리 API key에는 출금 권한이 없고 앞으로도 요구하지 않음
- **출금 권한을 요구하는 안내가 나타나면 피싱**

이 문구는 사용자가 "출금이 되게 하려고" Withdraw 권한을 켤 위험이 가장 큰 화면이라 넣었습니다.

### G11 Hot/Cold 자산 — 여전히 불필요

보관 자산이 없어 준비금 비율 개념이 성립하지 않습니다. `/admin/assets`는 admin 라우트 작업에서
"해당 없음" 사유와 함께 처리 예정.

### 발견/수정한 내 결함 3건

1. `WalletTransactionsPage`가 필터 변경 시 `body`가 null이 되어 **사용자가 방금 조작한 필터 컨트롤까지 언마운트**.
   `placeholderData: (prev) => prev`로 수정.
2. `body.window.truncated`가 `window` 없는 응답에서 TypeError → 페이지 백지. 가드 추가.
   (`NotificationsPage`의 `body.page.total` 크래시와 같은 부류)
3. 존재하지 않는 아이콘 `Icons.External`/`Icons.Download` 사용 → `ArrowRight`/`Save`로 교체.

### 검증 (전부 실제 실행)

```
pnpm -r typecheck  exit 0, TS errors 0
pnpm -r test       exit 0, 1490 passed
pnpm build         exit 0, broker-web 418.53 kB
pnpm lint          exit 0, 경고 6건 (전부 기존 apps/web/authApi.ts)

실서버:
  미인증                → 401
  검증된 키 없음        → 409 NO_VERIFIED_CREDENTIAL + configured:true, hasCredential:false
  flowType=9            → 400
  bogusParam=1          → 400 (.strict)
  startTime>endTime     → 400 "startTime must be <= endTime"
  SPA /wallet /wallet/deposit /wallet/withdraw /wallet/transactions → 전부 200
```

**미검증:** 실제 거래소 응답 — 검증된 사용자 API key가 필요합니다. 파싱은 문서의 응답 예시로 테스트했습니다.
