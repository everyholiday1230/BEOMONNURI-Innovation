# ChartControl AI

AI 차팅 · 트레이딩 터미널. 고객이 **자기 거래소 계정**을 API 키로 연결하고, 우리 화면에서 차트를 보고 주문을 낸다.

**운영 중이며 실주문이 거래소로 나간다.** 실제 고객의 실제 돈이 움직인다.

---

## 이 제품이 하지 않는 것

먼저 이것부터 적는다. 이전 README 가 여기서 사실과 달랐고, 그 오해가 운영·회계·투자자 설명을 잘못된 방향으로 끌고 갈 수 있다.

| 하지 않는 것 | 이유 |
|---|---|
| **고객 자금 보관** | 비수탁이다. 자금은 고객의 거래소 계정에 있다. 우리 지갑·키·온체인 경로가 없다. |
| **입금 · 출금 처리** | 우리가 승인할 대상이 없다. 출금은 거래소에서 고객 인증으로 일어난다. |
| **KYC 심사** | 우리는 신원 확인 주체가 아니다. 거래소가 한다. |
| **수수료 페이백 / 리베이트 지급** | 지급할 지갑이 없다. 리베이트 조건은 `sharePct > 0` 일 때만 화면에 나온다. |
| **KuCoin 이외 거래소** | 지금은 KuCoin 뿐이다. 어댑터 구조는 확장을 전제로 하지만 붙은 것은 하나다. |

운영자 화면에 `/admin/deposits` · `/admin/withdrawals` · `/admin/assets` 가 남아 있으나, 실서비스에서는 목업 대신 **"우리는 자금을 보관하지 않는다"** 는 설명을 표시한다. 디자인 미리보기(백엔드 없음)에서만 원래 시안이 보인다.

---

## 구조

pnpm 모노레포.

```
apps/
  api/                  Hono BFF. 인증 · 주문 · 관리자 · 결제 · 법적문서 · 관측
  market-gateway/       시세 게이트웨이 서버
packages/
  exchange-kucoin/      KuCoin 선물/현물 어댑터 (주문 · 시세 · 브로커 리베이트)
  exchange-bitmart/     BitMart (폴백으로만 남아 있다 — 2026-08-26 거래 중단)
  exchange-adapters/    거래소 중립 인터페이스
  domain/               금액 계산(D) · 리스크 게이트 · 주문 수학
  schemas/              zod 스키마 (주문 · 심볼)
  auth/                 세션 · 비밀번호 · 메일 · OAuth
  mfa/                  TOTP (RFC 6238)
  admin-domain/         관리자 권한(RBAC) · 불변식
  admin-schemas/        관리자 요청 스키마
  ai/                   AI 코파일럿 (도구 호출 · 신호 제안)
  chart-adapter/        차트 엔진 어댑터
  market-gateway/       시세 정규화 · 구독 관리
  observability/        지표
  cluster/              Redis 분산(레이트리밋 · 잠금)
  security/ chaos/ strategy/ config/ design-tokens/
src/                    프론트엔드 (아래 참조)
infrastructure/postgres/  Postgres 마이그레이션 (0001~0040)
```

### 프론트엔드는 번들링하지 않지만, JSX 는 미리 컴파일한다

`index.html` 이 스크립트를 순서대로 로드하고 상태는 `window.*` 전역으로 공유한다. 모듈 번들러는 없다.

JSX 23개는 **빌드 시점에** 컴파일한다:

```bash
node scripts/build-web.mjs      # src/*.jsx → web-dist/*.js
pnpm build                      # 패키지 빌드 + 위 단계
```

`web-dist/` 는 커밋하지 않는다(`.gitignore`). 없으면 **모든 화면이 빈다** — 서버가 부팅 때 그 사실을 크게 알린다.

★★ **컴파일 결과의 위치가 중요하다.** Babel standalone 은 `text/babel` 을 문서 파싱이 끝난 뒤 실행했으므로, 예전 실제 순서는 (1) 일반 JS 전부 → (2) JSX 전부 → (3) 마운트 였다. 그래서 컴파일 결과를 **모든 일반 JS 뒤·마운트 앞**에 모아 둔다. JSX 태그를 원래 자리에 두고 일반 스크립트로 바꾸면 순서가 달라진다.

★ 프리셋은 `react` 만 쓴다. 일반 `.js` 49개가 이미 변환 없이 나가면서 `const`·화살표·템플릿을 쓰므로 브라우저는 ES2015+ 를 이미 지원해야 한다. 예전에는 JSX 만 ES5 로 낮추고 있었고, 그건 아무도 얻지 못하는 비용이었다(약 +23만 바이트).

★★ `env` 를 뺐을 때 **숨어 있던 결함이 드러났다**: `ai-copilot.jsx` 가 `aiReady` 를 선언보다 먼저 읽고 있었는데, `const`→`var` 변환이 TDZ 를 없애 가려주고 있었다. 문법 문제가 아니라 실제 버그였다.

남은 과제: 최소화(minify)와 트리 셰이킹은 아직 없다.

---

## 로컬에서 실행

```bash
pnpm install

# API + 정적 파일 (SQLite, 모의 시세, 주문은 모의 처리)
DATA_MODE=MOCK_REPLAY TRADING_MODE=MOCK \
API_PORT=8787 API_HOST=127.0.0.1 \
AUTH_COOKIE_INSECURE=true SQLITE_PATH=/tmp/cc.db \
pnpm --filter @quantumtrade/api dev

# http://127.0.0.1:8787 에서 화면까지 함께 서빙된다
```

기본은 SQLite 다. Postgres 로 붙이려면 **두 값을 함께** 줘야 한다 — `DATABASE_URL` 만으로는 전환되지 않는다(테스트가 개발 DB 를 오염시키는 것을 막기 위한 의도적 설계):

```bash
DATABASE_URL=postgresql://... USE_POSTGRES=true ...
```

마이그레이션은 **부팅 시 자동 실행되지 않는다.** `migrateUp(pool)` 을 직접 호출하거나 `pnpm test:postgres` 로 적용한다. 서버를 먼저 띄우면 관리자 라우트가 테이블 부재로 비활성화된다.

### 검사

```bash
npx eslint .                                        # 0 errors 여야 한다
pnpm -r typecheck                                   # 0 errors 여야 한다
pnpm --filter @quantumtrade/api exec vitest run     # 1036 passed
```

`packages/cluster` 의 `redis.integration.test.ts` 는 `REDIS_URL` 없이 실패한다. 기존 문제이고 무관하다.

---

## 실주문이 나가는 조건

한 곳만 봐서는 안 된다. **모두** 만족해야 주문이 거래소로 간다.

```
FEATURE_LIVE_ORDERS_ENABLED = true
TRADING_MODE                = 실주문 지원 모드
LIVE_EXECUTION_MODE         = BITMART_LIVE_TRADE      ← 이름만 BitMart, 실제로는 KuCoin
LIVE_TRADING_ENABLED        = true
EMERGENCY_KILL_SWITCH       = false
DB kill_switches            = global_live_trading · bitmart_live_trading · new_positions 모두 비활성
```

부팅 로그가 **왜 막혀 있는지** 정확히 출력한다. 막힌 이유를 추측하지 말고 로그를 볼 것.

> **이름**: 이 값들은 BitMart 가 아니라 **지금 붙어 있는 거래소(KuCoin)** 를 통제한다. 거래소 중립 이름을 쓰고, 옛 이름은 폴백으로만 남아 있다:
>
> | 쓸 이름 | 옛 이름(폴백) |
> |---|---|
> | `LIVE_EXECUTION_MODE` | `BITMART_MODE` |
> | `LIVE_TRADING_ENABLED` | `BITMART_LIVE_TRADING_ENABLED` |
> | `EMERGENCY_KILL_SWITCH` | `BITMART_EMERGENCY_KILL_SWITCH` |
> | `CREDENTIAL_KEK` | `BITMART_DEV_KEK` — **모든 거래소의 고객 API 키를 감싸는 키다.** BitMart 전용으로 착각해 지우면 저장된 자격증명을 복호화할 수 없다 |
>
> 옛 이름을 쓰고 있으면 부팅 로그가 이름을 짚어 경고한다.
>
> 킬스위치 스코프도 `exchange_live_trading` 으로 바뀌었다. 옛 `bitmart_live_trading` 은 계속 강제되므로(둘 중 하나라도 켜지면 차단) 이미 켜둔 차단이 풀리지 않는다.
>
> `BITMART_REST_BASE` · `BITMART_WS_*` · `BITMART_BROKER_ID` 는 **정말로 BitMart 전용**이라 이름이 맞다.

---

## 이 코드베이스의 규칙

작업 전에 읽을 것. 여기 적힌 것들은 전부 **실제로 사고가 났던 지점**이다.

### 돈은 십진 문자열로만 다룬다

`D()` (`@quantumtrade/domain`) 를 쓴다. `Number` · `parseFloat` 금지.

> PayPal 결제 확인이 `NUMERIC(24,8)` 의 `"9.99000000"` 과 PayPal 의 `"9.99"` 를 문자열로 비교해 **항상 실패**했다. 고객은 결제되고, 주문은 실패로 기록되고, 포인트는 지급되지 않았다.

### 없는 데이터를 만들지 않는다

- 조회 실패는 "없음" 이 아니다. 빈 배열·0 으로 바꾸지 말고 오류로 표시한다.
- 기본 TP/SL 가격을 넣지 않는다. 날짜 없는 행에 날짜를 넣지 않는다.
- `PgIdempotencyStore.get()` 은 실패 시 **던진다**. 멱등성 조회 실패를 "처음 본 주문" 으로 취급하면 중복 주문이 나간다.

> 저장 목록 3곳이 `.catch(() => setItems([]))` 였다. 고객에게는 "저장한 것이 사라졌다" 로, 운영자에게는 "고객 문의 없음" 으로 보였다.

### 요청한 값이 아니라 실제 적용된 값을 보고한다

주문 수량은 **거래소로 보낸 계약수 × 승수**를 돌려준다. `NormalizedOrder.takeProfitPrice` · `endpoint` 도 실제 등록된 값이다.

### 죽은 버튼을 만들지 않는다

`disabled` + 이유를 표기하거나, `src/pending-actions.js` 의 전역 "준비 중" 토스트에 맡긴다. 눌러도 조용히 아무 일 없는 버튼은 금지다.

### 틀린 기준으로 검증하지 않는다

이 유형이 고객 불만의 실제 원인이었다.

- 마진 모드: 고객 선택이 아니라 **거래소에 설정된 모드**로 주문한다(`getMarginMode`). 불일치하면 KuCoin 이 거부한다.
- 현물 주문은 **현물 규격**으로 검증한다. 선물 수량은 계약수, 현물은 코인 수다. 선물 심볼 669개 / 현물 1006개로 카탈로그도 다르다.
- 상한(레버리지 · 주문금액 · 포지션수 · 일일주문 · 일일손실)의 **0 또는 빈 값은 "제한 없음"** 이다. 비교식에서 이걸 처리하지 않으면 `0 < 0` 이 거짓이 되어 모든 주문이 막힌다.

### 작동할 수 없는 안전장치를 "통과" 로 표시하지 않는다

`dailyLossSoFar` 는 아직 측정 경로가 없다(`'0'` 고정). 그래서 일일 손실 한도가 설정돼 있으면 게이트는 **거부**한다 — 통과로 보고하면 운영자가 보호받는다고 착각한다.

### 의미→거래소 변환은 한 곳에서만

TP/SL 의 위/아래 방향 매핑은 단 한 군데 있다. 뒤집히면 손절 자리에 익절이 걸린다.

### 주석은 "왜" 를 적는다

`★` / `★★` 표시로 **막으려는 실패 모드**를 함께 적는다. 이 코드베이스의 주석은 장식이 아니라 사고 기록이다.

> 반대로, 코드와 어긋난 주석은 없는 것보다 나쁘다. `trade-mode.js` 에 "현물은 주문을 낼 수 없다" 고 적혀 있었고 바로 아랫줄이 `orderPath: 'live'` 였다. 실제로 고객 현물 주문이 거래소까지 갔다.

---

## 관측

문제를 **고객보다 먼저** 알기 위한 장치다. 이전에는 없었다.

- 서버 예외 → `app.onError` → `ops_errors` 기록. 응답에는 추적 ID 만 담는다(예외 메시지에 쿼리문·접속문자열이 섞여 나간다).
- 브라우저 오류 → `POST /api/ops/client-error` → 같은 저장소
- **원인당 1행.** 지문 계산에서 UUID · 숫자 · 따옴표 값과 스택의 행:열을 지운다. 안 그러면 한 버그가 수천 행이 되어 목록을 읽을 수 없고 알림이 폭주한다.
- 새 오류는 `OPS_ALERT_EMAIL`(없으면 `MAIL_FROM`) 로 메일 발송. **지문당 1시간 1통.**
- 운영자 화면: `/admin/system` → "Errors (last 24h)"

기록·발송 실패는 절대 요청을 깨뜨리지 않는다. Postgres 가 없으면 부팅 로그가 "기록 꺼짐" 이라고 밝힌다.

---

## 권한

```
USER < PRO_USER < SUPPORT / ANALYST < ADMIN < SUPER_ADMIN
```

- 좌측 내비게이션은 `OPS → ADMIN → SUPER` 순으로 나뉜다. 등급은 각 항목의 `roles` 에서 자동으로 정해지므로 표시와 실제 권한이 어긋날 수 없다.
- **회원 삭제는 SUPER_ADMIN 전용**이다. `ADMIN` 은 `admin.user.delete` 를 갖지 않는다.
- 되돌릴 수 없는 작업은 재인증 + 사유 + 감사기록을 요구한다.
- 권한 검사는 서버가 한다. 화면의 `roles` 배열은 표시용이다.

---

## 배포

Render. Postgres + 웹 서비스. 자동 배포는 꺼져 있고(`autoDeployTrigger: 'off'`) 배포는 명시적으로 트리거한다.

```bash
# 배포 전
npx eslint . && pnpm -r typecheck && pnpm --filter @quantumtrade/api exec vitest run
```

프론트엔드는 CDN 캐시 때문에 배포 직후 이전 파일이 응답할 수 있다. 배포 확인은 캐시 우회 쿼리(`?cb=$RANDOM`)로 마커를 grep 해서 한다.

**신규 마이그레이션은 배포와 별도로 적용해야 한다.** 부팅 시 자동 실행되지 않는다.

---

## 알려진 미해결 과제

| 항목 | 영향 |
|---|---|
| React 개발 빌드 + 런타임 Babel | 첫 화면 로딩이 느리다 |
| 모드 값이 `BITMART_LIVE_TRADE` | 값 이름만 거래소 이름이다(env 이름·내부 식별자·킬스위치는 정리됨). 58곳에 퍼져 있어 별도로 옮긴다 |
| `dailyLossSoFar` 측정 경로 없음 | 일일 손실 한도를 실제로 걸 수 없다 |
| 과거 AI 대화 선택 UI 없음 | 저장·자동복원은 되지만 목록에서 고를 수 없다 |
| e2e 하네스가 없는 패키지를 참조 | `@quantumtrade/web` — e2e 가 돌지 않는다 |
| 마이그레이션 드리프트 | 운영 전용 표 33개 — 개발(SQLite)에서 그만큼 기능이 꺼진다. 기록·점검: [docs/schema-drift.md](docs/schema-drift.md), `pnpm check:schema-drift` |
| `src/widgets.jsx` 111KB · `src/pages-user.jsx` 4295행 | 수정 위험이 크다 |

---

## 이름에 대한 메모

패키지 스코프가 `@quantumtrade/*` 다. 제품명은 **ChartControl AI** 로 바뀌었지만 패키지 이름은 그대로다. 브랜드 문자열은 사전 한 곳에서만 정하므로(`i18n.js`), 화면에는 올바른 이름이 나온다.
