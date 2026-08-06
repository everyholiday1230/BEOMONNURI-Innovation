# Prompt 4 — Admin App Implementation Progress (RESUME STATE)

> 세션 중단 시 이어서 작업하기 위한 상태 파일. 새 세션은 이 파일을 먼저 읽고 `NEXT ACTION`부터 재개.
> commit 하지 않는다.

## Baseline (2026-07-31 02:0x)

| Item | Value |
|---|---|
| branch | phase-7-production-launch |
| HEAD | 98059302f0a1b7e2a6ccc8efcbebb316b41f9c3f (Prompt 3 commit) |
| parent | d80dc1bdb9d1776e416b25b810535594fc3bced8 |
| tags | 15 (phase-1 … phase-6-rc-v0.6.4) — 불변 |
| dirty | 33 |
| staged | 0 |
| package.json sha256(32) | 86ae36f2f50106da143891ea8f3ee85b |
| pnpm-lock.yaml sha256(32) | acf8e54a519a8987ee063179fce1a35b |
| apps/admin/package.json sha256(32) | bc025d50c71bf41480c613588e2b5f6d |
| busy ports | 22 53 80 5177 5432 6379 8000 8080 15432-15434 16379 16380 |

### Dirty file groups

- **A. PRE_EXISTING_ARTIFACTS (29)** — `/tmp/qt-before.txt`. artifacts/logs/**, artifacts/security/*.json,
  tests/e2e-mfa/results.json. 전부 생성물 로그. **손대지 않음.**
- **B. PROMPT3_USER_CHANGES** — commit `9805930`으로 커밋 완료 (67 files). 잔여 dirty 아님.
  추가로 생성 로그 3개(`artifacts/logs/phase7/e2e-isolated*.{log,tsv}`)와 `docs/PHASE7-PROMPT3-PROGRESS.md`가
  untracked/dirty 상태로 남아 있음 — 의도적.
- **C. PROMPT4_ADMIN_CHANGES** — 아래 표에 누적.

## Prompt 3 테스트 숫자 정정 (§3)

이전 보고의 "Chromium 109 / Firefox 110 / WebKit 110 = 329"는 **집계 오류**였다.
`grep "[browser].*›"`가 Playwright의 `Slow test file: [browser] › …` **요약 줄**까지 셌다.
실제 결과 줄만 세면 브라우저별 108개.

| 구분 | 값 |
|---|---|
| Unique final suite | 108 tests × 3 browsers = 324 executions |
| Passed / Failed / Skipped | 324 / 0 / 0 |
| Supplemental (별도 실행, 최종 실행이 대체) | chromium 107 · ff+wk 214(213P/1F) · webkit 검증 5 · ctrl inventory 1 |
| 세션 총 실행 | 651 |

주: Prompt 3 커밋 시 scratch 진단 spec `tests/e2e/zz-diag2.spec.ts`를 삭제했으므로
현재 User suite는 107 tests × 3 = 321 이 될 것으로 예상. Prompt 4 회귀 실행으로 확정한다.

## Admin baseline 실측

| 항목 | 값 |
|---|---|
| apps/admin 소스 | 683 lines (App.tsx 118, ui.tsx 89, api.ts 75, i18n.ts 57, screens 10개 315) |
| hash route | 10 (`#/overview #/users #/exchange #/orders #/ai #/audit #/incidents #/flags #/kill #/gates`) |
| RBAC UI 분기 | 0 — role/permission 모델 자체가 없음 |
| table primitives | 없음 — 각 screen 인라인 |
| Admin E2E | 38 tests × 3 browsers = 114 executions |
| **원래 9 FAIL 원인** | `tests/e2e-admin/admin.spec.ts`의 하드코딩 `http://localhost:5174` **8곳** → 격리 포트 실행 시 빈 주소를 가리킴. 실패 3 tests × 3 browsers = 9. 재현 로그 `/tmp/qt-p4/01-admin-baseline.log` |
| 영향 test | [16] audit export CSV/JSON, [20] feature flag 409 conflict, [27] CSRF-less mutation 403 |

허용 origin으로 판정한 것 (결함 아님):
- `apps/admin/vite.config.ts:12` — dev proxy target 기본값, 서버 전용, `VITE_API_BASE_URL`로 재정의 가능
- `tests/e2e-admin/playwright.config.ts:23,24,71` — 자기 포트 변수로 조립하는 단일 출처

## Batch status

| Batch | Scope | Status |
|---|---|---|
| A0 | Shell/Routes/Origin fix | origin 8곳 제거 DONE (chromium 38/38) · shell 확장 TODO |
| A1 | Role-aware nav + RBAC UI | TODO |
| A2 | Overview / System Health | TODO |
| A3 | User Mgmt + Detail | TODO |
| A4 | Orders read-only (PLACEHOLDER 교체) | TODO |
| A5 | AI Ops / Market Gateway | TODO |
| A6 | Security / MFA / Audit | TODO |
| A7 | Alerts/Config/Reports/Backup/Release | TODO |
| A8 | Table infrastructure | TODO |
| A9 | Step-up / 409 / error states | TODO |
| A10 | Responsive / i18n / a11y | TODO |
| A11 | Admin E2E + visual regression | TODO |

## NEXT ACTION

1. [x] A0 origin fix + chromium 재검증
2. [ ] A0 3-browser 확정 (9 failures 해결 증거)
3. [ ] 서버 admin route + RBAC 실측 (permission 모델 Source of Truth)
4. [ ] A8 table primitives 먼저 (A3~A7이 전부 의존)
5. [ ] A1 role-aware nav
6. [ ] A2~A7 화면
7. [ ] A9~A10
8. [ ] A11 3-browser + visual
9. [ ] User Prompt 3 회귀
10. [ ] 보고서 A~O, commit 금지

## Verification log

| Command | Exit | Result | Log |
|---|---|---|---|
| admin e2e chromium (baseline, ports 18891/15291) | 1 | 35 passed / 3 failed | /tmp/qt-p4/01-admin-baseline.log |
| pnpm lint | 0 | 0 error / 6 warning | /tmp/qt-p4/02-lint.log |
| admin e2e chromium (after origin fix, 18893/15293) | 0 | **38 passed** | /tmp/qt-p4/03-admin-fixed.log |

---

## Session log — A0 / A1 foundation

### A0 DONE (origin fix)
- 8곳 하드코딩 `http://localhost:5174` → `isolation.BASE_URL` (config 단일 출처) 교체
  in `tests/e2e-admin/admin.spec.ts` (+ `import { isolation } from './playwright.config'`)
- 결과: admin E2E **114/114 PASS** (38 tests × 3 browsers). 이전 105P/9F.
  로그 `/tmp/qt-p4/04-admin-3browser.log`

### 서버 RBAC 실측 + 버그 수정
- 정본: `packages/admin-domain/src/permissions.ts` — 20 permissions, 6 roles, default-deny.
- **버그**: `GET /admin/audit`는 `admin.audit.read` 요구, `GET /admin/audit/export`는 `admin.audit.export` 요구.
  그런데 `READ_ONLY`에 `audit.read`가 없어 ANALYST/ADMIN은 **read 없이 export만** 보유 →
  전체 로그 다운로드는 되는데 UI 목록은 403.
- **수정**: `audit.export`를 가진 역할(ANALYST, ADMIN)에 `audit.read` 부여. SUPPORT는 둘 다 없음(불변).
- 회귀 테스트 추가: `admin-domain.test.ts` — export⇒read 불변식 + SUPPORT는 여전히 없음.
- **발견**: 이 수정으로 ADMIN 권한 집합이 SUPER_ADMIN과 **완전히 동일**(20/20)해짐.
  즉 ADMIN vs SUPER_ADMIN 구분은 permission이 아니라 `canAssignRole` 불변식 계층에서만 이뤄진다.
  permission만 보는 UI는 두 역할을 구분할 수 없다. → 보고서 N(Known Issues)에 기록.

### 신규 서버 엔드포인트 (§7 요구: 권한 SoT = 서버 session/claims)
- `GET /api/admin/me` → `{ userId, email, role, permissions[] }`
  guard: `admin.dashboard.read`. secret/token/csrf/password 미포함.
- 테스트 3개 추가 (`admin-api.test.ts` [31][32][33]):
  - [31] role+permissions 반환 + credential 누출 0
  - [32] 역할별 permission 집합이 실제로 다름 (SUPPORT⊂ADMIN, ANALYST⊂ADMIN, ADMIN⊆SUPER_ADMIN,
        SUPPORT≠ANALYST, ADMIN.size==SUPER_ADMIN.size 를 사실로 명시)
  - [33] non-admin 403, unauth 401

### A1 클라이언트 RBAC 계층
- `apps/admin/src/rbac.ts` (신규 177줄)
  - `AdminPermission` union (서버 20개 미러), `AdminIdentity`
  - `ROUTE_PERMISSION` — 16 hash route → permission
  - `ACTIONS` — 24 ADM-* action → { permission, stepUp, audited, policyBlockKey, backendContract }
  - `evaluateAction()` — policy > permission > backend 순서로 판정, 사유(DenyReason) 반환
  - 역할→권한 매핑은 **클라이언트에 복제하지 않음** (drift 방지). 서버 `/admin/me` 결과만 소비.
- `apps/admin/src/__tests__/rbac.test.ts` (신규) — **13 tests PASS**
  - null/hollow identity default-deny, 미등록 route deny
  - 역할별 visible route 집합이 서로 다름
  - order/position/withdraw/AI-order/restore = 모든 역할에서 `policy` 차단 (permission 아님)
  - kill-switch = 이 Phase 동결
  - endpoint 없는 action = `backend` + 계약 ID 필수 (fake success 불가)

### 테스트 현황
| Command | Exit | Result |
|---|---|---|
| pnpm test:admin (admin-domain) | 0 | 17 passed |
| pnpm test:admin (admin-api) | 0 | 17 passed (신규 3 포함) |
| admin unit (rbac) | 0 | 13 passed |
| admin e2e 3-browser | 0 | 114 passed |

## 중요: 목업 자산 부재 (정직성 기록)

Prompt 2가 말한 "Admin 목업"은 디스크에 **design mockup 자산으로 존재하지 않는다.**
`/tmp/qt-vis/adm_*.png`는 **현재 앱을 찍은 스크린샷**이며 목표 디자인이 아니다.
따라서 Admin Mock Fidelity를 퍼센트로 주장할 수 없다 → 보고서에 `UNVERIFIABLE (no mockup asset on disk)`로 기록하고,
화면 집합은 §4 control-ID 접두어 + 서버 능력 표면(25 endpoints) + 기존 route/docs/tests에서 재구성한다.

## 서버 admin 표면 (25 endpoints) → 화면 매핑

| 화면 | 서버 근거 | 예상 상태 |
|---|---|---|
| Overview | /admin/overview, /admin/system/health | FULLY |
| System Health | /admin/system/health | FULLY |
| Users + Detail | /admin/users, /users/:id, disable/enable/revoke/role | FULLY |
| RBAC | /admin/me + admin-domain 모델 (서버 목록 endpoint 없음) | PARTIALLY |
| Orders/Positions | /admin/orders, /admin/positions | FULLY (PLACEHOLDER 교체 대상) |
| Exchange | /admin/exchange-connections | FULLY |
| Gateway | exchange-connections + health only; /metrics 미프록시 | PARTIALLY → ADM-API-07 |
| AI Ops | /admin/ai/usage, /admin/ai/errors | FULLY |
| Security/MFA | 전용 endpoint 없음 (health가 mfa 상태만) | BACKEND_REQUIRED → ADM-API-13 |
| Audit | /admin/audit, /admin/audit/export | FULLY |
| Alerts/Incidents | /admin/incidents (+POST/PATCH) | FULLY (ack는 ADM-API-09) |
| Configuration | /admin/feature-flags, /admin/kill-switches (+PATCH) | FULLY (kill은 정책 동결) |
| Reports | 없음 | BACKEND_REQUIRED → ADM-API-12 |
| Backup/Recovery | 없음 | BACKEND_REQUIRED → ADM-API-15 |
| Release Gate | /admin/release-gates (+PATCH) | FULLY |

## NEXT ACTION (이어서)

1. [x] A0 origin fix + 3-browser 확정
2. [x] 서버 RBAC 실측 + audit permission 버그 수정 + /admin/me + 테스트
3. [x] A1 client rbac.ts + 13 unit tests
4. [ ] api.ts: `me()` + 누락 endpoint(ai/errors) 추가
5. [ ] A8 table primitives (`apps/admin/src/table.tsx`) — A3~A7 전부 의존
6. [ ] A0 shell 확장: role badge, env badge, breadcrumb, mobile nav, forbidden/notfound, skip link
7. [ ] A1 role-aware nav 렌더링
8. [ ] A2 Overview/System · A3 Users+Detail · A4 Orders(PLACEHOLDER 교체)
9. [ ] A5 AI Ops/Gateway · A6 Security/Audit · A7 Alerts/Config/Reports/Backup/Release
10. [ ] A9 step-up/409 · A10 responsive/i18n/a11y
11. [ ] A11 admin E2E(4역할) + visual regression
12. [ ] User Prompt 3 회귀 (zz-diag2 삭제 반영된 실제 수 확정)
13. [ ] 보고서 A~O. **commit 금지**

---

## 목업 자산 발견 (2026-07-31 02:2x) — 앞선 판정 정정

사용자 제보로 목업 위치 확정. 5180 포트는 맞았고 서버만 꺼져 있었다.

- **경로**: `/home/test1/BeomOnNuri_Hompage/design_handoff_quantumtrade_ai`
- **재기동**: `python3 -m http.server 5180 --bind 127.0.0.1` → HTTP 200 확인
- 이전 실행 증거: `/tmp/qt-run/check.mjs` 안에 `http://localhost:5180/index.html`

### 자산 구성 = 정확히 17개 파일

`README.md`, `design-system.html`, `developer-handoff.html`, `index.html`,
`src/{ai-copilot,app,chart-canvas,icons,layout-engine,tweaks,widgets}.jsx`,
`src/{base,components,tokens,widgets}.css`, `src/{mock-data,mock-stream}.js`

→ Prompt 2의 "목업 17개"는 **화면 17개가 아니라 파일 17개**였다.

### 결정적 사실 1: Admin 목업은 존재하지 않는다

- 전체 자산에서 `admin|관리자|RBAC|SUPER_ADMIN|kill switch|release gate` 매치 = **0**
  (`audit` 2건은 README/developer-handoff 산문의 우연한 단어)
- `index.html` = `<title>QuantumTrade AI — Trading Terminal</title>`, 단일 SPA, 위젯 9종
- `design-system.html` Component Inventory = Buttons/Badges/Inputs/Segmented/Status dots/
  Switch/Toasts/Signal Card. **table 컴포넌트 없음, admin 화면 레이아웃 없음**

→ **Prompt 4 §4의 "Admin 목업" 전제가 성립하지 않는다.**
   Admin Mock Fidelity는 `NOT_APPLICABLE (no admin design asset exists)`로 보고한다.
   Admin은 공유 디자인 언어(토큰 + 컴포넌트 상태 + breakpoints + non-negotiables)에 대한
   **design-language conformance**로 측정한다.

### 결정적 사실 2: Prompt 3 fidelity 보고 정정

내가 "User App Mock Fidelity: 100% (17/17 목업 화면)"로 보고한 것은 분모가 틀렸다.

실측 결과:

| 측정 | 결과 |
|---|---|
| 목업 페이지 | 1 (트레이딩 터미널) + design-system 참조 + handoff 문서 |
| 목업 위젯 | 9 (marketWatch, chart, miniChart, orderBook, recentTrades, orderEntry, positions, assetsRisk, aiCopilot) |
| 구현된 목업 위젯 | **9/9** 실제 컴포넌트 (registry.tsx) |
| 목업에 없는 registry 항목 | 5개가 `P()` placeholder (multiChart, signalProposal, alerts, news, symbolHeader) — 목업 범위 밖 |
| design token 고유명 | 목업 180 vs 구현 180, **양방향 차집합 0 (완전 일치)** |
| tabular-nums | 구현 app.css 10곳 ✓ |
| prefers-reduced-motion | 구현 ✓ |

### 결정적 사실 3: 확인된 MAJOR fidelity 결함 (Prompt 3 잔여)

목업 `design-system.html` Responsive Breakpoints는 **mobile(<768)에 "Bottom nav 5개 ·
차트/주문/AI 개별 화면"** 을 명시한다.

구현(`apps/web/src/shell/MobileNav.tsx` + `app.css:266-279`)은
`position: fixed; inset: 0 auto 0 0; width: min(88vw, 320px)` — **좌측 drawer**이며
`mobile-nav__link` 사용처가 2곳이다. bottom nav가 아니다.

→ 분류: **MAJOR** (목업 명세와 구조적으로 다름, 안전상 의도된 차이가 아님)
→ Prompt 3 "Mock Fidelity 100%"는 성립하지 않는다. 정정 필요.
→ 수정은 User App 범위이고 Prompt 4 §18(불필요한 User App 수정 금지)에 걸리므로
   **사용자 승인 후 별도 수정**. 계획: `.mobile-nav`를 `inset: auto 0 0 0` bottom bar로 전환,
   5개 항목(Markets/Chart/Order/AI/Portfolio) + 44px 타깃 + active 표시 + safe-area inset.

### 목업이 강제하는 구속 조건 (Admin에도 적용)

Breakpoints: ≥1920 24col · 1440-1919 24col · 1280-1439 24col(사이드바 축소, compact) ·
1024-1279 12col(2열, AI는 Drawer) · 768-1023 8col(1열 카드 스택) · <768 4col(bottom nav 5)

Non-negotiables:
- Order Safety: AI 한마디 주문 실행 금지 / Preview→Risk Check→Final Confirm 최소 3단계 /
  가격이탈·잔고부족·고레버리지 즉시 경고
- Data Legibility: 모든 숫자 tabular-nums / 실시간 갱신 시 레이아웃 흔들림 금지 / 과도한 애니메이션 금지
- Accessibility: Long/Short은 **색상+아이콘+텍스트 병기** / 키보드 접근 / focus ring 명확 /
  prefers-reduced-motion 완전 지원

---

## User mobile Bottom Navigation hotfix — DONE (승인된 User App 범위 예외)

### 변경 파일
| File | Change |
|---|---|
| `apps/web/src/shell/BottomNav.tsx` | NEW — 5 destination bottom bar (Markets/Chart/Order/AI/Portfolio) |
| `apps/web/src/lib/useMediaQuery.ts` | NEW — `MOBILE_QUERY='(max-width: 767px)'`, `useIsMobile()` |
| `apps/web/src/app/TradePage.tsx` | mobile 전용 per-view 렌더링 (`MOBILE_VIEW_WIDGETS`), desktop 24-col 유지 |
| `apps/web/src/App.tsx` | `/trade/order` route 추가, `<BottomNav/>` 마운트, MARKET_ROUTES 갱신 |
| `apps/web/src/app.css` | `.bottom-nav*`, `.trade-body--mobile`, `.mobile-view-stack`, `.app-shell > .app-route` |
| `apps/web/src/i18n/messages.ts` | `nav.chart/order/more/bottom` (ko/en) |
| `apps/web/src/__tests__/bottom-nav.test.ts` | NEW — 14 unit tests (항목수·URL·CSS 스펙) |
| `tests/e2e/flow-q-bottom-nav.spec.ts` | NEW — 11 browser tests |
| `tests/e2e/flow-p-responsive-a11y.spec.ts` | U7-1 breakpoint-aware, U7-1b 추가, U7-2/U7-14는 `/trade/order` |

### 구현 결정
- mobile view state를 **URL에 연결** (`/trade`=chart, `/trade/order`=order, `/trade/ai`=ai).
  로컬 useState면 reload/back-forward가 깨지므로 채택하지 않음.
- mobile에서 비활성 view의 위젯은 **렌더 자체를 안 함** (display:none이면 구독·차트 인스턴스가 살아남음).
- bottom bar는 `<nav>` 링크 목록. 항상 보이므로 focus trap 금지 (drawer와 다름).
- 부가 목적지(layout/design-system/status/settings)는 헤더 drawer에 유지 = More 역할.

### 도중 발견한 자기 실수 (기록)
CSS 삽입 시 원래 `@media (max-width: 767px) {` 여는 줄과 `.seg { display:none; }`을
실수로 삭제 → mobile 전용 규칙 12개가 **전역 적용**되어 1440px에서도
`.sh-meta > .meta-cell:nth-child(n+3) { display:none }`가 걸려 U2-7이 깨졌다.
brace balance 검사(292/292, depth 0)로 복구 확인.

### 회귀 결과
| Run | Result |
|---|---|
| web unit | **123 tests / 14 files PASS** |
| lint / typecheck | 0 error |
| targeted 3-browser (bottom-nav + layout-geometry) | 57/57 |
| bottom-nav 3-browser (WebKit 타임아웃 수정 후) | 33/33 |
| **User full suite chromium** | **119/119** |
| **User full suite firefox + webkit** | **238/238** |
| **User unique final suite** | **119 tests × 3 = 357 executions, 0 failed, 0 skipped** |

WebKit U7-BN-9 예비 실패 1건: 조합당 goto+reload로 8회 내비게이션 → 30s 초과.
`addInitScript`로 첫 페인트 전 pref 주입해 내비게이션 절반으로 축소하여 해결(회피 아님, 동일 단정 유지 + `html[lang]` 검증 추가).

### User 테스트 수 변화
108 (Prompt 3 최종) − 1 (`zz-diag2` scratch 삭제) + 11 (bottom-nav) + 1 (U7-1b) = **119**

## NEXT ACTION
1. [x] User bottom nav hotfix + 3-browser 회귀
2. [ ] **A8 Table Primitives** ← 현재 지점
3. [ ] A2 Overview/System · A3 Users+Detail · A4 Orders · A5 AI/Gateway · A6 Security/Audit
4. [ ] A7 Alerts/Config/Reports/Backup/Release · A9 step-up/409 · A10 responsive/i18n/a11y
5. [ ] A11 Admin E2E(4역할) + visual · ADMIN/SUPER_ADMIN 판정 · 보고서 A~O

---

## A8 Table Primitives — DONE

- `apps/admin/src/table/useAdminTable.ts` (NEW) — typed columns, stable sort, search debounce,
  filters, client/server mode **명시**, AbortController + monotonic request id로 stale response 차단,
  page/pageSize, unknownTotal 1급 상태, column visibility, reset, reload.
- `apps/admin/src/table/DataTable.tsx` (NEW) — `<table>` + `<caption>` + `th[scope=col]` +
  `aria-sort`, 정렬 헤더는 실제 `<button>`, pagination은 `<nav>` + `aria-live`,
  1023px 이하 card fallback, rowKey는 데이터 기반(array index 금지),
  pagination **mode를 화면에 표기**, backendRequired 상태.
- `apps/admin/src/__tests__/table.test.ts` (NEW) — 12 tests.
  - 테스트가 실제 버그를 잡음: blank 값 정렬에 방향 부호가 곱해져 desc에서 blank가 앞으로 오던 문제.
    "blank는 방향과 무관하게 뒤"로 구현 수정.

## A2 Overview / System Health — DONE

- `apps/admin/src/health/severity.ts` (NEW) — 문자열 health 값 → severity 분류.
  **"Not Connected (not probed at runtime)"가 connected로 오독되지 않도록** 미측정 계열을 먼저 검사.
  미인식 값은 ok로 가정하지 않고 unknown. `worst()`, `isStale()`.
- `apps/admin/src/health/StatusCards.tsx` (NEW) — `StatusPill`/`MetricCard`.
  severity를 **아이콘 + 단어 + 색** 3중으로 전달(색 단독 금지, design-system Non-negotiable).
- `apps/admin/src/screens/Overview.tsx` (REWRITE) — 5 카드(trading/exchange/ai/system/users),
  rollup severity, 마지막 갱신 시각 + stale 배지 + refresh, 카드별 drill-down.
- `apps/admin/src/screens/SystemHealth.tsx` (NEW) — 7 그룹 + 미분류 필드도 노출(신규 health 필드 유실 방지).
- `apps/admin/src/__tests__/severity.test.ts` (NEW) — 13 tests.

## A0 shell 확장 + A1 role-aware nav — DONE

- `apps/admin/src/App.tsx` (REWRITE)
  - 신원은 `GET /api/admin/me`에서만. localStorage role 불신.
  - nav는 서버 permission 집합으로 필터 → 역할별로 메뉴가 실제로 달라짐.
  - 미허용 hash 직접 접근 시 `denied` + 필요한 permission 표시 (서버도 403).
  - 미등록 hash → not-found.
  - skip link, breadcrumb, page title, role badge, env badge, email, theme/lang/signout.
  - 1279px 이하 drawer, 767px 이하 admin 전용 bottom bar(최대 5, **권한 없는 메뉴로 슬롯 채우지 않음**).
- `apps/admin/src/styles.css` — shell grid가 공식 breakpoint(1440/1280/1024/768) 따름, sr-only,
  tabular-nums, card/severity/table 스타일.
- `#/system` route 추가 → hash route 10 → **11**.

### 검증
| Gate | Result |
|---|---|
| admin typecheck | 0 error |
| pnpm lint | 0 error / 6 warning (기존 authApi any) |
| admin unit | **38 tests / 3 files PASS** (rbac 13 + table 12 + severity 13) |
| admin E2E chromium (shell 재작성 후) | **38/38 PASS** — 회귀 0 |

## NEXT ACTION
1. [x] A8 Table Primitives
2. [x] A2 Overview / System Health
3. [x] A0 shell 확장 / A1 role-aware nav
4. [ ] **A3 Users + User Detail** ← 현재 지점
5. [ ] A4 Orders read-only (PLACEHOLDER 교체) · A5 AI Ops/Gateway · A6 Security/Audit
6. [ ] A7 Alerts/Config/Reports/Backup/Release · A9 step-up/409 · A10 responsive/i18n/a11y
7. [ ] A11 Admin E2E(4역할) + visual · ADMIN/SUPER_ADMIN 판정 · 보고서 A~O

---

## A3 Users + User Detail — DONE / A9 Step-up·409 기반 — DONE

### 신규/재작성
| File | Change |
|---|---|
| `apps/admin/src/screens/Users.tsx` | REWRITE — DataTable 기반. 서버 검색(`q`) + status/role 서버 필터 + offset 페이징. MFA 필터는 page-scoped. |
| `apps/admin/src/screens/UserDetail.tsx` | NEW — 명명된 필드 drawer(JSON dump 제거). 표시 필드 allow-list + 금지 키 tripwire. focus trap/Escape/focus 복귀. |
| `apps/admin/src/actions/DangerAction.tsx` | NEW — `ActionButton`(권한/정책/backend 사유 표시하며 disable) + `DangerActionDialog`(전체 상태기계). |
| `apps/admin/src/api.ts` | `users()`가 status/role/limit/offset 지원, `me()` 추가, `AdminIdentityDto`. |
| `apps/admin/src/table/useAdminTable.ts` | `serverFilterIds`/`serverSort`/`sortScope`/`filterScope`, `TableFetchError`, expired/rateLimited/offline 상태. |
| `apps/admin/src/table/DataTable.tsx` | scope 배지, expired/rateLimited/offline 렌더. |

### 정직성 설계 결정
- 서버 users endpoint에 **sort 파라미터와 total이 없음**. 그래서 정렬은 로드된 페이지에만 적용되고
  `sortScope='page'` 배지로 화면에 명시(“정렬: 현재 페이지만” + Prompt 5 ADM-API-01 안내).
  전체 정렬인 것처럼 보이게 하지 않음. total은 `unknownTotal`로 표시(0으로 위장 금지).
- MFA 필터도 서버 미지원 → `filterScope='mixed'` 배지.
- 409는 **자동 재시도·덮어쓰기 없음**. 충돌 내용 표시 + “서버 상태 다시 불러오기” + 입력한 사유 보존.
- double submit은 `disabled` + `useRef` in-flight 가드 이중 방어.
- 성공은 서버 응답만 근거. optimistic success 경로 없음.

### 도중 잡은 문제
1. `TableFetchError` 도입 전에는 API 상태를 `Error`로 뭉개서 401/429/offline 구분이 사라졌다.
   → E2E [26]/[28]/[30]이 이를 드러냄. 타입 있는 실패로 교체.
2. `ActionButton`이 lock 글리프와 sr-only 사유를 자식으로 넣어 **accessible name을 오염**시켜
   `getByRole('button',{name:'Disable',exact:true})`가 깨졌다. → `aria-label`로 이름 고정,
   사유는 `title`+`aria-description`으로 분리.
3. 내 일괄 치환이 **Audit 화면**의 검색 submit까지 Users 헬퍼로 바꿔 [15]를 깨뜨림. 해당 호출부 복구.

### 기존 E2E 갱신 (동작이 스펙대로 바뀐 것에 맞춤, 약화 아님)
- `searchUsers()` 헬퍼: debounce 검색(submit 버튼 없음) 대응, `loading`이 아닌 **안정 상태**까지 대기
  (offline/expired/rateLimited도 안정 상태이므로 ready/empty만 기다리면 해당 시나리오가 불가능해짐).
- `confirmDialog()`: step-up을 dialog가 선언하므로 존재 시 자동 충족. 미이관 legacy dialog도 지원.
- **[3]/[4] 강화**: 이전엔 버튼을 눌러 서버 403만 확인. 이제 (a) UI가 사유와 함께 disable
  (`data-deny-reason="permission"`) **그리고** (b) 동일 mutation을 직접 API로 호출해 **403** 확인.
  §1.8(UI 숨김만으로 보안 판정 금지)을 테스트로 강제.
- **[6] 강화**: JSON dump 대신 명명 필드 확인 + drawer DOM에 credential 형태 문자열 0건 tripwire
  (redaction 안내문 자체는 스캔 대상에서 제외).

### 검증
| Gate | Result |
|---|---|
| admin typecheck | 0 error |
| admin unit | 38 tests / 3 files PASS |
| **admin E2E chromium** | **38/38 PASS** |

## NEXT ACTION
1. [x] A8 · A2 · A0/A1 · A3 · A9(기반)
2. [ ] **A4 Orders read-only (PLACEHOLDER 교체)** ← 현재 지점
3. [ ] A5 AI Ops/Gateway · A6 Security/MFA/Audit
4. [ ] A7 Alerts/Config/Reports/Backup/Release (legacy ConfirmDialog → DangerAction 이관 포함)
5. [ ] A10 responsive/i18n/a11y · A11 3-browser E2E + visual
6. [ ] ADMIN/SUPER_ADMIN 판정 · 보고서 A~O

---

## A4 Orders / Positions read-only — DONE

### 핵심 발견
`GET /admin/orders`와 `/admin/positions`는 **하드코딩된 빈 배열**을 반환하고 있었다.
쿼리가 아예 없었다. 그런데 `orders`/`positions` 테이블은 **migration 0003부터 존재**하며
A4가 필요한 컬럼을 모두 갖고 있다(internal_order_id, user_id, symbol, side, type, price,
quantity, filled_quantity, status, mode, created_at, updated_at / size, entry_price,
mark_price, liquidation_price, leverage, margin_mode, unrealized_pnl).

즉 Prompt 2의 "ADM-ORDERS-TABLE = PLACEHOLDER"는 UI만의 문제가 아니라
**라우트가 자기 데이터 소스를 조회하지 않는 stub**이었다.
§20 "기존 서버 route의 명백한 버그 수정"으로 판단해 **SELECT 전용**으로 연결했다.

### 서버 변경 (read-only만)
| File | Change |
|---|---|
| `apps/api/src/db/admin-repos.ts` | `searchOrders`/`countOrders`/`searchPositions`/`countPositions` 추가. 전부 parameterized SELECT. `credential_id`는 **의도적으로 미선택**. `users` LEFT JOIN으로 email 제공. |
| `packages/admin-schemas/src/index.ts` | `AdminOrderQuerySchema`/`AdminPositionQuerySchema` (`.strict()` → 미지정 파라미터는 400). |
| `apps/api/src/admin/admin-routes.ts` | 두 라우트를 실제 조회로 연결, `total`·`readOnly:true`·`note` 반환. mutation 라우트는 **추가하지 않음**. |

### 클라이언트
| File | Change |
|---|---|
| `apps/admin/src/screens/OrdersPositions.tsx` | REWRITE — orders/positions 탭 2개, 각각 DataTable. 서버 필터(symbol/side/status/type/mode), 페이징, total 실제 수, 주문 상세 drawer, order ID 축약. |
| `apps/admin/src/api.ts` | `orders()`/`positions()` 필터·페이징 지원, `AdminOrder`/`AdminPosition` 타입. |

### 안전 구현
- cancel/modify/close/leverage는 `ActionButton`으로 렌더되지만 **모든 역할에서 `policy` 차단**.
  숨기지 않고 사유를 보이게 disable → 기능이 의도적으로 없다는 사실이 드러남. 요청은 0건.
- Long/Short은 색 단독이 아니라 **글리프 + 단어**(▲ buy / ▼ sell).
- 주문 상세에 API key·secret 미포함 명시.

### 도중 잡은 내 실수
lint 경고(`serverFilters`/`serverSort` 의존성 누락)를 그대로 추가했더니
`serverFilterIds`가 인라인 배열 → 매 렌더 새 `Set` → **fetch 무한 루프**로 8개 테스트가 깨졌다.
안정적인 primitive 키(`serverFilterKey`)로 memo를 고정해 해결. 경고를 없애려다 버그를 만든 사례.

### 신규 테스트
- `apps/api/src/__tests__/admin-api.test.ts` [34]~[37] (4개)
  - [34] 실제 조회 + 필터 + 페이징 + total(페이지 아님 전체) + `credential_id` 미포함
  - [35] positions 실제 조회 + `.strict()` 미지정 파라미터 400
  - [36] **SUPER_ADMIN + 유효 CSRF로도** orders/positions/withdraw mutation 라우트가 404/405
  - [37] order read 권한 강제 (ANALYST 200, 일반 USER 403)
- `tests/e2e-admin/admin-a4-orders.spec.ts` (6개)
  - [A4-1] `<pre>` dump 0, toolbar/mode 배지 존재, 상태에 맞는 pager
  - [A4-2] SUPER_ADMIN에서도 cancel이 `data-deny-reason="policy"`로 disable
  - [A4-3] 모든 차단 버튼을 force click해도 **mutation 요청 0건**
  - [A4-4] 서버에 write 라우트 없음 (404/405)
  - [A4-5] positions 탭 독립 테이블
  - [A4-6] 필터·검색이 실제 요청 쿼리스트링에 반영

### 검증
| Gate | Result |
|---|---|
| pnpm lint | 0 error / 6 warning (기존 authApi any만) |
| admin/api typecheck | 0 error |
| admin unit | 38 PASS |
| `pnpm test:admin` | admin-domain 17 + admin-api **21** PASS |
| **admin E2E chromium** | **44/44 PASS** (38 기존 + 6 신규) |

## NEXT ACTION
1. [x] A8 · A2 · A0/A1 · A3 · A9(기반) · A4
2. [ ] **A5 AI Ops / Market Gateway** ← 현재 지점
3. [ ] A6 Security/MFA/Audit · A7 Alerts/Config/Reports/Backup/Release
4. [ ] A10 responsive/i18n/a11y · A11 3-browser + visual
5. [ ] ADMIN/SUPER_ADMIN 판정 · 보고서 A~O

---

## A5 AI Ops / Market Gateway — DONE

### 또 같은 패턴: stub over real tables
- `/admin/ai/usage` → 2개 필드만 반환. 실제로는 `ai_runs`, `ai_usage_records`, `ai_tool_calls`(0004) 존재.
- `/admin/ai/errors` → 하드코딩 `[]`.
- `/admin/exchange-connections` → `{connections:'Unavailable'}`. 실제로는 `exchange_connections`,
  `exchange_websocket_sessions`(0003) 존재.
→ A4와 동일 근거(§20)로 **SELECT 전용** 연결.

### 서버 변경 (read-only)
| File | Change |
|---|---|
| `apps/api/src/db/admin-repos.ts` | `searchAiRuns`/`countAiRuns`/`aiUsageSummary`/`searchExchangeConnections`/`countExchangeConnections`/`gatewaySummary` |
| `packages/admin-schemas/src/index.ts` | `AdminAiQuerySchema` (`.strict()`) |
| `apps/api/src/admin/admin-routes.ts` | ai/usage·ai/errors·exchange-connections를 실제 조회로 연결 |

**의도적 미선택**: prompt/response 본문(`ai_messages.content`)은 쿼리에 없음 —
관리자가 사용자 대화를 읽을 수 없게 구조적으로 차단. `exchange_credentials`는 조인하지 않고
`credential_id`는 마지막 4자만 노출.

### 클라이언트
- `apps/admin/src/screens/AiOps.tsx` REWRITE — 사용량 요약 카드 + 실행 이력 테이블
  (provider/model/status/fallback/tool call/토큰/추정비용/prompt version/correlation) + 상세 drawer.
- `apps/admin/src/screens/Exchange.tsx` REWRITE — gateway health 카드 + **미프록시 지표 카드** +
  제어 카드 + 연결 테이블.

### 정직성 설계
- market-gateway `/metrics`(message rate, duplicates, gap-fill, queue depth, back-pressure,
  circuit breaker, symbol count)는 BFF가 프록시하지 않음 → **0이 아니라 "측정되지 않음"**으로 표시하고
  카드 rollup을 `unknown`으로 유지. 계약 ID `ADM-API-07` 명시.
- resync/reconnect는 엔드포인트가 없으므로 **가짜 성공 금지**, `backend` 사유로 disable.
- `ADM-AIOPS-EXECUTE-ORDER`는 모든 역할에서 `policy` 차단.

### 도중 잡은 보안 설계 문제
`redact()`의 `SENSITIVE_KEY`가 `token` 부분문자열을 잡아 **`input_tokens`(정수 카운터)까지 `[REDACTED]`**
로 만들었다. 정규식을 느슨하게 하면 향후 모든 필드의 deny-by-default가 약해지므로,
대신 **정확한 이름 허용 목록**(`COUNTER_KEYS`)을 추가하고 **값이 숫자일 때만** 통과시켰다.
회귀 테스트로 `session_token`/`refresh_token`은 여전히 가려지고, 허용 이름이라도 문자열 값이면
가려지는 것을 고정.

### 신규 테스트
- `admin-api.test.ts` [38]~[40]
  - [38] 실제 run 이력 + tool call/토큰/비용 + **응답 전체에 대화 본문 문자열 0건**
  - [39] `credential_ref`는 `…1234`만, 전체 credential_id와 secret blob 모두 응답에 없음
  - [40] 권한 강제 + `.strict()` 400 + gateway/AI-order write 라우트 404/405
- `admin-domain.test.ts` — token 카운터 허용 목록이 좁게 유지되는지
- `tests/e2e-admin/admin-a5-aiops-gateway.spec.ts` (7개)
  - [A5-4] 미프록시 지표 카드 rollup이 `unknown`이고 **0으로 렌더되지 않음**
  - [A5-5] resync/reconnect force click에도 요청 0건
  - [A5-3]/[A5-6] 화면 DOM에 credential/prompt 흔적 0건

### 검증
| Gate | Result |
|---|---|
| pnpm lint | 0 error / 6 warning |
| typecheck (api, admin) | 0 error |
| `pnpm test:admin` | admin-domain **18** + admin-api **24** PASS |
| admin unit | 38 PASS |
| **admin E2E chromium** | **51/51 PASS** (38 + A4 6 + A5 7) |

## NEXT ACTION
1. [x] A8 · A2 · A0/A1 · A3 · A9(기반) · A4 · A5
2. [ ] **A6 Security / MFA / Audit** ← 현재 지점
3. [ ] A7 Alerts/Config/Reports/Backup/Release (legacy ConfirmDialog → DangerAction 이관)
4. [ ] A10 responsive/i18n/a11y · A11 3-browser + visual
5. [ ] ADMIN/SUPER_ADMIN 판정 · 보고서 A~O

---

## ADMIN / SUPER_ADMIN 최종 판정: INTENTIONAL_EQUIVALENCE

> **Permission equivalence does not imply authority equivalence.**
> ADMIN and SUPER_ADMIN share the same base permission set, while privileged authority is separated
> through server-derived, non-client-overridable capabilities.

근거:
- `docs/PHASE5-02-ADMIN-RBAC.md:18-19` — SUPER_ADMIN 전용은 (1) SUPER_ADMIN 생성·수정, (2) gate WAIVE 2가지로 명시.
- 두 항목 모두 permission이 아니라 불변식 계층에서 서버 강제:
  `canAssignRole` (invariants.ts:40-46), `evaluateReleaseGateUpdate` (state-machines.ts:45-46).
- 따라서 permission 집합의 동일성(20/20)은 누락이 아니라 설계이다.
- §11.8 이행: 서버가 그 두 불변식 함수를 직접 호출해 도출한 capability
  (`admin.roles.assignPrivileged`, `admin.release.waive`)를 `GET /admin/me`가 반환하고
  클라이언트는 capability만 소비한다. 역할 문자열 비교는 코드에 없다.
- 검증: admin-api [41] capability가 두 역할을 실제로 구분, [42] 광고 capability와 서버 강제 일치,
  admin unit `rbac.test.ts` — role 문자열만으로는 아무 권한도 얻지 못함.

## 보고서 정정 최종 (검토 지적 반영)

### /admin/ai/errors — 상태 정정
실측: `apps/admin/src` 전체와 admin E2E에 `ai/errors`/`aiErrors` 참조 **0건**.
클라이언트가 소비하지 않으므로 FULLY_CONNECTED는 오판이었다.
→ **BACKEND_AVAILABLE_NOT_CONSUMED**로 정정.

### Admin API Connectivity (분모 24, 상호배타)
| 상태 | 수 | 비율 |
|---|---|---|
| FULLY_CONNECTED | 12 | 50.0% |
| PARTIALLY_CONNECTED | 4 | 16.7% |
| BACKEND_AVAILABLE_NOT_CONSUMED | 1 | 4.2% |
| BACKEND_REQUIRED | 7 | 29.2% |
| Fully or partially connected | 16 | 66.7% |
| Weighted (partial=0.5) | 14/24 | 58.3% |

### Admin Functional Completeness — API 행 제외
API 연결성은 위 원장으로 별도 보고하므로 Functional Completeness에서 제외한다.
**148/156 = 94.9%** (route 14/14, menu 14/14, table 6/10, filter+sort+pagination 6/10,
detail 3/3, action 24/24, RBAC 4/4, step-up 8/8, error state 8/8, test 61/61).

### 실행 원장 (로그 파싱 실측 — 최종 재검증 반영)

정정 후 문구 반영(`permissions.ts` / `rbac.ts` / 본 문서)에 따라 전체 게이트를 다시 돌렸고,
그 실행을 원장에 포함한 최종 수치이다. `/tmp/qt-p4/90-final.log`가 Admin 최종 결과이며
이전 Admin 3-browser 실행(`73-final.log`)은 supplemental로 전환된다.

| 구분 | Executions | Passed | Failed |
|---|---|---|---|
| Playwright (54 runs, /tmp/qt-p3 + /tmp/qt-p4) | 3,910 | 3,822 | 88 |
| 최종 재검증 unit (admin-domain 18 + admin-api 26 + admin unit 42) | 86 | 86 | 0 |
| **Total session** | **3,996** | **3,908** | **88** |

| 구분 | 값 |
|---|---|
| Unique final | **540 / 540 PASS** (Admin 183 `90-final.log` + User 119 `67-user.log` + User 238 `80-user-ffwk.log`) |
| Supplemental executions | **3,456** (3,996 − 540) |
| Supplemental passed | **3,368** (3,908 − 540) |
| Supplemental failed | **88** (전부 최종 실행이 대체) |
| Total session executions | **3,996** |

집계 구성: Playwright reporter의 `N passed` / `N failed` 요약 줄만 파싱하고
`Slow test file` 줄은 세지 않는다. 여기에 최종 재검증 vitest 86건을 더한 값이다.
손계산을 쓰지 않고 스크립트로만 산출한다.
