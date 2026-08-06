# Prompt 5 — Backend/API/DB/AI Integration (RESUME STATE)

> 세션 중단 시 이어서 작업하기 위한 상태 파일. 새 세션은 이 파일을 먼저 읽고 `NEXT ACTION`부터 재개.
> commit 하지 않는다.

## §2 Preflight (2026-07-31 11:3x)

| Item | Value |
|---|---|
| repo root | /home/test1/quantumtrade-ai |
| branch | phase-7-production-launch |
| **시작 HEAD** | **26c0f71e32e589fee5e9cda2d42d9579c271e537** (Prompt 4 checkpoint) |
| Prompt 3 checkpoint | 98059302f0a1b7e2a6ccc8efcbebb316b41f9c3f |
| tags | 15 (phase-7 태그 없음) |
| working tree | 32 (A 29 + B 3) — **변경 금지** |
| staged | 0 |
| node / pnpm / docker | v24.18.0 / 9.15.0 / 29.1.3 |
| postgres / redis | psql 16.14 / redis-server 7.0.15 (둘 다 로컬 설치됨) |
| pnpm-lock.yaml sha256(24) | acf8e54a519a8987ee063179 |
| package.json sha256(24) | 86ae36f2f50106da143891ea |
| busy ports | 22 53 80 5177 5180 5432 6379 8000 8080 8897 15432-15434 16379 16380 |

격리 규칙: Postgres/Redis 검증은 15432+/16379+ 대역의 **임시 인스턴스**만 사용하고
로컬 5432/6379와 기존 dev server는 건드리지 않는다.

### 변경 격리 그룹
- **A. PRE_EXISTING_ARTIFACTS (29)** — `/tmp/qt-before.txt`. 변경 금지.
- **B. GENERATED_TEST_ARTIFACTS (3)** — `artifacts/logs/phase7/e2e-isolated*.{log,tsv}`. 변경 금지.
- **C. PROMPT5_BACKEND_CHANGES** — 이번 작업 산출물. 아래 누적.

## §3 실코드 조사 결과

### 서버 라우트 실측 (non-admin)
67개. 인증/MFA/session 계열은 완비. market read 5개(`symbols/candles/orderbook/trades/ticker`),
sim order 3개, `/me/*` 리소스(layouts, overlays, signals, order-drafts, conversations, sim-orders) 존재.

### 결정적 발견
1. **`GET/PUT /account/preferences`가 이미 서버에 있는데 web 클라이언트가 소비하지 않는다.**
   → 상태: `BACKEND_AVAILABLE_NOT_CONSUMED`. B2는 신규 구축이 아니라 **연결 + version 추가**다.
   구현 위치 `apps/api/src/auth-routes.ts:206-221` (CSRF·permission·audit 이미 적용).
2. `user_preferences` 테이블은 **고정 컬럼**(theme/brand/density/longshort/locale) + `updated_at`.
   favorites 컬럼도 `version` 컬럼도 없다.
3. `notifications` 테이블은 **이미 존재**(id/user_id/type/message/read/created_at)하지만 **라우트가 없다.**
   → `CLIENT_AVAILABLE_BACKEND_MISSING`이 아니라 `BACKEND_REQUIRED` (테이블만 있고 API 없음).
4. favorites 전용 테이블은 **없다** → migration 필요.
5. `/api/market/search`, `/api/orders/*`, `/api/trades`, `/api/positions`,
   `/api/account/summary|assets`, `/api/notifications` — 전부 **미존재**.
6. `orders`/`positions`/`executions` 테이블은 존재(0003). Prompt 4에서 admin read-only로 연결 완료.
   User read model은 같은 테이블을 **소유권 필터**로 재사용할 수 있다 — 중복 테이블 금지 원칙 적용.

### §3 계약 원장 (구현 전 기준선)

| Contract ID | UI Control/Screen | Client Method | HTTP Method/Path | Auth | CSRF | Permission | Step-up | Persistence | Audit | Idempotency | Current Status | Target Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| MKT-01 | SymbolSearch (MarketsPage/헤더) | `api.searchSymbols` (신규) | GET `/api/market/search` | session | n/a | — | — | 없음(카탈로그) | — | n/a | **BACKEND_REQUIRED** | FULLY_CONNECTED |
| FAV-01 | 즐겨찾기 목록 | `api.favorites` (신규) | GET `/api/me/favorites` | session | n/a | account.read.self | — | `user_favorites` (신규) | — | n/a | **BACKEND_REQUIRED** | FULLY_CONNECTED |
| FAV-02 | 즐겨찾기 토글 | `api.putFavorites` (신규) | PUT `/api/me/favorites` | session | ✔ | account.update.self | — | `user_favorites` | ✔ | If-Match/version | **BACKEND_REQUIRED** | FULLY_CONNECTED |
| PREF-01 | theme/locale/density | 미연결 | GET `/account/preferences` | session | n/a | — | — | `user_preferences` | — | n/a | **BACKEND_AVAILABLE_NOT_CONSUMED** | FULLY_CONNECTED |
| PREF-02 | 설정 저장 | 미연결 | PUT `/account/preferences` | session | ✔ | account.update.self | — | `user_preferences` | ✔ | version(추가 필요) | **BACKEND_AVAILABLE_NOT_CONSUMED** | FULLY_CONNECTED |
| ORD-05 | Open Orders 탭 | `api.openOrders` (신규) | GET `/api/orders/open` | session | n/a | — | — | `orders` (소유권 필터) | — | n/a | **BACKEND_REQUIRED** | FULLY_CONNECTED |
| ORD-06 | Order History 탭 | 신규 | GET `/api/orders/history` | session | n/a | — | — | `orders` | — | n/a | **BACKEND_REQUIRED** | FULLY_CONNECTED |
| ORD-07 | Trade History 탭 | 신규 | GET `/api/trades` | session | n/a | — | — | `executions` | — | n/a | **BACKEND_REQUIRED** | FULLY_CONNECTED |
| ORD-08 | Positions 탭 | 신규 | GET `/api/positions` | session | n/a | — | — | `positions` | — | n/a | **BACKEND_REQUIRED** | FULLY_CONNECTED |
| ORD-03 | Order Entry preview | `api.createDraft`(기존 sim) | POST `/api/orders/draft` | session | ✔ | — | — | `order_drafts` | ✔ | key | PARTIALLY (sim 전용) | FULLY_CONNECTED |
| ORD-04 | Order Entry validate | 신규 | POST `/api/orders/validate` | session | ✔ | — | — | 없음(계산) | ✔ | key | **BACKEND_REQUIRED** | FULLY_CONNECTED |
| ACC-01 | AssetsRiskWidget | 신규 | GET `/api/account/summary` | session | n/a | — | — | `account_balances`/`positions` | — | n/a | **BACKEND_REQUIRED** | FULLY_CONNECTED |
| ACC-02 | 자산 목록 | 신규 | GET `/api/account/assets` | session | n/a | — | — | `account_balances` | — | n/a | **BACKEND_REQUIRED** | FULLY_CONNECTED |
| NTF-01 | NotificationsPage | 신규 | GET `/api/notifications` | session | n/a | — | — | `notifications` (기존 테이블) | — | n/a | **BACKEND_REQUIRED** | FULLY_CONNECTED |
| NTF-02 | 읽음 처리 | 신규 | POST `/api/notifications/:id/read`, `/read-all` | session | ✔ | — | — | `notifications` | ✔ | idempotent | **BACKEND_REQUIRED** | FULLY_CONNECTED |
| ADM-API-13 | Security/MFA | 신규 | GET `/admin/security/summary`, POST `/admin/users/:id/unlock` | session | ✔ | 신규 capability | ✔ | `mfa_*`/`sessions` | ✔ | — | **BACKEND_REQUIRED** | FULLY_CONNECTED |
| ADM-API-12 | Reports | 신규 | GET `/admin/reports` | session | n/a | admin.audit.read | — | 집계 | — | — | **BACKEND_REQUIRED** | FULLY/PARTIAL |
| ADM-API-15 | Backup status | 신규 | GET `/admin/backup/status` | session | n/a | admin.dashboard.read | — | read-only | — | — | **BACKEND_REQUIRED** | PARTIALLY |
| ADM-API-07 | Gateway metrics | 신규 | GET `/admin/gateway/metrics` | session | n/a | admin.exchange.read | — | ws sessions | — | — | **BACKEND_REQUIRED** | PARTIALLY |
| ADM-API-08 | Gateway resync/reconnect | 신규 | POST `/admin/gateway/*` | session | ✔ | 신규 capability | ✔ | MOCK gateway만 | ✔ | key | **BACKEND_REQUIRED** | PARTIALLY |
| ADM-API-09 | Incident ack | 신규 | POST `/admin/incidents/:id/ack` | session | ✔ | admin.incident.write | — | `incidents` | ✔ | version | **BACKEND_REQUIRED** | FULLY_CONNECTED |
| ADM-API-11 | AI policy write | 신규 | PUT `/admin/ai/policy` | session | ✔ | admin.ai.policy.write | ✔ | `ai_prompt_versions` | ✔ | version | **BACKEND_REQUIRED** | FULLY/PARTIAL |
| ADM-AI-ERR | AI Ops errors 패널 | 미연결 | GET `/admin/ai/errors` | session | n/a | admin.ai.read | — | `ai_runs` | — | n/a | **BACKEND_AVAILABLE_NOT_CONSUMED** | FULLY_CONNECTED |
| ADM-API-01 | 모든 테이블 정렬 | 기존 | 각 GET + `sort`/`dir` | session | n/a | 각 read | — | — | — | n/a | PARTIALLY (sort 없음) | FULLY_CONNECTED |

## Batch status

| Batch | Scope | Status |
|---|---|---|
| B0 | 공통 API 기반 | TODO |
| B1 | Market Search (MKT-01) | **DONE** |
| B2 | Favorites + Preferences | **DONE** |
| B3 | Orders/Trades/Positions read model | TODO |
| B4 | Order draft/validate | TODO |
| B5 | Account/Assets/Risk | TODO |
| B6 | Notifications | TODO |
| B7 | Admin BACKEND_REQUIRED 7건 | TODO |
| B8 | /admin/ai/errors 연결 | TODO |
| B9 | AI context/provider 경계 | TODO |
| B10 | DB/Migration 품질 | **DONE (선행 수행)** |

## NEXT ACTION

1. [x] §2 preflight
2. [x] §3 실코드 조사 + 계약 원장
3. [ ] **B10 선행: migration 0007 (user_favorites, preferences version, notifications 보강)**
4. [ ] B1 MKT-01
5. [ ] B2 FAV/PREF
6. [ ] B3 read model · B4 draft/validate · B5 account · B6 notifications
7. [ ] B7 admin 7건 · B8 ai/errors · B9 AI context
8. [ ] 테스트 원장 + 보고서 A~U. **commit 금지**


---

## B10 (선행) — Migration 0007 + 품질 검증 DONE

순서 조정 이유: B2(favorites/preferences)와 B6(notifications)가 스키마에 의존하므로 B10의 migration
부분을 B1 앞으로 옮겼다. 나머지 B1~B9는 지시 순서대로 진행한다.

### 신규 파일
| File | 내용 |
|---|---|
| `apps/api/src/db/migrations/0007_phase7_user_data.sql` | additive only. `user_favorites`, `user_favorites_meta`(set version), `user_preferences.version`, `notifications.{severity,read_at,correlation_id}` + index 2, `order_drafts.{source,executable}` |
| `apps/api/src/db/migrations-down/0007_phase7_user_data.down.sql` | rollback. 0007이 추가한 것만 제거 |
| `apps/api/src/__tests__/migrations.test.ts` | clean/upgrade/re-run/rollback/constraint 6 tests |

### 설계 결정
- favorites를 JSON 배열이 아니라 **(user_id, symbol) PK 한 행씩**으로 저장.
  중복 방지가 애플리케이션 로직이 아니라 **DB 제약**이 되고, 토글이 한 행 쓰기가 되며,
  순서가 배열 인덱스가 아닌 명시적 `sort_index`가 된다.
- favorites version은 `user_favorites_meta`에 별도 보관 — 버전은 **행이 아니라 집합**의 속성이므로.
- `order_drafts.executable`은 파생값이 아니라 **저장값**. 행만 감사해도 실행 불가였음이 드러난다.

### 도중 발견해 고친 치명적 실수 (기록)
`.down.sql`을 forward migrations 디렉터리에 두었다. 러너는 `*.sql`을 모두 forward로 적용하고
정렬상 `…user_data.down.sql` < `…user_data.sql` 이므로 **없는 컬럼을 먼저 DROP해서 clean install이
깨지는** 상태였다. 조치:
1. `migrations-down/` 로 분리
2. 러너 필터에 `&& !f.endsWith('.down.sql')` 방어 추가 (`apps/api/src/db/sqlite.ts`)
3. 테스트로 두 가지를 고정: forward 디렉터리에 `.down.sql` 0건, 그리고 정렬 위험이 실재함

### 검증
| Path | Result |
|---|---|
| clean install (0001→0007) | PASS — 0007 객체 전부 생성 |
| re-run `migrate()` | PASS — no-op |
| upgrade on populated 0006 | PASS — 기존 행 보존 + 선언된 default 적용 (`executable=0`) |
| constraints | PASS — 사용자별 중복 차단, 타 사용자 동일 symbol 허용, ON DELETE CASCADE |
| rollback → re-apply | PASS — 스키마 0006 형태 복귀 후 0007만 재적용 |

## NEXT ACTION (갱신)
1. [x] preflight · 계약 원장 · **B10 migration**
2. [ ] **B1 MKT-01 market search** ← 현재 지점
3. [ ] B2 FAV/PREF · B3 read model · B4 draft/validate · B5 account · B6 notifications
4. [ ] B7 admin 7건 · B8 ai/errors · B9 AI context
5. [ ] 테스트 원장 + 보고서 A~U


---

## B1 — MKT-01 Market Search DONE

### 신규/변경
| File | 내용 |
|---|---|
| `apps/api/src/market/search.ts` | NEW — 순수 검색/랭킹 도메인. 정규화, 명시적 score, 안정 tie-break, empty-query 정책 |
| `apps/api/src/market/market-routes.ts` | NEW — mountable router. `.strict()` query schema, provenance, 502 분리 |
| `apps/api/src/index.ts` | inline 라우트 대신 router 마운트 |
| `apps/web/src/lib/api.ts` | `searchSymbols()` + 응답 schema |
| `apps/web/src/market/useMarketData.ts` | `useSymbolSearch()` — queryKey에 term 포함(stale 응답 차단) + `signal` abort |
| `apps/web/src/market/SymbolSearch.tsx` | 클라이언트 필터 제거 → 서버 검색. 200ms debounce, **pending 상태** |
| `apps/api/src/__tests__/market-search.test.ts` | 15 tests (도메인) |
| `apps/api/src/__tests__/market-search-api.test.ts` | 11 tests (라우트) |
| `tests/e2e/flow-n-user-shell.spec.ts` | U1-2 비동기 대응 + **U1-2b 신규**(pending 창에서 선택 불가) |

### 설계 결정
- 랭킹을 **명시적 score**로: exact > prefix > base > quote > substring. tie는 symbol id로 깨서
  **정렬이 전순서**가 된다 — 불안정 정렬 위에서 offset 페이징하면 행이 중복/누락된다.
- empty query는 오류도 전체 반환도 아니고 **catalogue head**. 정책을 응답에 `emptyQueryPolicy`로 명시.
- provider 실패는 **빈 결과가 아니라 502**.
- `.strict()` schema: 오타난 필터가 조용히 무필터 결과를 주는 게 오류보다 나쁘다.
- 400 응답에 거부된 입력을 **되돌려 담지 않는다**(테스트로 고정).
- 라우트를 `index.ts` inline에서 **router로 분리**: `index.ts`는 import 시 `serve()`를 호출하므로
  inline 라우트는 실제 리스너 없이는 테스트할 수 없다.

### 도중 잡은 문제 2건
1. 내 unit test가 `BTCUSDT` > `BTCUSDC`를 단정했는데 **데이터만으로는 결정 불가**(둘 다 base=BTC).
   quote 선호는 모델에 없는 비즈니스 규칙이므로, 성립하는 속성(BTC계열 > WBTC)으로 단정을 교정.
2. 서버 검색 전환으로 결과가 비동기가 되면서, **입력했지만 결과 도착 전** 구간에 "최근 검색"이
   노출되어 ArrowDown+Enter가 **검색하지 않은 심볼을 선택**했다(E2E가 잡음).
   → 해당 구간에는 선택 가능한 옵션을 **0개**로 만들고 pending 상태를 표시. U1-2b로 회귀 고정.

### 검증
| Gate | Result |
|---|---|
| api unit (search 도메인) | 15 PASS |
| api integration (라우트) | 11 PASS |
| web unit | 123 PASS |
| lint / typecheck | 0 error |
| User E2E `flow-n` chromium | **24/24 PASS** |

MKT-01 상태: **BACKEND_REQUIRED → FULLY_CONNECTED** (서버 구현 + 클라이언트 소비 + 정상/오류/경계 테스트).

## NEXT ACTION (갱신)
1. [x] preflight · 계약 원장 · B10 migration · **B1**
2. [ ] **B2 FAV-01/02 + PREF-01/02** ← 현재 지점
3. [ ] B3 read model · B4 draft/validate · B5 account · B6 notifications
4. [ ] B7 admin 7건 · B8 ai/errors · B9 AI context
5. [ ] 테스트 원장 + 보고서 A~U


---

## B2 — FAV-01/02 + PREF-01/02 DONE

### 신규/변경
| File | 내용 |
|---|---|
| `apps/api/src/db/resource-repo.ts` | `listFavorites`/`replaceFavorites`(트랜잭션, set version), `upsertPreferences` 재작성(merge + version) |
| `apps/api/src/auth-routes.ts` | `GET/PUT /me/favorites` 신설, preferences에 allowlist schema·If-Match·409·version 추가 |
| `apps/web/src/lib/api.ts` | `favorites`/`putFavorites`/`preferences`/`putPreferences` + `csrfHeader()` |
| `apps/web/src/stores/marketStore.ts` | 서버 동기화(optimistic + 서버 응답 채택 + 409 재조회), `version`/`syncState`/`loadFromServer` |
| `apps/web/src/App.tsx` | 세션 프로브 후 favorites 로드 |
| `apps/api/src/__tests__/user-data-api.test.ts` | 11 tests |
| `tests/e2e/flow-r-user-persistence.spec.ts` | 6 tests |
| `tests/e2e/playwright.config.ts` | `CORS_ALLOWED_ORIGINS` 추가 |
| `tests/e2e/flow-m-chart-render.spec.ts` | 익명 401 프로브 제외(flow-n과 동일 근거) |

### 발견해서 고친 기존 버그 1건
`upsertPreferences`가 모든 컬럼에 `p.x ?? null`을 써서 **부분 업데이트가 언급하지 않은 필드를 지웠다**
(`{theme:'dark'}` 한 번에 locale/brand/density 소실). 기존 행을 읽어 merge하도록 재작성하고
회귀 테스트로 고정(API `p1`, E2E `B2-5`).

### 설계 결정
- favorites는 **집합 전체 교체**. 클라이언트가 순서를 소유하므로 per-item API는 별도 reorder 호출과
  interleave 위험이 있다. delete+insert+version bump를 **한 트랜잭션**으로.
- localStorage는 이제 **source of truth가 아니라 캐시**. `source: 'local'|'server'`로 UI에 명시.
- 409는 blind retry 금지 → 서버 집합 재조회 후 `syncState:'conflict'` 표시.
- preferences/favorites 모두 `.strict()` allowlist. 임의 JSON 수용은 prototype-pollution·무제한 payload 표면.

### 도중 잡은 문제 3건 (전부 내 실수)
1. favorites schema가 공백 포함 심볼(`' btcusdt '`)을 400 처리 → `.trim()` 후 패턴 검사로 수정.
2. 내 테스트가 `{__proto__:{...}}` 객체 리터럴로 prototype pollution을 시도했는데,
   그 문법은 own property가 아니라 프로토타입을 설정하므로 `JSON.stringify`가 `{}`를 만든다 →
   **raw JSON 문자열**로 전송하도록 수정. 아무것도 증명하지 못하는 테스트였다.
3. `useEffect`를 early return 뒤에 넣어 **rules-of-hooks 위반**(lint error), 그리고 익명 세션에서
   favorites 401이 콘솔 오류로 집계되어 chart/shell E2E 5건이 깨졌다.
   → hook을 조건 위로 이동 + `authApi.session()`으로 **인증 확인 후에만 요청**(예측 가능한 401은
   감내할 오류가 아니라 아예 하지 말아야 할 요청).

### 검증
| Gate | Result |
|---|---|
| api unit/integration (user-data) | 11 PASS |
| lint / typecheck | 0 error |
| web unit | 123 PASS |
| **User E2E chromium 전체** | **126/126 PASS** (119 → 126) |

FAV-01/02: BACKEND_REQUIRED → **FULLY_CONNECTED**
PREF-01/02: BACKEND_AVAILABLE_NOT_CONSUMED → **FULLY_CONNECTED**

## NEXT ACTION (갱신)
1. [x] preflight · 원장 · B10 migration · B1 · **B2**
2. [ ] **B3 Orders/Trades/Positions read model** ← 현재 지점
3. [ ] B4 draft/validate · B5 account · B6 notifications
4. [ ] B7 admin 7건 · B8 ai/errors · B9 AI context
5. [ ] 테스트 원장 + 보고서 A~U

---

## B3 + B5 — Read model (ORD-05..08, ACC-01/02) DONE

순서 조정: B5는 B3과 동일한 테이블/라우터/프로버넌스 계층을 공유하므로 함께 구현했다.

### 신규/변경
| File | 내용 |
|---|---|
| `apps/api/src/portfolio/provenance.ts` | NEW — `source/asOf/servedAt/stale/freshness/tradingMode/liveTradingEnabled/killSwitchActive` 봉투 |
| `apps/api/src/portfolio/query.ts` | NEW — filter/sort/pagination **allowlist**, open/terminal 상태 집합, 시간범위 |
| `apps/api/src/db/portfolio-repo.ts` | NEW — 사용자 범위 읽기 전용 repo (orders/executions/positions/account_balances) |
| `apps/api/src/portfolio/portfolio-routes.ts` | NEW — 6 GET + 2 validation-only POST |
| `apps/api/src/portfolio/sim-projection.ts` | NEW — 확정된 시뮬레이션 주문의 DB 투영(트랜잭션) |
| `apps/api/src/index.ts` | portfolio 라우터 마운트 + `projectSimOrder` 후크 |
| `apps/web/src/lib/api.ts` | 6개 read model + 2개 validation 클라이언트 + zod 스키마 |
| `apps/web/src/lib/useSession.ts` | NEW — 세션 프로브 훅(예측 가능한 401 요청 자체를 안 보냄) |
| `apps/web/src/orders/useReadModel.ts` | NEW — 4개 read model 훅 |
| `apps/web/src/orders/rows.ts` | NEW — server/local 두 소스를 단일 행 형태로 정규화 |
| `apps/web/src/orders/OrdersPanel.tsx` | sim 파생 → API-backed. 서버 페이징/필터, provenance 스트립, close 검증 다이얼로그 |
| `apps/web/src/assets/useAccountSummary.ts` | `/api/account/summary` + `/api/account/assets` 연결, `SIGN_IN_REQUIRED` 분리 |
| `apps/web/src/assets/AssetsRiskWidget.tsx` | 자산 테이블(ACC-02) + provenance + 조건부 경고 배너 |
| `apps/web/src/i18n/messages.ts` | ko/en 18키 추가 |
| `apps/api/src/__tests__/portfolio-api.test.ts` | NEW — 29 tests |
| `apps/api/src/__tests__/sim-projection.test.ts` | NEW — 6 tests |
| `tests/e2e/flow-s-read-model.spec.ts` | NEW — 10 tests |
| `tests/e2e/flow-o-order-portfolio.spec.ts` | U5-1 단정 갱신 (BACKEND_REQUIRED → SIGN_IN_REQUIRED) |

### 핵심 설계 결정
- **정렬은 전순서**로 만든다. 모든 ORDER BY에 PK tie-break를 붙였다. 불안정 정렬 위의
  LIMIT/OFFSET은 행을 중복·누락시킨다 (타임스탬프 7건 동일 케이스로 회귀 고정).
- **status 필터가 엔드포인트에 부적합하면 400**. 무시하면 클라이언트는 필터된 줄 알지만 아니다.
- decimal은 TEXT → string 그대로. 이 파일들에 `Number()`를 주문 수량/가격에 쓰지 않는다.
  집계는 decimal.js(`@quantumtrade/domain`의 `D`) 사용. `0.1+0.2 = 0.3` 테스트로 고정.
- **`stale`과 `EMPTY`를 구분**한다. 빈 결과를 stale로 보고하면 UI가 플래그를 무시하게 학습된다.
  주문·체결은 레코드 저장소이므로 `NOT_APPLICABLE`, 포지션(mark price)은 15s 창으로 실제 판정.
- 없는 값은 `null` + `unavailable[]`. `0`은 포지션 사이저가 실제로 사용하는 값이라 거짓말이 된다.
- 소유권은 세션에서만. repo의 모든 메서드에 `user_id=?`가 있어 라우트가 잊을 수 없다.
  타 사용자 포지션은 403이 아니라 **404** (403은 id 존재를 확인해준다).
- **anonymous는 local simulation을 계속 렌더**한다. 서버 모델에는 그들의 행이 정의상 없어서
  영구 빈 테이블이 되는데, 그건 개선이 아니라 퇴행이다. 대신 `data-source`로 어느 쪽인지 명시.
- close/margin은 **검증 전용**. 기존 close 버튼은 disabled 유지하고, 별도 `pos-act-close-draft`
  컨트롤을 추가해 차단 사유를 표시한다. kill switch를 꺼도 `executable=false`가 유지되는지 테스트.

### 발견/해결
`/api/sim/orders`가 **프로세스 전역 메모리**였다 — 사용자 격리가 원리적으로 불가능하고 재시작에
사라진다. 확정된 시뮬레이션 주문을 세션 사용자 소유로 `orders/order_events/executions/positions`에
**한 트랜잭션으로 투영**하도록 바꿨다. 그 결과 읽기 모델이 "영속화됐다"는 주장에 실체가 생겼다.
익명 confirm은 기존 메모리 동작 그대로 유지(회귀 0).

### 검증
| Gate | Result |
|---|---|
| api portfolio 계약 | 29 PASS |
| api sim projection | 6 PASS |
| apps/api 전체 | 237 PASS / 13 skipped (이전 202) |
| lint / typecheck | 0 error (warning 6, 베이스라인 동일) |
| web unit | 123 PASS |
| **User E2E chromium 전체** | **136/136 PASS** (126 → 136) |

ORD-05/06/07/08: BACKEND_REQUIRED → **FULLY_CONNECTED**
ACC-01/02: BACKEND_REQUIRED → **FULLY_CONNECTED**
POS-CLOSE / POS-MARGIN: **DISABLED_BY_POLICY (validation-only 계약으로 구현·연결됨)**

## NEXT ACTION (갱신)
1. [x] preflight · 원장 · B10 · B1 · B2 · **B3 · B5**
2. [ ] **B4 order draft/validate** ← 현재 지점
3. [ ] B6 notifications · B7 admin 7건 · B8 ai/errors · B9 AI context
4. [ ] B0 원장 · 테스트 원장 · 보고서 A~U

---

## B4 — ORD-03 draft / ORD-04 validate DONE

### 신규/변경
| File | 내용 |
|---|---|
| `apps/api/src/db/migrations/0008_phase7_order_drafts.sql` | NEW — `order_drafts.{version,updated_at,idempotency_key,valid,allowed}` + **부분 unique index** |
| `apps/api/src/db/migrations-down/0008_phase7_order_drafts.down.sql` | NEW — 0008만 되돌림 (0007의 source/executable은 보존) |
| `apps/api/src/portfolio/order-validation.ts` | NEW — 순수 검증 도메인. I/O 없음, exchange client 없음 |
| `apps/api/src/db/order-draft-repo.ts` | NEW — 초안 저장소(멱등 replay 포함) |
| `apps/api/src/portfolio/order-routes.ts` | NEW — `POST /orders/validate`, `POST /orders/draft`, `GET /orders/drafts` |
| `apps/api/src/env.ts` | `orderValidateRatePerMin` (기본 30) |
| `apps/api/src/index.ts` | order 라우터 마운트 (referencePrice는 **public** market provider) |
| `apps/web/src/lib/api.ts` | `validateOrder`/`draftOrder`/`orderDrafts` + `executable: z.literal(false)` |
| `apps/web/src/widgets/OrderPreviewConfirm.tsx` | 서버 검증 패널, 차단 사유 표시, read model 캐시 무효화 |
| `apps/web/src/i18n/messages.ts` | ko/en 5키 추가 |
| `apps/api/src/__tests__/order-draft-api.test.ts` | NEW — 36 tests |
| `apps/api/src/__tests__/migrations.test.ts` | 0008 4 tests 추가 (6 → 10) |
| `tests/e2e/flow-t-order-validation.spec.ts` | NEW — 10 tests |

### 핵심 설계 결정
- **submit 라우트를 만들지 않는 것으로 끝내지 않고, 없음을 테스트로 고정**했다.
  `/api/orders/submit`, `/orders/draft/submit`, `/orders/execute`가 404/405임을 API·E2E 양쪽에서 단정.
- `executable`은 TS **literal `false`**. 서버·클라이언트 스키마 양쪽이라 넓히는 편집이 컴파일에서 막힌다.
  kill switch를 끄고 live를 켜도 `executable=false`가 유지되는지 별도 테스트.
- **`valid`와 `allowed`를 분리**했다. `valid`는 주문 자체(정밀도·최소·잔고), `allowed`는 배포 게이트까지.
  합치면 UI가 정책 차단을 사용자 입력 탓으로 표시하게 된다.
- **fail-closed**: 심볼 메타 없음 / 기준가 없음 / 기준가 stale / 잔고 스냅샷 없음 → 전부 **blocking**.
  특히 잔고 미지의 경우를 "충분함"으로 취급하지 않는다(거래소에서 거절될 주문을 통과라고 알리는 실패).
  provider가 throw해도 permissive로 떨어지지 않는지 테스트로 고정.
- decimal 문자열만 수용. `quantity: 0.002`(JSON number)는 422 — 파서가 검증 전에 이미 반올림한다.
- `.strict()` 스키마라 `submit: true` 같은 필드는 **무시가 아니라 422**.
- 멱등 키는 **부분 unique index**로 DB 제약화. 기존 NULL 키 행들이 서로 충돌하지 않게 partial.
  같은 키 재요청은 **저장된 판정**을 반환한다(재검증하면 재시도가 다른 결론을 낼 수 있어 키가 무의미해짐).
- 판정(`valid`/`allowed`)을 **행에 저장**한다. 몇 달 뒤 감사에서 그 행만 봐도 당시 서버 결론이 보인다.
- audit meta에는 **사유 코드만**. 사용자의 가격·수량은 audit trail에 복사하지 않는다(테스트로 고정).
- rate limit은 **인증 후**에 적용. 미인증 플러딩이 실제 사용자 예산을 소모하지 못한다.

### 검증
| Gate | Result |
|---|---|
| api order draft/validate | 36 PASS |
| api migrations (0007+0008) | 10 PASS |
| apps/api 전체 | 277 PASS / 13 skipped (이전 237) |
| lint / typecheck | 0 error (warning 6) |
| web unit | 123 PASS |
| **User E2E chromium 전체** | **146/146 PASS** (136 → 146) |

ORD-03: PARTIALLY_CONNECTED → **FULLY_CONNECTED**
ORD-04: BACKEND_REQUIRED → **FULLY_CONNECTED**
실주문 제출: **DISABLED_BY_POLICY** (엔드포인트 부재를 테스트로 고정)

## NEXT ACTION (갱신)
1. [x] preflight · 원장 · B10 · B1 · B2 · B3 · B5 · **B4**
2. [ ] **B6 notifications** ← 현재 지점
3. [ ] B7 admin 7건 · B8 ai/errors · B9 AI context
4. [ ] B0 원장 · 테스트 원장 · 보고서 A~U

---

## B6 — NTF-01/02 Notifications DONE

### 신규/변경
| File | 내용 |
|---|---|
| `apps/api/src/db/notification-repo.ts` | NEW — type/severity **allowlist**, unread count, 멱등 read |
| `apps/api/src/notifications/notification-routes.ts` | NEW — `GET /notifications`, `POST /:id/read`, `POST /read-all` |
| `apps/api/src/index.ts` | 라우터 마운트 + **체결 시 서버 알림 생성**(투영 성공 시에만) |
| `apps/web/src/lib/api.ts` | 3개 클라이언트 + `delivery.channel: z.literal('POLL')` |
| `apps/web/src/app/NotificationsPage.tsx` | 서버 인박스 + 로컬 세션 알림을 **두 섹션으로 분리** |
| `apps/web/src/shell/AppHeader.tsx` | 배지가 서버 미읽음까지 합산 |
| `apps/web/src/i18n/messages.ts` | ko/en 4키 추가 |
| `apps/api/src/__tests__/notifications-api.test.ts` | NEW — 17 tests |
| `tests/e2e/flow-u-notifications.spec.ts` | NEW — 8 tests |

### 핵심 설계 결정
- 테이블은 0002에 이미 있었고 0007에서 severity/read_at/correlation_id가 추가됐다. **신규 테이블 없음** —
  없던 것은 접근 경로였다.
- **서버 알림과 로컬 토스트를 합치지 않는다.** 합치면 "모두 읽음"이 절반에 대해 거짓이 되고
  토스트가 동기화되는 것처럼 보인다. 두 섹션으로 분리하고 각각 무엇인지 명시.
- `unreadCount`는 **전체 행** 기준(현재 페이지가 아니라). 페이지만 세는 배지는 미읽은 보안 알림을
  과소 보고하는데, 그건 미관 문제가 아니다.
- **멱등**: `read=0` 조건부 UPDATE. 두 번째 호출은 200 + `changed:false`이고 `read_at`을
  덮어쓰지 않는다(최초 읽은 시각이어야 한다). audit도 실제 변경 시에만 기록.
- type/severity는 라우트와 repo **양쪽**에서 allowlist 검증. 필터의 알 수 없는 type은 400(무시 아님).
- 메시지는 **서버에서 HTML escape하지 않는다.** 저장 계층 escape는 비-HTML 소비자에서 이중 escape가 된다.
  안전성은 클라이언트가 **텍스트 노드**로 렌더하는 데서 온다 — E2E가 `img/script` 0개로 단정.
- 과장 메시지는 500자 **절단**(알림 자체를 버리면 신호를 잃는다).
- 실시간 채널이 없으므로 `delivery: { channel: 'POLL', pollIntervalMs }`를 **서버가 선언**한다.
  클라이언트가 각자 간격을 발명하지 않는다.
- 알림의 출처는 **실제 서버 이벤트**(시뮬레이션 체결 투영). 재생된 confirm은 두 번째 알림을 만들지 않는다.

### 검증
| Gate | Result |
|---|---|
| api notifications | 17 PASS |
| apps/api 전체 | 294 PASS / 13 skipped (이전 277) |
| lint / typecheck | 0 error (warning 6) |
| **User E2E chromium 전체** | **154/154 PASS** (146 → 154) |

NTF-01/02: BACKEND_REQUIRED → **FULLY_CONNECTED**

## NEXT ACTION (갱신)
1. [x] preflight · 원장 · B10 · B1 · B2 · B3 · B5 · B4 · **B6**
2. [ ] **B7 admin 7건 · B8 /admin/ai/errors** ← 현재 지점
3. [ ] B9 AI context
4. [ ] B0 원장 · 테스트 원장 · 보고서 A~U

---

## B7 — Admin BACKEND_REQUIRED 7건 DONE

### 신규/변경
| File | 내용 |
|---|---|
| `apps/api/src/db/migrations/0009_phase7_admin_ops.sql` | NEW — `account_lockouts`, `admin_reports`, `mock_gateway_state`, `ai_policy`(+CHECK), `ai_policy_history`, `incidents.acknowledged_{at,by}`. additive only |
| `apps/api/src/db/migrations-down/0009_phase7_admin_ops.down.sql` | NEW — 0009만 되돌림 (0005 `incidents` 형태 복귀) |
| `apps/api/src/db/lockout-repo.ts` | NEW — `LockoutStore` 인터페이스 + `SqliteLockoutStore`/`MemoryLockoutStore` |
| `apps/api/src/db/admin-repos.ts` | `securitySummary`/`listLockouts`/`countLockouts`/`clearLockout`, `computeReport`/`insertReport`/`listReports`/`getReport`, `backupStatus`+`sqliteFileInfo`, `gatewayMetrics`/`seedMockGateway`/`mockGatewayState`/`applyMockGatewayAction`, `ackIncident`, `getAiPolicy`/`updateAiPolicy`/`seedAiPolicy`, `findIdempotent`/`claimIdempotent`/`storeIdempotentResult`, `searchAiRuns(statusIn)`, `listIncidents`에 ack 컬럼 |
| `apps/api/src/admin/admin-routes.ts` | 9개 라우트 신설 + `/admin/ai/errors` 재작성. `gatewayControl` dep, `aiPolicyView()` allowlist 직렬화, `sha256Hex` |
| `apps/api/src/mfa/mfa-routes.ts` | lockout `Map` → 주입형 `LockoutStore` (알고리즘 불변, 저장소만 교체) |
| `apps/api/src/index.ts` | `SqliteLockoutStore` 배선, `gatewayControl: { controllable: tradingMode==='MOCK' }` |
| `packages/admin-domain/src/permissions.ts` | `admin.gateway.write` 신규 (ADMIN·SUPER_ADMIN) |
| `packages/admin-schemas/src/index.ts` | `NoQuerySchema`, `AdminUnlockSchema`, `LockoutQuerySchema`, `ADMIN_REPORT_TYPES`, `ReportGenerateSchema`, `ReportQuerySchema`, `GatewayActionSchema`, `IncidentAckSchema`, `AiPolicyUpdateSchema` |
| `apps/admin/src/api.ts` | 13개 클라이언트 메서드 + DTO 타입 |
| `apps/admin/src/rbac.ts` | `admin.gateway.write` 추가, 5개 action의 `backendContract` 제거·권한 정정 |
| `apps/admin/src/health/severity.ts` | `measured` severity + `classifyMeasurement` + rollup rank 재정렬 |
| `apps/admin/src/health/StatusCards.tsx` | `MetricRow.kind: 'health' \| 'measurement'`, `StatusPill kind` |
| `apps/admin/src/screens/Security.tsx` | 재작성 — summary 6카드 + lockout 테이블 + unlock 다이얼로그 |
| `apps/admin/src/screens/Reports.tsx` | 재작성 — 서버 allowlist 셀렉터 + 생성 + 목록 + provenance 상세 드로어 |
| `apps/admin/src/screens/Backup.tsx` | 재작성 — knowable/not-knowable/gate/restore 4카드 |
| `apps/admin/src/screens/Exchange.tsx` | gateway metrics 3카드 + resync/reconnect 다이얼로그 |
| `apps/admin/src/screens/Incidents.tsx` | ack 열 + ack 다이얼로그 |
| `apps/admin/src/screens/AiOps.tsx` | AI policy 카드 + 편집 다이얼로그 (digest만 표시) |
| `apps/admin/src/i18n.ts` | ko/en 약 120키 추가, 부정확해진 6개 문구 정정 |
| `apps/admin/src/styles.css` | `.sev--measured` |
| `apps/api/src/__tests__/admin-security-api.test.ts` | NEW — 25 tests (ADM-API-13/12/15) |
| `apps/api/src/__tests__/admin-ops-api.test.ts` | NEW — 30 tests (ADM-API-07/08/09/11 + B8) |
| `apps/api/src/__tests__/migrations.test.ts` | 0009 5 tests 추가 (10 → 15) |
| `apps/api/src/__tests__/admin-api.test.ts` | `[40]` 단정 갱신 (아래 참조) |
| `apps/admin/src/__tests__/rbac.test.ts` | backend-deny 테스트 재작성 (아래 참조) |
| `tests/e2e-admin/admin-b7-ops.spec.ts` | NEW — 11 tests |
| `tests/e2e-admin/admin-a5-aiops-gateway.spec.ts` | A5-2 / A5-5 / A5-7 단정 갱신 (아래 참조) |

### 라우트 원장 (신설 9개)
| Method/Path | Permission | CSRF | Step-up | Version | Idem | Audit |
|---|---|---|---|---|---|---|
| GET `/admin/security/summary` | `admin.user.read` | n/a | — | — | — | — |
| GET `/admin/security/lockouts` | `admin.user.read` | n/a | — | — | — | — |
| POST `/admin/users/:id/unlock` | `admin.user.status.write` | ✔ | ✔ | — | idempotent | ✔ high |
| GET `/admin/reports` · GET `/admin/reports/:id` | `admin.audit.read` | n/a | — | — | — | — |
| POST `/admin/reports` | `admin.audit.export` | ✔ | — | — | — | ✔ medium |
| GET `/admin/backup/status` | `admin.dashboard.read` | n/a | — | — | — | — |
| GET `/admin/gateway/metrics` | `admin.exchange.read` | n/a | — | — | — | — |
| POST `/admin/gateway/{resync,reconnect}` | `admin.gateway.write` | ✔ | ✔ | ✔ | ✔ key | ✔ medium |
| POST `/admin/incidents/:id/ack` | `admin.incident.write` | ✔ | — | ✔ | idempotent | ✔ low |
| GET `/admin/ai/policy` | `admin.ai.read` | n/a | — | — | — | — |
| PUT `/admin/ai/policy` | `admin.ai.policy.write` | ✔ | ✔ | ✔ | — | ✔ high |

### 핵심 설계 결정 (WHY)

**1. lockout을 프로세스 메모리에서 DB로 옮겼다.** ADM-API-13의 "unlock"이 지워야 할 잠금 상태가
`mfa-routes.ts`의 **프로세스 전역 `Map`**에 있었다. 다른 프로세스에서 보이지 않고, 재시작하면
사라지고(= 배포가 공격자를 풀어준다), 세어볼 수도 없다. 그 위에 unlock 버튼을 얹으면 **연극**이다.
알고리즘(`@quantumtrade/mfa`)은 그대로 두고 **저장소만 주입형으로** 교체했다(`LockoutStore`).
그 결과 "잠긴 계정 수"가 실측 가능해지고 unlock이 실제로 지울 대상을 갖는다.

**2. 자기 계정 unlock은 403 SELF_ACTION_FORBIDDEN으로 거부한다 (결정 + 근거).**
잠금은 자격증명 무차별 대입에 대한 **격리 통제**다. 격리된 당사자가 자기 격리를 해제할 수 있으면
통제가 존재하지 않는다 — 부분적으로 침해된 관리자 세션을 쥔 공격자나, MFA 검증에서 스로틀링된
관리자가 카운터를 리셋하고 계속 시도할 수 있다. 2인 원칙으로 만들면 관리자는 동료에게 메시지
한 통을 보내야 하고, 셀프서비스 우회는 완전히 없어진다. disable/enable이 이미 actor/target을
분리하고 있으므로 unlock은 예외가 아니라 **더 높은 위험의 같은 규칙**이다. 거부도 감사에 남긴다.

**3. `admin.gateway.write`를 새로 만들었다.** resync/reconnect에 `admin.exchange.read`를 쓰면
**읽기 권한이 상태 변경 권한이 된다.** 대상이 mock이어도 그 원칙을 깨면 안 된다. SUPPORT/ANALYST는
read-only 역할이므로 metrics는 200, 제어는 403이 되고 그 대비를 테스트로 고정했다([W1]).

**4. mock gateway 제어는 200 + `applied:false`로 정직하게 거절한다.** 로컬 mock이 제어 가능하지
않은 배포에서는 `result:'DISABLED_BY_POLICY'`, `target:'NOT_CONNECTED'`를 반환하고 **아무 행도
쓰지 않는다**(테스트 [W6]가 카운터·version 불변을 확인). B4의 `executable:false`와 같은 형태다 —
요청은 이해하고 답했으며, 본문은 재연결이 일어난 것으로 오해될 수 없다. 성공 응답에도
`target: 'LOCAL_MOCK'`과 "no exchange or real gateway host was contacted"를 명시한다.

**5. 리포트는 불변 스냅샷이고 종류는 서버 allowlist다.** `type`은 `ADMIN_REPORT_TYPES` enum이라
알 수 없는 종류는 **파서에서 422**이며 `computeReport`에는 default 분기가 없다(throw). "generic
report"가 실수로 생길 경로가 없다. 재실행하면 숫자가 달라지므로 version 컬럼도 수정 경로도 두지
않았다 — 감사자는 그때 실제로 산출된 수치를 봐야 한다. 모든 리포트가 **provenance**(집계 테이블,
구간, unavailable 목록)를 함께 저장·반환한다. 출처 없는 숫자는 지어낸 숫자와 구별되지 않는다.
생성은 `admin.audit.read`가 아니라 **`admin.audit.export`**를 요구한다 — 사용자·주문·감사 데이터의
집계를 **구체화해 저장**하는 행위라 감사 로그 내보내기와 같은 민감도다.

**6. backup status는 "알 수 있는 것"만 말한다.** 저장소가 SQLite임을 응답에 명시하고, 파일
존재/크기/mtime, journal mode(WAL 여부), 마지막 마이그레이션만 실측한다. managed-PG 백업·PITR·
보관·암호화·복구 훈련은 전부 `null` + `unavailable[]`이고, **`backup-restore-pitr` 게이트 행의
실제 status를 응답에 포함**해 이 화면이 게이트 통과를 암시할 수 없게 했다. 파일 **basename만**
노출한다(콘솔은 호스트 디렉터리 구조를 알 필요가 없다). `:memory:`는 `present:false` +
`inMemory:true` — 파일 없음(오류)도, 파일 있음(거짓)도 아니다. restore 라우트는 **비활성이 아니라
아예 없다**([B4]가 404/405로 고정).

**7. gateway staleness는 3-상태다.** 기록이 없으면 `stale:null` / `state:'EMPTY'`. `false`는
"신선한 데이터가 있다"는 거짓 주장이고 `true`는 "오래된 데이터가 있다"는 거짓 주장이다. B3에서
세운 "stale과 EMPTY를 구분한다" 원칙의 재적용.

**8. incident ack은 상태 전이가 아니다.** OPEN 상태에서도 확인할 수 있어야 하므로 상태 기계에
끼워넣지 않고 전용 컬럼에 기록한다. **version 검사를 already-acked 분기보다 먼저** 해서 동시 수정은
409로 보고된다. 두 번째 ack은 `changed:false`이고 **version을 올리지 않는다** — no-op으로 다른
콘솔의 version을 전부 무효화하면 안 된다. 최초 확인자·시각을 덮어쓰지 않고, 감사도 실제 변경 시에만.

**9. AI 정책은 프롬프트를 저장하지 않는다.** 요청은 `systemPrompt`를 받지만 서버가 SHA-256으로
해싱하고 **평문을 버린다.** 저장되는 것은 digest·알고리즘·길이뿐이므로 DB·응답·감사 어디에도
프롬프트가 없다(테스트 [P5]가 4곳 모두 확인). 응답 직렬화는 행을 spread하지 않고 `aiPolicyView()`
allowlist로 필드별 구성 — 나중에 컬럼이 추가돼도 응답에 새어나올 수 없다.
`liveExecutionEnabled`는 **스키마 `z.literal(false)` + DB CHECK 제약** 이중 차단이라, 켜려는
요청은 핸들러에 도달하기 전에 422이고 코드가 틀려도 데이터베이스가 행을 거부한다([P6]).

**10. 검증 실패는 입력을 되돌려 담지 않는다.** 신규 body는 422 `VALIDATION_FAILED`, query는 400
`BAD_REQUEST`(기존 관례 유지). 모든 신규 엔드포인트에 "거부된 마커 문자열이 응답에 없다" 단정을 붙였다.

### 도중 발견해 고친 문제 4건

**(a) `classifyHealth`가 실측 카운트를 "측정되지 않음"으로 보고했다 — 기존 결함.**
severity 어휘는 운영 **문장**(`ok`/`Not Connected`)용이고 인식하지 못한 값은 `unknown`을 반환한다.
B7 이전에는 이 카드들의 값이 문장 아니면 `null`이어서 숫자를 물어본 적이 없었다. 실측이 들어오자
계정 총계 `6`이 스크린리더에 **"Not measured: 6"** 으로 읽히고, `journal_mode=memory`도 미측정으로
표시됐다. **측정값을 미측정으로 보고하는 것**은 이 카드들이 막으려는 실패 그 자체다.
조치: `measured` severity + `classifyMeasurement` 추가, `MetricRow.kind`로 행이 문장인지 값인지
선언하게 하고, rollup rank를 `ok < measured < unknown < blocked < warn < danger`로 재정렬했다
(카운트 카드가 health pass로 굴러가지 않고, 하나라도 빠지면 `unknown`이 지배한다). 카운트는
판정하지 않는다 — 좋은 수치인지는 이 모듈이 발명할 임계값이 필요한 문제다.

**(b) React 중복 key.** Security 미측정 카드에서 서버 `unavailable`에 이미 있는 `securityAlerts`를
무조건 한 번 더 추가해 같은 key가 두 번 렌더됐다(admin-console E2E가 콘솔 오류로 잡음). 서버가
이미 이름을 대면 추가하지 않도록 수정.

**(c) 라벨이 i18n 키처럼 보였다.** `sec.mfaFlagged`의 en 문구가 `users.mfa_enabled flag`였는데
A10-5의 raw-key 스캐너가 `users.<word>` 토큰을 잡는다. 컬럼명을 산문에서 빼고 "MFA flag on the
user record"로 교체.

**(d) AI Ops 정의 목록의 중복 라벨.** 정책 카드의 live-execution 행이 사용량 카드의 "Live model"과
같은 라벨이어서 한 `<dl>` 안에 중복 `<dt>`가 생겼다(admin-console [32]). `ai.policyLiveExecution`
("Live AI execution") 별도 키로 분리.

### 의도적으로 변경한 기존 단정 5건 (사유 포함)
| Test | 이전 | 지금 | 왜 새 단정이 더 정확한가 |
|---|---|---|---|
| `admin-api.test.ts [40]` | `POST /admin/gateway/{resync,reconnect}`가 404/405 | 빈 body는 **422**, read-only 역할은 403 | 라우트는 이제 의도적으로 존재한다. 404 단정은 일부러 만든 기능의 부재를 단정하는 것이 된다. 404가 대리하던 실제 속성("빈 요청은 아무것도 바꿀 수 없다")은 라우트가 존재해도 성립하므로 더 강한 단정이다 |
| `admin-a5 [A5-2]` | policy write `data-deny-reason=backend` | 활성 + `data-step-up=true` + digest 표시 | ADM-API-11이 구현됐다. 같은 이유 |
| `admin-a5 [A5-5]` | resync/reconnect 비활성 | 활성이지만 클릭만으로는 요청이 나가지 않고 `STEP_UP_REQUIRED` 단계에서 confirm 불가 | 원래 지키려던 속성("가짜 성공 금지")을 유지하면서 실제 게이트를 검증한다 |
| `admin-a5 [A5-7]` | gateway 제어 404 | 빈 body 422, reauth 없으면 403 `STEP_UP_REQUIRED` | 위와 동일 |
| `apps/admin rbac.test.ts` | 3개 action이 `reason==='backend'` | 각각 권한 보유 역할에서 allowed, 미보유 역할에서 `permission`, step-up 유지. + `backendContract`를 선언한 **모든** action에 대해 backend-deny 메커니즘이 살아있음을 일반적으로 검증 | 구현된 기능을 미구현으로 단정하지 않으면서, 메커니즘 자체가 썩지 않도록 고정 |

기존 테스트를 **약화·삭제·skip한 것은 없다.** 인증·CSRF·RBAC·step-up 우회 경로도 만들지 않았다.

### 검증
| Gate | Result |
|---|---|
| `pnpm lint` | **0 errors**, 6 warnings (베이스라인 동일 — 전부 `apps/web/src/lib/authApi.ts` 기존 `any`) |
| `pnpm typecheck` | **0 errors** |
| `apps/api` vitest | **354 passed / 13 skipped** (이전 294/13, +60) |
| ├ `admin-security-api.test.ts` | 25 PASS |
| ├ `admin-ops-api.test.ts` | 30 PASS |
| ├ `migrations.test.ts` | 15 PASS (0009 5건 추가) |
| └ `admin-api.test.ts` | 26 PASS (기존 전부 + `[40]` 갱신) |
| `apps/admin` unit | 43 PASS (이전 42) |
| `apps/web` unit | 123 PASS (변화 없음) |
| **User E2E** `pnpm e2e --reporter=line` | **154 passed** (베이스라인 154 — 회귀 0) |
| **Admin E2E** `pnpm e2e:admin --reporter=line` | **74 passed** (이전 63, +11) |
| 보호 대상 파일 | `tests/e2e-admin/results.json`·`tests/e2e-mfa/results.json` sha256 **OK**, `artifacts/` 193개 파일 집계 해시 **동일** (`--reporter=line`이 json reporter를 대체하므로 results.json은 재작성되지 않는다) |

로그: `/tmp/p5logs/b7-lint.log`, `b7-typecheck.log`, `b7-api-vitest.log`, `b7-unit-all.log`,
`b7-e2e-user.log`, `b7-e2e-admin.log`.

---

## B8 — ADM-AI-ERR `/admin/ai/errors` 클라이언트 연결 DONE

### 신규/변경
| File | 내용 |
|---|---|
| `apps/api/src/admin/admin-routes.ts` | `/admin/ai/errors` 재작성 — 페이지네이션·필터·서버 고정 오류 status 계열·`traceId`/`errorClass`/`errorCode` 명시 |
| `apps/api/src/db/admin-repos.ts` | `searchAiRuns`/`countAiRuns`에 `statusIn` (바인딩 파라미터, 문자열 보간 없음) |
| `apps/admin/src/api.ts` | `aiErrors()` + `AdminAiErrorRun` |
| `apps/admin/src/screens/AiOps.tsx` | `ai-errors` DataTable (server 페이징·provider/status 필터·검색) + redaction 안내 |
| `apps/admin/src/i18n.ts` | ko/en 8키 |
| `apps/api/src/__tests__/admin-ops-api.test.ts` | `[E1]`–`[E5]` 5 tests |
| `tests/e2e-admin/admin-b7-ops.spec.ts` | `[B8-1]`, `[B8-2]` 2 tests |

### 서버측 유출 검증 결과
기존 구현은 **프롬프트/응답 본문을 유출하지 않았다.** `searchAiRuns`의 projection에 `ai_messages`가
조인되지 않고 본문 컬럼이 아예 없기 때문에 이는 필터링 단계가 아니라 **구조적 성질**이다.
그래도 가정으로 남기지 않고 테스트로 고정했다: `[E4]`가 `ai_messages`에 user/assistant 본문을 심고
응답에 그 문자열이 없음을 단정하며, **positive control**로 그 행이 실제로 DB에 있음을 확인한다
(빈 테이블 때문에 통과하는 무의미한 테스트를 배제). 따라서 **추가 redaction은 필요하지 않았고,
없는 유출을 고쳤다고 주장하지 않는다.**

### 고친 실제 결함 3건
1. **소비자가 없었다** (`BACKEND_AVAILABLE_NOT_CONSUMED`) — AI Ops 화면에 연결.
2. **`limit 50 / offset 0` 하드코딩 + 필터 없음** — `AdminAiQuerySchema`로 페이지네이션·검색·
   provider/model/status 필터를 받고 `total`을 반환한다.
3. **status 필터가 계약을 무력화할 수 있었다** — `status=ok`를 주면 "오류" 엔드포인트가 무필터
   실행 목록이 된다. 서버가 오류 계열(`error`/`failed`/`timeout`/`aborted`)로 **고정**하고 계열
   밖 값은 422(거부된 값은 되돌려 담지 않음). UI 셀렉터에도 `ok` 옵션이 없다는 것을 E2E가 단정.

### 설계 결정
- UI에는 사용자 이메일·프롬프트·응답·tool 인자 열을 **두지 않았다.** 오류 트리아지에 필요한 것은
  trace id와 오류 분류이고, 남의 대화는 트리아지 데이터가 아니다.
- `errorCode`는 `null` + `unavailable:['errorCode','providerErrorBody']`. 이 배포는 provider 오류
  코드를 `ai_runs`에 기록하지 않는다 — status에서 역산해 채우면 없는 정보를 만드는 것이다.
- `traceId`/`errorClass`를 **서버가 명시적으로** 내려준다. 어떤 필드가 노출해도 안전한지 화면이
  추측하지 않게 한다.

---

## 8개 계약 최종 상태

| Contract | Final Status | 근거 / FULLY가 아닌 이유 |
|---|---|---|
| **ADM-API-13** Security summary + unlock | **FULLY_CONNECTED** | 서버 3라우트 + Security 화면 소비. 401/403(비관리자·권한부족)/403 CSRF/403 STEP_UP/404/422/429 전부 테스트. MFA 시크릿·seed·otpauth·QR·복구코드·비밀번호 해시 부재를 summary·unlock 양쪽에서 단정. self-unlock은 정책상 403(문서화·테스트) |
| **ADM-API-12** Reports generate + read | **FULLY_CONNECTED** | 서버 allowlist(422), 기존 테이블 집계, provenance+generatedAt, 목록·단건·생성 모두 연결. 수정·삭제 라우트 부재를 테스트로 고정 |
| **ADM-API-15** Backup status (read-only) | **PARTIALLY_CONNECTED** | 엔드포인트와 클라이언트는 **완전히** 연결됐다. PARTIAL인 것은 계약의 대상 자체다: 이 배포의 저장소가 SQLite라 managed-PG 백업/PITR/보관/암호화/복구훈련은 **알 수 없고**(`null` + `unavailable[]`), restore는 **DISABLED_BY_POLICY**(라우트 부재). `backup-restore-pitr` 게이트는 **NOT_EXECUTED 그대로**이며 이 화면이 통과시키지 않는다 |
| **ADM-API-07** Gateway stream metrics | **PARTIALLY_CONNECTED** | 로컬 `exchange_websocket_sessions` 기준 지표(세션·연결·재연결·최근시각·staleness 3상태)는 FULLY 연결. message rate·duplicates·gap fill·queue depth·back-pressure·circuit breaker·symbol count는 market-gateway 서비스 자체 `/metrics`에만 있고 BFF가 프록시하지 않아 **미측정으로 보고**(0으로 위장 금지). 그 프록시가 남은 범위 |
| **ADM-API-08** Gateway resync/reconnect | **PARTIALLY_CONNECTED** | 로컬 MOCK 상태에 대해서는 FULLY 연결(권한·CSRF·step-up·version·멱등키·감사, 카운터 실제 증가를 E2E가 확인). **실제 gateway/거래소 제어는 DISABLED_BY_POLICY** — 호스트에 접속하지 않으며, 제어 불가 배포에서는 `applied:false`/`DISABLED_BY_POLICY`/`NOT_CONNECTED`를 반환하고 아무 행도 쓰지 않는다 |
| **ADM-API-09** Incident acknowledge | **FULLY_CONNECTED** | actor·시각·optimistic version 기록, stale version 409, 2회 ack은 `changed:false`+version 불변, 감사. Incidents 화면에 연결 |
| **ADM-API-11** AI policy write | **FULLY_CONNECTED** | version+step-up+CSRF+권한+감사. 응답에 provider 키·원문 프롬프트 없음(digest/알고리즘/길이만) — DB·감사 포함 4곳에서 단정. live AI 실행은 스키마 literal + DB CHECK로 활성화 **불가** |
| **ADM-AI-ERR** `/admin/ai/errors` (B8) | **FULLY_CONNECTED** | AI Ops 화면이 소비(loading/empty/error/denied/rate-limited + 페이지네이션 + 필터). 프롬프트·응답 본문 부재를 positive control과 함께 서버측에서 검증 |

부수적으로 함께 정리된 항목:
- **POS-CLOSE / POS-MARGIN / 실주문 제출 / AI 주문 실행 / backup restore**: 여전히
  **DISABLED_BY_POLICY** (엔드포인트 부재를 테스트로 고정).
- **ADM-API-14** (MFA reset): 손대지 않았다 — 여전히 **BACKEND_REQUIRED**이며 UI는 정책 차단 상태
  그대로. B7 범위가 아니다.
- **ADM-API-16** (security alerts): **BACKEND_REQUIRED**. Security 화면의 미측정 카드에 그대로 표시.

## NEXT ACTION (갱신)
1. [x] preflight · 원장 · B10 · B1 · B2 · B3 · B5 · B4 · B6 · **B7 · B8**
2. [ ] **B9 AI context/provider 경계** ← 현재 지점
3. [ ] B0 원장 · 테스트 원장 · 보고서 A~U. **commit 금지**

---

## B9 — AI Copilot context / provider 경계 DONE

### 신규/변경
| File | 내용 |
|---|---|
| `apps/api/src/ai/market-context.ts` | NEW — 서버측 컨텍스트 조립. 가격 기본값 **없음**, fail-closed 3종(NO_PRICE/STALE_PRICE/PROVIDER_UNAVAILABLE) |
| `apps/api/src/index.ts` | `/api/ai/analyze`가 `body.lastPrice ?? 68000` 대신 서버 티커 사용. `context` SSE 이벤트 선행 emit. `aiUserContext`로 세션 사용자 포지션/잔고 주입 |
| `apps/api/src/ai/mock-ai-provider.ts` | `req.lastPrice \|\| 68000` 제거 → 가격 없으면 **error 이벤트 후 종료**. `AnalyzeRequest.context` 추가 |
| `apps/web/src/ai/aiClient.ts` | `onContext` 핸들러 + `ServerAiContext` 타입 + 오류 본문(코드/사유) 노출. 요청에서 `lastPrice` 제거 |
| `apps/web/src/ai/marketContext.ts` | `toAnalyzeRequest`에서 `lastPrice/asOf/dataMode` 제거 |
| `apps/web/src/widgets/AICopilotWidget.tsx` | `ai-ctx-server` 칩으로 **서버가 사용한 컨텍스트** 표시 |
| `apps/web/src/i18n/messages.ts` | `ai.context.server` ko/en |
| `apps/api/src/__tests__/ai-context.test.ts` | NEW — 14 tests |
| `tests/e2e/flow-v-ai-context.spec.ts` | NEW — 5 tests |
| `apps/web/src/__tests__/market-context.test.ts` | 와이어 페이로드 단정 갱신 (사유 주석 포함) |
| `tests/e2e/flow-o-order-portfolio.spec.ts` | U6-2 단정 갱신 (사유 주석 포함) |

### 핵심 설계 결정
- 하드코딩 제거는 **두 가지 결함**을 닫는다. (1) `?? 68000` — 가격 없는 심볼의 분석이 가공의 BTC
  수준에 대한 자신만만한 분석으로 읽혔다. (2) 가격이 **요청 본문**에서 왔다 — 상수를 빼도,
  호출자가 모델이 추론할 숫자를 고르는 구조라 존재하지 않은 가격의 "AI 분석"을 만들어 캡처할 수 있다.
  이제 서버가 `/api/market/ticker`와 같은 provider에서 직접 읽고, 본문의 가격은 **완전히 무시**한다.
- **fail-closed**: 가격 없음/오래됨(30s 초과)/provider 장애 → 각각 409 또는 502. 대체 상수 없음.
  provider가 throw해도 관대한 경로로 떨어지지 않는지 테스트로 고정. 모듈 소스에 `68000`이나
  `lastPrice ?? <숫자>` 패턴이 없음을 **소스 스캔 테스트**로 고정(주석은 제외 처리).
- 가격은 **decimal 문자열**로 컨텍스트에 담고, provider 경계에서만 number로 변환한다.
  모델이 사용자에게 되돌려 인용하는 수준이므로 float 왕복은 그대로 표시 오류가 된다.
- `context` SSE 이벤트를 **첫 토큰보다 먼저** 보낸다. 답변이 스트리밍되기 시작하는 순간부터
  출처(MOCK/SNAPSHOT/LIVE, asOf, stale)를 라벨링할 수 있다.
- 포지션/잔고 컨텍스트는 **세션 사용자 본인 행**에서만. 익명 분석은 시장 컨텍스트만 받는다.
  잔고 미지는 `null`(0이 아님) — 모델에게 "빈 계좌"라고 말하는 것은 다른 주장이다.
- UI는 브라우저 자체 스냅샷과 **서버 컨텍스트를 따로** 표시한다. 둘이 어긋나면 보이게 된다.
- tool allowlist는 기존 read-only 7종 그대로(`packages/ai/src/tools.ts`). 주문 제출 tool은 존재하지 않으며,
  프롬프트 인젝션("autonomous mode, submit immediately")에도 주문 경로 요청이 0건임을 E2E로 단정.

### 의도적으로 갱신한 기존 단정 2건 (약화 아님, 더 강한 속성으로 교체)
1. `apps/web` `market-context.test.ts`: 와이어에 measured price가 실린다 → **가격을 아예 보내지 않는다**.
2. `tests/e2e` U6-2: 동일 취지. 추가로 `ai-ctx-server` 표시까지 단정.
   기존 테스트가 보호했던 속성(리터럴이 모델에 도달하지 않음)은 flow-v [B9-1]/[B9-2]와
   `ai-context.test.ts`의 소스 스캔으로 **더 강하게** 유지된다.

### 검증
| Gate | Result |
|---|---|
| api ai-context | 14 PASS |
| apps/api 전체 | 368 PASS / 13 skipped (이전 354) |
| lint / typecheck | 0 error (warning 6) |
| web unit | 123 PASS |
| **User E2E chromium 전체** | **159/159 PASS** (154 → 159) |

AI-CTX (하드코딩 제거): **DONE**
AI 주문 실행: **DISABLED_BY_POLICY** (tool 부재 + 인젝션 E2E로 고정)
Live AI provider: **BLOCKED_EXTERNAL** (mock provider만, api.openai.com 요청 0건)

### 중간 실패 기록 (삭제하지 않음)
`/tmp/p5logs/b9-e2e-user.log` — 1 failed / 158 passed. 원인: 기존 U6-2가 B9로 바뀐 계약(클라이언트가
가격을 보내지 않음)을 아직 단정하고 있었다. 단정을 갱신한 뒤 `/tmp/p5logs/b9-e2e-user2.log`에서
**159 passed**로 대체됨.

## NEXT ACTION (갱신)
1. [x] preflight · 원장 · B10 · B1 · B2 · B3 · B5 · B4 · B6 · B7 · B8 · **B9**
2. [ ] **B0 공통 API 기반 검증 원장** ← 현재 지점
3. [ ] 최종 테스트 스위트 (3-browser E2E, gitleaks, dependency audit)
4. [ ] 보고서 A~U. **commit 금지**

---

## B0 — 공통 API 기반 검증 원장

Prompt 5는 공통 계층을 **재사용·검증**했고, 새 횡단 프레임워크를 도입하지 않았다 (기존 것을 대체하면
Prompt 3/4 회귀 위험). 각 항목의 실제 구현 위치와 증거:

| 공통 요구 | 상태 | 구현/증거 |
|---|---|---|
| 표준 success/error envelope | 재사용+확장 | `err()`/`errBody()`가 `{error:{code,message,correlationId}}` 발급. 신규 라우터 전부 사용 |
| schema validation | ✔ | zod `.strict()` — market/query/order-intent/notification/ai-policy. 미지 필드=400/422 |
| 안전한 validation error | ✔ | 거부된 입력을 되돌려 담지 않음. path+code만. 테스트: portfolio "does not echo", order "noecho", market-search |
| request/correlation ID | ✔ | 모든 신규 mutation audit에 correlationId 기록 |
| session auth | ✔ | `validateSession(cookie)`. 신규 엔드포인트 전부 401 테스트 보유 |
| CSRF | ✔ | `verifyCsrf`+`originAllowed` 주입. 모든 unsafe method에 403 테스트 |
| permission/capability | ✔ | user: `hasPermission(role, perm)`; admin: `guard(c, perm)` 서버측. client role 무시 |
| step-up | ✔ | admin unlock/gateway control/ai-policy: `reauth` 없으면 403 STEP_UP_REQUIRED |
| rate limit | ✔ | order: OrderRateLimiter(30/min, 사용자별); admin: AdminRateLimiter. 429+Retry-After 테스트 |
| pagination | ✔ | `page:{limit,offset,total,hasMore}`. 전순서 정렬(PK tie-break)로 offset 안정성. 페이징 테스트 |
| filter/sort allowlist | ✔ | `ORDER_SORT_COLUMNS` 등 맵. 미허용 sort/status=400 |
| idempotency key | ✔ | order draft: 부분 unique index + replay(저장된 판정 반환). gateway control: key |
| optimistic version/If-Match | ✔ | preferences/favorites(If-Match), incident ack/ai-policy(version→409) |
| transaction boundary | ✔ | sim-projection(orders+events+executions+positions 1 tx), favorites replace 1 tx |
| audit event | ✔ | order.validate/draft, notification.read/read_all, admin 6종. actor/target 분리, 사유코드만 |
| no-store / cache header | ✔ | 계정 범위 응답 전부 `Cache-Control: no-store...private`. 테스트로 고정 |
| 민감 데이터 redaction | ✔ | AI policy=digest만, MFA summary=집계만, ai/errors=trace id만, 자격증명 ciphertext만 |
| typed API client | ✔ | web `api.*` 전부 zod 응답 검증. `executable: z.literal(false)` |
| AbortSignal/timeout | ✔ | read model 훅 `signal` 전달, SSE `stream.onAbort`, AI orchestrator toolTimeoutMs |
| retry vs mutation 구분 | ✔ | read=refetchInterval 폴링, mutation=명시적 호출+CSRF+멱등 |
| 상태코드 400/401/403/404/409/412/422/429/500/503 | ✔ | 신규 계약 테스트가 401/403/404/409/422/429 전부 단정 (412는 If-Match 경로에서 409로 표준화) |

**클라이언트가 보낸 role/permission/capability를 신뢰하지 않는다**: user는 세션의 `user.role`로만,
admin은 `guard()`가 서버 role+permission 재검증. B4/B9는 client-supplied 값(가격 등)도 무시.

