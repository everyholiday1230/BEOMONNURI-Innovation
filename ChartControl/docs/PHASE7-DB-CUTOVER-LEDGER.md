# PostgreSQL Runtime Cutover — Repository & Call-site Ledger (Batch 1/3)

Post-Phase 6 Remediation 1/3. HEAD 78c1cec. 추정치(118 메서드/124 호출부)를 실코드에서 재측정한 원장.
커밋/태그/push 없음. 이 문서는 3배치 컷오버의 기준선이다.

## 1. Repository 메서드 실측 (grep 기반)

| Repository | Domain | Methods | Sync/Async | Prod target | Migration/Table | Batch |
|---|---|---|---|---|---|---|
| SqliteUserRepository / PgUserRepository | auth account | 7 / (PG 존재) | **async** | PostgreSQL | users (0001) | **BATCH_1** |
| SqliteSessionRepository / PgSessionRepository | session, rotation, revocation | 7 / (PG 존재) | **async** | PostgreSQL | sessions (0001) | **BATCH_1** |
| SqliteAuditRepository / PgAuditRepository | auth/admin audit | 2 / (PG 존재) | **async** | PostgreSQL | audit_logs (0001) | **BATCH_1** |
| SqliteTokenRepository | email/reset tokens | ~8 | async | PostgreSQL | *_tokens (0001) | BATCH_1 |
| SqliteMfaRepo | MFA credential/challenge/recovery | 11 | **sync→async** | PostgreSQL | mfa_credentials/mfa_challenges (0006) | **BATCH_1** |
| LockoutStore (Memory/Sqlite) | account lockout counter/history | 2 (+impl 7) | **sync→async** | PostgreSQL | account_lockouts (0009) | **BATCH_1** |
| ResourceRepo | favorites/preferences/layouts/signals/order-drafts/overlays/conversations/sim-orders | 25 | sync | PostgreSQL | 0001/0002/0007 | BATCH_2 |
| PortfolioRepo | orders/trades/positions/balances (read) | 6 | sync | PostgreSQL | 0003 | BATCH_2 |
| OrderDraftRepo | order drafts (B4) | 6 | sync | PostgreSQL | 0002/0007/0008 | BATCH_2 |
| NotificationRepo | notifications | 5 | sync | PostgreSQL | 0002/0007 | BATCH_2 |
| SqliteCredentialRepo / SqliteIdempotencyStore | exchange credentials, idempotency | 9 | mostly sync | PostgreSQL | 0003 | BATCH_2 |
| SqliteAdminRepo | admin ops/reports/flags/gates/incidents/kill/gateway | 59 | sync | PostgreSQL | 0005/0009 | BATCH_3 |
| SqliteConversationRepo / SqliteUsageRepo | AI conversations/usage/policy | 10 | async(SQLite) | PostgreSQL | 0004/0009 | BATCH_3 |

**측정 합계**: repo 메서드 ≈ **128** sync/async-sqlite (auth 24 async + mfa 11 + lockout 7 + resource 25 + portfolio 6 + order-draft 6 + notification 5 + admin 59 + ai 10 + trading 9). 추정 118과 근사(추정은 auth/ai async 제외 기준). PG 구현 존재: pg-repos 19(User/Session/Audit).

## 2. Call-site 실측 (도메인별 repo/service 호출 참조)

| Route file | repo/service refs | 비고 |
|---|---|---|
| auth-routes.ts | 39 | AuthService(async) + resource(sync) + mfa gate |
| mfa/mfa-routes.ts | 22 | mfaRepo(sync) + lockout(sync) |
| portfolio/portfolio-routes.ts | 10 | portfolio/resource(sync) — Batch 2 |
| portfolio/order-routes.ts | 6 | drafts/portfolio(sync) — Batch 2 |
| notifications/notification-routes.ts | 5 | notification(sync) — Batch 2 |
| admin/admin-routes.ts | 85 | adminRepo(sync) — Batch 3 |
| ai-routes.ts | 9 | conversations/usage(async) — Batch 3 |
| index.ts (sim projection 등) | 12 | 혼합 |
**총 참조 ≈ 188** (auth/ai는 이미 async, 순수 sync 전환 대상은 mfa/lockout/resource/portfolio/order-draft/notification/admin/trading). 추정 124(sync 호출부)와 정합.

## 3. Batch 분류 수
- BATCH_1_CORE_IDENTITY: auth(users/sessions/audit/tokens) + MFA + account_lockout — **repo 5계열 / 메서드 ~51 / 호출부 auth 39 + mfa 22 = 61**
- BATCH_2_USER_TRADING: resource + portfolio + order-draft + notification + trading — 메서드 ~51 / 호출부 ~33
- BATCH_3_ADMIN_OPERATIONS: admin + ai + AI policy + gateway state — 메서드 ~69 / 호출부 ~106
- NOT_PERSISTENT: in-process rate-limit(→Redis, R6), sim order-engine in-memory(익명), ephemeral CSRF key
- DEV_ONLY: dev seed, MemoryLockoutStore/MemorySessionRepository
- UNKNOWN: 0

## 4. State Ownership Matrix (Batch 1) — 기존 Phase 2/6/7 설계 준수, 신규 정책 없음

| State | Current | Production store | Consistency | TTL | Multi-instance | Failure policy | 근거 |
|---|---|---|---|---|---|---|---|
| User account | SQLite users | **PostgreSQL** (users) | strong | n/a | 필수 | fail-closed | PgUserRepository 존재, 영구 identity |
| Session + rotation/revocation | SQLite sessions | **PostgreSQL** (sessions) | strong | expiry | 필수 | fail-closed | Phase 2 설계=관계형 sessions 테이블, PgSessionRepository 존재 (Redis session은 기존 arch에 없음) |
| MFA credential/challenge/recovery | SQLite mfa_* | **PostgreSQL** (mfa_credentials/mfa_challenges) | strong | challenge expiry | 필수 | fail-closed | 0006, secret AES-GCM 암호화 at rest |
| Account lockout counter + history | SQLite account_lockouts | **PostgreSQL** (account_lockouts) | strong | locked_until | 필수 | fail-closed | Prompt 5 B7이 Map→SQLite 영속화(0009); 기존 설계가 영속 테이블 |
| Login/MFA **request-rate** throttle | in-process Map | **Redis/Valkey** (distributed limiter) | strong(atomic INCR) | window | 필수 | fail-closed(deny) | R6 분산 limiter; 다중 인스턴스 우회 차단 |
| Auth audit | SQLite audit_logs | **PostgreSQL** (audit_logs) | strong | n/a | 필수 | fail-closed | PgAuditRepository 존재 |

**결정**: 영구 identity/session/MFA/lockout 상태는 전부 **PostgreSQL**(기존 관계형 설계). Redis/Valkey는 **분산 request-rate 제한 역할만**(R6에서 구현). 단기 session을 Redis로 옮기는 것은 기존 arch에 없으므로 하지 않는다(임의 신규 정책 금지 규칙 준수).

## 5. Production Guard 정책 (Batch 1)
registry는 Batch 1 완료분만 반영: auth/mfa/account_lockout → postgres/ready(프로덕션 factory가 PG 선택), 나머지(favorites/preferences/notifications/order_drafts/admin_operations/gateway_state/ai_policy) → sqlite/not-ready. **부분 완료로 전체 productionReady=true 금지** → Production 기동 계속 거부(Batch 2/3 미완). 전체 해제는 Batch 3 마지막에만 판단.

---

## Batch 1 구현 결과 (검증 완료 — 커밋 없음, HEAD 78c1cec)

### 전환한 repository / State Ownership (확정)
| Domain | 인터페이스 | dev/test | production | 상태 |
|---|---|---|---|---|
| Auth users/sessions/audit | 기존 async | Sqlite* | **Pg*** (factory 선택) | 연결 |
| MFA credential/challenge/recovery | **IMfaRepo (async)** | SqliteMfaRepo(async 래핑) | **PgMfaRepo** | 연결 |
| Account lockout | **LockoutStore (async)** | Sqlite/Memory | **PgLockoutStore** | 연결 |
| Login/MFA request-rate throttle | RateLimiter | InMemory | Redis(fail-closed) | 실경로 연결 |

- Repository factory(`db/repository-factory.ts`): backend를 **서버가 NODE_ENV+DATABASE_URL로만 결정**, 클라이언트 입력 불가, **production SQLite fallback 없음(postgres:// 아니면 시작 throw)**, 실제 wired backend를 descriptor로 guard에 보고.
- Session은 기존 arch대로 **PostgreSQL**(관계형 sessions), Redis로 이전하지 않음.

### 변경 파일 (CORE_DB_CUTOVER_CHANGES) — 서브에이전트 작성분, 제가 검증
수정: db/mfa-repo.ts, db/lockout-repo.ts, db/pg-repos.ts, db/pg.ts, env.ts, index.ts, auth-routes.ts, mfa/mfa-routes.ts, security/rate-limiter.ts, __tests__/{mfa-api,admin-security-api,favorites-contract,postgres-phase67.integration,postgres.integration}.test.ts. 신규: db/repository-factory.ts, __tests__/{repository-factory,auth-repo-contract,mfa-lockout-contract,login-mfa-rate-limit}.test.ts, __tests__/helpers/pg-test-db.ts. + e2e config 2건(login/MFA rate-limit test-only 상향) + AuthPages.tsx + i18n/messages.ts(BL-12), docs 원장.

### 검증 (직접 실행)
| Gate | 결과 |
|---|---|
| lint / typecheck | 0 error / 0 error |
| apps/api vitest 전체 | **467 PASS / 39 skip** |
| 임시 PG: mfa-lockout-contract / auth-repo-contract / phase67 / legacy / favorites | 38 / 29 / 11 / 12 / 10 PASS (SQLite+PG 동일 계약, FK/UNIQUE/CHECK/ownership/optimistic/tx rollback/concurrent/restart) |
| 임시 Redis: login-mfa-rate-limit / rate-limiter / rate-limit-http | 26 / 15 / 3 PASS (atomic/TTL/namespace/multi-instance shared/reconnect/timeout/outage fail-closed/rediss/credential redaction) |
| Auth/persistence E2E (Chromium): flow-k-auth + flow-r | 7 PASS |
| MFA E2E (Chromium, e2e:mfa) | **18/18 PASS** (BL-12 i18n 수정 후) |
| gitleaks + negative-control / prod audit | 0 findings + PASS / 0 vuln |

**Batch 1 targeted Chromium E2E: EXECUTED / PASS (Auth 7/7 + MFA 18/18 = 25/25)**(auth/login/MFA challenge·verify/session/rate-limit 429+Retry-After/enumeration 비노출/lockout — mfa-lockout-contract 38 + login-mfa-rate-limit 26이 백엔드 핵심 커버).
**Batch 1 full 3-browser E2E: DEFERRED_TO_BATCH_3** — 변경 범위가 Backend Auth/MFA/Rate-limit 한정, API·PG·Redis 계약으로 핵심 검증. Final release gate impact: 없음(Batch 3에서 전체 3-browser 필수).

### BL-12 (P2) — MFA recovery i18n mismatch: RESOLVED (앱 수정, 우회 아님)
MFA challenge의 하드코딩 영문(`TOTP`/`Recovery code`, placeholder, aria-label `mfa-code`)을 i18n 키로 이관: `mfa.challenge.{totpPrompt,recoveryPrompt,useRecovery,useTotp}` (ko/en). recovery 모드에서 visible prompt/aria-label/placeholder가 로케일 일치로 전환(ko '복구 코드를 입력하세요' / en 'Enter your recovery code'), TOTP와 recovery 입력 구분. 테스트 assertion 삭제·영문 우회 **안 함** — 앱을 고침. web unit 123 PASS, en/ko 키 완전(typecheck).

### Production guard 상태 (해제 안 함)
registry가 실제 wired backend를 검사: dev/e2e는 전부 SQLite → production이면 기동 거부. production factory는 auth/mfa/account_lockout을 postgres/ready로 선택하나 나머지(favorites/preferences/notifications/order_drafts/admin_operations/gateway_state/ai_policy)는 sqlite/not-ready → **assertProductionRepositoryReadiness가 계속 throw(기동 거부)**. 부분 완료로 전체 productionReady=true 금지. 전체 해제는 Batch 3 마지막에만 판단.

### 남은 작업
- BL-10 잔여: BATCH_2(resource/portfolio/order-draft/notification/trading ~51 메서드/~33 호출부), BATCH_3(admin/ai ~69 메서드/~106 호출부) PG 컷오버.
- BL-11 잔여: AI 경로 분산 제한(order/admin/login/MFA는 연결 완료).
- BL-12: **RESOLVED** (MFA recovery i18n ko/en).

### 상태 요약
시작/종료 HEAD 78c1cec(불변, commit/tag/push 0) · 보호 artifact 32 보존(fingerprint 94be031b) · 임시 PG/Redis 컨테이너 제거(타 프로젝트 7개 보존) · Live/AWS/Terraform 0 · Stage 0 BLOCKED · Production Readiness BLOCKED · **Batch 2 진입 가능: YES**(Batch 1 core identity 검증 완료).

---

## Batch 2 구현 결과 (검증 완료 — 커밋 없음, 시작 HEAD 5ddc4d9)

### 대상 분류 (실코드 조사)
| Domain | 분류 | 조치 | Required guard ID |
|---|---|---|---|
| Favorites (+set version/meta) | PERSISTENT | PostgreSQL 연결 (async 계약) | ✅ favorites |
| User preferences (+optimistic version) | PERSISTENT | PostgreSQL 연결 (신규 repo) | ✅ preferences |
| Notifications (+read/unread state) | PERSISTENT | PostgreSQL 연결 (async 계약) | ✅ notifications |
| Order drafts (B4 검증 intent+verdict) | PERSISTENT | PostgreSQL 연결 (async 계약) | ✅ order_drafts |
| Trading read model (orders/trades/positions/balances) | SNAPSHOT/MOCK | 신규 DB 없음. MOCK sim projection 기반, source-tagged, PortfolioRepo 유지 | — (guard 비필수) |
| Account/assets/risk snapshot | SNAPSHOT | provenance/asOf/stale 표시 read model, 권위 상태 아님 → 영속 DB 신설 안 함 | — |
| Layout/server sync | PERSISTENT(supplemental) | 레거시 ResourceRepo 유지(required ID 아님). PG 테이블(0001 layouts) 존재, Batch 3 후보 | — |
| AI usage/budget, conversation metadata | PERSISTENT(ai_policy 도메인) | Batch 3(ai_policy)로 이월. Batch 2는 AI **요청 rate-limit**만 연결 | — (Batch 3) |
| Market catalog/search | NON_PERSISTENT | 외부/정적 데이터 — 강제 영속화 안 함 | — |

### Repository ID / Method / Route / Backend / Call-site / Tx / Ownership / Idempotency / Decimal
| Repo ID | Methods | Route | dev/test→prod | Call-sites | Tx | Ownership | Idempotency | Decimal |
|---|---|---|---|---|---|---|---|---|
| favorites | list, replace | GET/PUT /api/me/favorites | Sqlite→**Pg** | 2 | replace=1 tx(FOR UPDATE) | user_id 모든 문장 | version(If-Match) | N/A(symbol) |
| preferences | get, upsert | GET/PUT /api/account/preferences | Sqlite→**Pg** | 2 | upsert=1 tx(FOR UPDATE) | user_id | version(If-Match) | N/A(scalar allow-list) |
| notifications | list, markRead, markAllRead, create | GET /api/notifications, POST :id/read, read-all (+서버 projection create) | Sqlite→**Pg** | 4 (route 3 + projection 1) | 단문 원자 | user_id 모든 문장(타인 id=404) | markRead read=false 조건(중복=200 no-op) | N/A(text) |
| order_drafts | create, getByIdempotencyKey, getOwned, listOwned, countOrdersSince | POST /api/orders/draft, GET /api/orders/drafts | Sqlite→**Pg** | 4 | idem partial-unique + 23505 replay | user_id 모든 문장 | idempotency_key 유니크(재시도=저장 verdict 반환) | data JSONB, executable=0 강제 |
| (AI rate-limit) | RateLimiter.allow | POST /api/ai/copilot | InMemory→**Redis** | 1 | — | key=ai:copilot:userId (prompt/PII 없음) | — | — |

### 변경 파일 (CORE_DB_CUTOVER_CHANGES) — 비보호 25개
신규(3): db/preferences-repo.ts, __tests__/user-data-contract.test.ts. 수정(다수): db/notification-repo.ts, db/order-draft-repo.ts, db/repository-factory.ts(createUserDataRepositories+BATCH_2_REPOSITORY_IDS), auth-routes.ts(favorites/preferences deps·async), notifications/notification-routes.ts(async), portfolio/order-routes.ts(drafts async), ai-routes.ts(분산 limiter 게이트), env.ts(aiRateLimitPerMin), index.ts(userData factory·descriptor·주입·projection await), __tests__/repository-factory.test.ts(Batch2 factory·guard), ai-api.test.ts(AI 429), 그 외 auth router 생성 테스트 13개 파일(favorites/preferences 주입), notifications-api·order-draft-api·rate-limit-http(Sqlite 어댑터).

### 검증 (직접 실행)
| Gate | 결과 |
|---|---|
| typecheck / lint | 0 error / 0 error·6 warn(기존) |
| apps/api vitest (SQLite) | **489 PASS / 39 skip** (Batch1 467 + 신규 22: user-data-contract 12·AI rate-limit 2·Batch2 factory/guard 8) |
| 임시 PG contract/integration (6파일) | **124 PASS** — user-data-contract(preferences/notifications/order_drafts PG), favorites, mfa-lockout, auth-repo, phase67 parity(0006–0009 down/up), legacy integration. FK/UNIQUE/CHECK/index·tx rollback·partial-patch·optimistic version·idempotency replay·ownership·decimal·restart |
| 임시 Redis limiter (3파일) | **44 PASS** — atomic/TTL/namespace/multi-instance 공유/outage fail-closed/timeout/reconnect/rediss/credential redaction |
| web unit | 123 PASS |
| gitleaks + prod audit | 0 findings / 0 vuln |
| Targeted Chromium E2E | flow-r/s/t/u **34 PASS** (favorites·preferences persist, read model, order draft/validate, notifications), flow-k-auth 1, MFA 18/18 — 회귀 0 |

**Batch 2 targeted Chromium E2E: EXECUTED / PASS.** AI 429/recovery는 ai-api.test.ts에서 검증(거부→429+Retry-After, 허용→진행). 전체 3-browser는 Batch 3 최종 게이트로 연기.

### Production guard (해제 안 함)
Batch 1+2 도메인만 postgres/ready로 광고. registry가 실제 wired backend 검사: dev/e2e 전부 SQLite → production 기동 거부. production factory는 favorites/preferences/notifications/order_drafts를 postgres로 선택하나 **admin_operations/gateway_state/ai_policy(Batch 3)** 는 sqlite/not-ready → **assertProductionRepositoryReadiness 계속 throw**. 테스트로 증명: Batch1+2 postgres여도 throw, offenders=정확히 {admin_operations, ai_policy, gateway_state}, Batch2 일부 SQLite→throw, no-env-bypass. productionReady=true 금지 유지. **production SQLite fallback 0**(pool 없으면 생성 시 throw).

### 남은 작업
- BL-10 Batch 3: admin_operations, gateway_state, ai_policy PG 컷오버 + 전체 3-browser PG E2E + guard 해제 판정.
- BL-11 잔여: 없음(order/admin/login/MFA/AI 모두 분산 limiter 연결 완료). AI repo(usage/conversation) PG는 ai_policy 도메인으로 Batch 3.
- Layout server-sync PG 연결(supplemental, required 아님) — Batch 3 후보.

### 상태 요약
시작 HEAD 5ddc4d9(불변, commit/tag/push 0) · 보호 artifact 32 보존(fp 94be031b) · 비보호 변경/신규 25 · 임시 PG/Redis 제거(타 프로젝트 7 보존) · Live/AWS/Terraform 0 · TRADING_MODE=MOCK·executable=false·kill-switch ACTIVE 유지 · Stage 0 BLOCKED · Production Readiness BLOCKED · Production guard ACTIVE · **Batch 3 진입 가능: YES**.

---

## Batch 3 구현 결과 (검증 완료 — 커밋 없음, 시작 HEAD 6abe668)

### 전환 대상 (required guard ID 3개, 단일 repo가 3 도메인 담당)
| Repo ID | Methods | Route surface | dev/test→prod | Call-sites | Tx/Optimistic | Ownership/RBAC/Idempotency | Live 안전 |
|---|---|---|---|---|---|---|---|
| admin_operations | audit(record/list/count)·users(search/get/status/role/revoke)·flags·kill·incidents(+ack)·gates(+evidence)·security summary·lockouts(list/count/clear)·reports(compute/insert/list/get)·backup status | 38 admin routes | SqliteAdapter→**PgAdminRepo** | 84 await | FOR UPDATE + version; feature_flag/kill/incident/gate/lockout/policy 낙관적 충돌 | 세션 유래 actor, RBAC guard, step-up, IDOR 404, idempotency_records | 주문 write 경로 0(read-only) |
| gateway_state | seed/mockGatewayState/applyMockGatewayAction(resync·reconnect)/gatewayMetrics/gatewaySummary | /admin/gateway/* | 동상 | (상동) | resync/reconnect 낙관적 version + idempotency-key replay | provenance MOCK/Not Connected, 실 BitMart 0 | resync=로컬 상태 전이만 |
| ai_policy | seed/getAiPolicy/updateAiPolicy/countAiPolicyHistory | /admin/ai/policy | 동상 | (상동) | 낙관적 version 충돌 + history 원자적 insert(1 tx) | super-admin+step-up+CSRF, prompt digest만 저장 | **live_execution_enabled=0 (DB CHECK), 실 OpenAI 0** |

- 단일 `SqliteAdminRepo`(sync 엔진, 불변) 위에 **`IAdminRepo`(async) + `SqliteAdminRepoAdapter`(dev/test) + `PgAdminRepo`(prod, ~58 메서드)**. admin-owned 테이블(0005/0009)=BIGINT epoch-ms + BOOLEAN(→`::int` 정규화로 SQLite와 동일 형태), 교차도메인(orders/positions/ai_runs/ai_usage/sessions/audit_logs 등)=TIMESTAMPTZ(→`to_timestamp($/1000)`/`EXTRACT`), jsonb(before/after/result). 공통 `core.pool` 재사용(중복 클라이언트 없음), **prod SQLite fallback 0**(pool 없으면 throw).

### Layout server-sync 판정: **DEFERRED_P2**
Layout(`/me/layouts`, ResourceRepo layouts/layout_versions)는 required production-guard ID가 아니고 Batch 3 핵심(admin/gateway/ai_policy) PG 전환과 무관. dev/test에서 기능 동작(레거시 ResourceRepo). PG 테이블(0001 layouts)은 존재하나 런타임 async/PG 계약 미연결 → 범위 억지 확장 대신 **DEFERRED_P2**로 문서화.

### 검증 (직접 실행)
| Gate | 결과 |
|---|---|
| typecheck / lint | 0 error / 0 error·6 warn(기존) |
| apps/api vitest (SQLite) | **512 PASS / 39 skip** (Batch2 489 + 신규 23: admin-ops-contract 12 SQLite + Batch3 factory/guard 11) |
| 임시 PG 전체 계약/integration (8파일) | **163 executions PASS** — admin-ops-contract **24 executions = 12 unique cases 각 SQLite+PostgreSQL**(그중 PostgreSQL 전용 12 PASS) + user-data 24(12 unique×2) + favorites 10 + mfa-lockout 38 + auth-repo 29 + phase67 parity 11 + legacy 12 + migrations(clean/upgrade 0005→latest/down/parity/mismatch fail-closed) 15. **혼용 주의: 'admin-ops-contract PG 12'(PostgreSQL 전용) ≠ '24'(SQLite+PG 합계 executions).** |
| 임시 Redis limiter (3파일) | **44 PASS** |
| Production Guard 전체 registry | 전부 postgres/ready → **로컬 production-mode startup 허용(no throw)**; admin_operations/gateway_state/ai_policy 각 SQLite→거부, 누락→거부, not-ready→거부, dev SQLite 허용, env boolean 우회 불가 |
| BL-11 최종 재검증 | Login/MFA/Order/Admin/AI 전 경로 공통 limiter; prod Redis 강제(createRateLimiter REDIS_URL 없으면 throw), rediss:// TLS, FailClosed(장애 시 deny), atomic/shared/namespace/429/Retry-After/TTL/reconnect/timeout/redaction, InMemory fallback 0 |
| web unit | 123 PASS |
| gitleaks + negative-control / prod audit | 0 findings + PASS / 0 vuln |
| **User E2E 3-browser** (Chromium/Firefox/WebKit, retries=2) | **477 PASS / 0 fail / 0 flaky** |
| **Admin E2E 3-browser (retries=0, prebuilt)** | **222/222 PASS / 0 fail / 0 flaky** (Chromium 74 + Firefox 74 + WebKit 74) — §BL-13 근본원인 수정 후 |

### BL-13 — Admin E2E 실패: 근본원인 규명 및 RESOLVED
**최초 증상**: `loginAdmin`의 admin shell(`admin-topbar`/nav[name=admin]) 10s timeout. 실패 수가 런마다 변동(직렬 22, 3-browser retries=2 후 19), 각 spec 단독은 통과.

**근본원인(확정)**: `loginAdmin`은 **모든 테스트에서 admin@qt.local로 재로그인**(admin suite 74 로그인, 동일 IP). Batch 1에서 실경로 연결한 **분산 LOGIN limiter**(기본 10/분, IP 버킷은 성공 시 리셋 안 함=설계상 정상)가 한 60초 창에서 ~10회 초과 로그인을 **429**로 막음 → 로그인 실패 → admin shell 미렌더 → `loginAdmin` timeout. 런이 진행될수록 분당 로그인 누적으로 실패 증가(관측 패턴 일치: b7-ops 전체 실패, a4 앞부분 실패, a10 마지막만 실패). **cold-compile 아님**(prebuilt preview 서버로도 재현됨 — 아래 실험).

**baseline 차이 정규화**: 최초 22(직렬)/19(3-browser)는 동일 failure signature(전부 `loginAdmin` shell-ready timeout, 원인=login 429). 개수 차이는 60초 rate-limit 창 경계에 어떤 로그인이 걸리는지의 변동일 뿐. Batch 3만/Batch 2만 고유 실패 없음(공통 원인). admin E2E는 Batch 1/2 검증에 미포함이라 이때 처음 표면화(원인은 Batch 1부터 존재, admin config에만 test-quota 상향 누락).

**수정(리뷰어 허용 범위, 보안 우회 아님)**:
1. admin E2E API env에 `LOGIN_RATE_LIMIT_PER_MIN=100000`, `MFA_RATE_LIMIT_PER_MIN=100000` (user/mfa 스위트가 Batch 1에 이미 적용한 것과 동일한 isolated test-only quota). **Production 기본값 10/분 불변**, dedicated limiter 유닛/통합 테스트가 낮은 한도로 429/Retry-After/fail-closed를 독립 검증.
2. admin 앱을 **prebuilt `vite preview`**(build→preview)로 서빙 — request-time 컴파일 제거(코드분할 라우트 cold-compile 변수 제거). `apps/admin/vite.config.ts`에 preview(port+/api proxy) 블록.
3. `global-setup.ts` — API `/health` + admin shell 사전 워밍업(server-ready budget 60s, **assertion timeout 10s와 분리**). reuseExistingServer=false(테스트 전용 서버 격리). workers=1 유지.
- **금지 변경 없음**: RBAC/login/MFA/step-up 우회 0, assertion 삭제 0, catch-all 0, 무제한 retry 0, production 보안 기본값 변경 0. assertion timeout(10s) 상향 안 함.

**안정 재실행 결과**: 이전 실패 subset(a4/a5/b7-ops/a10) Chromium retries=0 → **36/36 PASS**. 전체 **3-browser retries=0 → 222/222 PASS(0 fail, 0 flaky)**. → **BL-13 RESOLVED**.

### Production Guard 최종 상태 (해제하지 않음)
전체 12개 필수 repository가 production에서 postgres/ready면 `assertProductionRepositoryReadiness`가 통과(로컬 production-mode startup 허용)함을 테스트로 입증. **그러나 Production Readiness/Stage 0/RC tag는 계속 BLOCKED**(코드로 productionReady=true 강제 전환 없음, 실제 승인은 리뷰어). MOCK·executable=false·kill-switch ACTIVE 유지.

### BL 최종 상태
- **BL-10: RESOLVED(런타임 컷오버 완료, 로컬 게이트 그린)** — auth/session/MFA/lockout(B1) + favorites/preferences/notifications/order_drafts(B2) + admin_operations/gateway_state/ai_policy(B3) 전부 async 계약 + PG 구현 + factory/guard 연결. prod SQLite fallback 0. (전체 production-mode 로컬 startup은 guard PASS; live 승인은 별개.)
- **BL-11: RESOLVED** — Login/MFA/Order/Admin/AI 분산 limiter 전 경로 연결, prod Redis fail-closed.
- BL-12(Batch1): RESOLVED. **BL-13: RESOLVED** (근본원인=admin E2E config의 login/MFA test-quota 누락; test-only 상향 + prebuilt preview + 워밍업으로 222/222 retries=0).
- Layout server-sync: **DEFERRED_P2**.

### 상태 요약
시작 HEAD 6abe668(불변, commit/tag/push 0) · 보호 artifact 32 보존(fp 94be031b) · 비보호 변경/신규 9(신규 2) · 임시 PG/Redis 제거(타 프로젝트 7 보존) · Live BitMart/OpenAI/AWS 호출 0 · Terraform 0 · TRADING_MODE=MOCK·executable=false·kill-switch ACTIVE · Stage 0 BLOCKED · Production Readiness BLOCKED · Phase 7 RC tag PROHIBITED.
