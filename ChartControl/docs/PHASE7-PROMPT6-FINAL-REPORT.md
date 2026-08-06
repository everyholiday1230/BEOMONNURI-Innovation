# QuantumTrade AI — Phase 7 / Prompt 6/6 최종 통합 검증·재판정 보고서

Principal Release Engineer · Security Architect · SRE · QA Lead · Independent Auditor
HEAD `7e22d2f6b9d9d4ad9cff8b421ec761b95ac8cc0e` · branch `phase-7-production-launch`
**자동 커밋·태그·push 없음 — 승인 대기. Phase 7 태그는 Stage 0 통과 전 생성 금지.**

모든 판정은 현재 HEAD의 실코드와 이번 세션에서 직접 실행한 결과 기반. 과거 APPROVED/PASS 문서를 그대로 신뢰하지 않았다.

---

## A. Executive Summary

Phase 1~7을 현재 코드 기준으로 재구성(130 요구사항)하고, Prompt 3~5 변경 후 전체 회귀·통합·보안·컨테이너·IaC·성능·시각충실도를 재검증했다.

- **구현/로컬 검증은 강건**: lint/typecheck 0 error, 유닛+통합 unique 1,487 PASS/1 SKIP, User E2E 477(3-browser), Admin E2E 222(3-browser), PostgreSQL 12/12(임시 컨테이너), 컨테이너 Trivy 0 Critical/High.
- **외부 검증은 미완(설계상 차단)**: Live BitMart(Phase 3)·Live OpenAI(Phase 4)·AWS Stage 0(Phase 7) 전부 BLOCKED_EXTERNAL. 안전 규칙상 실행하지 않았다.
- **신규 발견 3건**: (P1) PostgreSQL DDL이 SQLite보다 4개 migration 뒤처짐(0006~0009 테이블 PG DDL 부재), (P1) alerting.tf가 존재하지 않는 runbook 문서를 참조(21개 알람 앵커 파손), (P2) README 등 문서가 6개 Phase만큼 낡음.
- **Prompt 5 회귀 1건 처리**: gitleaks가 Prompt 5 신규 E2E 스펙 4개의 테스트 픽스처 password를 새로 flag(baseline 1→5). 리뷰어 지침의 suppression 메커니즘(rule/file/line/근거/owner/expiry)으로 `.gitleaks.toml`에 문서화 항목 추가 → 재실행 0건. (`.gitleaks.toml`은 이번 PROMPT6_CHANGE, 미커밋)
- **시각 충실도**: 공식 목업을 실제 렌더해 측정 — Overall 78.92%. 구조·토큰·프리셋 계약은 높은 충실도, 위젯 in-panel 크롬과 태블릿 구간이 주요 미달.

**최종: Production Readiness BLOCKED, Stage 0 BLOCKED 유지.** 구현 완료 ≠ 운영 검증 완료. Phase 7 RC 태그 생성 조건 미충족.

---

## B. Repository / Git Integrity

| 항목 | 값 |
|---|---|
| branch | phase-7-production-launch |
| HEAD (시작=종료) | 7e22d2f6b9d9d4ad9cff8b421ec761b95ac8cc0e (불변) |
| ancestry | Prompt3(9805930)·Prompt4(26c0f71)·Prompt5(7e22d2f)·Phase6-approved(d63ee29) 전부 HEAD ancestor ✔ (선형) |
| tags | 15 (phase-7 태그 0, 신규 생성 0) |
| staged | 0 |
| dirty | 33 = 보호 artifact 32(artifacts/ 31 + tests/e2e-mfa/results.json 1) + `.gitleaks.toml` 1(PROMPT6_CHANGE) |
| 보호 artifact HEAD 이후 수정 | 0건 |
| push/commit/tag (이번 세션) | 0 / 0 / 0 |
| remote | 없음 (push 불가) |
| 환경 | node 24.18.0, pnpm 9.15.0, docker 29.1.3, psql 16.14, redis 7.0.15, playwright 1.46.1, 4 core/7.6Gi RAM/7.1G disk |
| lockfile sha256(24) | acf8e54a519a8987ee063179 (Prompt 5와 동일, 미변경) |
| 안전 플래그 | TRADING_MODE=MOCK, liveOrders=false(BITMART_DEMO+flag 동시 필요), killSwitch 기본 true |

변경 격리: **A. PROTECTED_ARTIFACTS 32** (미변경) / **B. PROMPT6_CHANGES**: `.gitleaks.toml` 1건(문서화 allowlist) + 신규 문서 3종(본 보고서, TRACEABILITY, STAGE0-HANDOFF) / **C. TEMPORARY_EVIDENCE**: `/tmp/p6logs/` (Git 미추가).

---

## C. Phase 1~7 Traceability (요약 — 상세 `docs/PHASE1-7-FINAL-TRACEABILITY.md`)

130 요구사항, 중복 ID 0. 상태 분포(파일 원장에서 기계 집계):

| Phase | 개수 | PASS | CONDITIONAL | BLOCKED_EXTERNAL | NOT_EXECUTED | FAIL | NA |
|---|---|---|---|---|---|---|---|
| 1 | 22 | 18 | 4 | 0 | 0 | 0 | 0 |
| 2 | 12 | 8 | 1 | 1 | 1 | 1 | 0 |
| 3 | 14 | 8 | 4 | 2 | 0 | 0 | 0 |
| 4 | 14 | 11 | 1 | 2 | 0 | 0 | 0 |
| 5 | 14 | 12 | 1 | 0 | 0 | 0 | 1 |
| 6 | 20 | 4 | 8 | 2 | 6 | 0 | 0 |
| 7 | 34 | 11 | 6 | 13 | 3 | 1 | 0 |
| **계** | **130** | **72** | **25** | **20** | **10** | **2** | **1** |

2 FAIL: **P2-R12**(PostgreSQL DDL 4 migration 뒤처짐), **P7-R34**(문서 낡음). 태그 존재만으로 PASS를 부여한 행 0.

---

## D. User UI/API/DB Status

- **연결 상태(Prompt 5 확정, 본 세션 재확인)**: FULLY_CONNECTED 7그룹(Market Search, Favorites/Preferences, Orders/Trades/Positions, Order draft/validate, Account/Assets, Notifications 및 read model), DISABLED_BY_POLICY 1(position close/margin = validation-only, executable=false).
- **dead route 0 / dead control 0 / 하드코딩 외부 origin 0**(실측: app 소스에 bitmart/openai/localhost origin 0).
- **IDOR 차단**: 모든 read/write가 세션 user_id 스코프(repo 계층), 타 사용자 리소스 404 — API+E2E 격리 테스트.
- **상태 처리**: loading/empty/error/rate-limit/offline + 익명 401 예측 요청 회피(useSession 게이트).
- User Fully Connected 7/8 = **87.5%**, Policy-Compliant 8/8 = **100%** (Prompt 5 §V-4 계산식).

---

## E. Admin UI/API/DB Status

- **RBAC 100%**: user role은 세션에서만, admin은 `guard(c,perm)` 서버측 재검증. client role 무시. 4-role matrix E2E.
- **order-mutation 라우트 0**(실측: `/admin/*` post/put/patch/delete 중 order/position/withdraw/transfer 0건). step-up이 unlock/gateway control/ai-policy에 적용.
- **연결(Prompt 4 매트릭스 24 기준)**: FULLY 17/24(70.8%), PARTIALLY 7/24(29.2%), FULL+PARTIAL 24/24(100%), weighted 85.4%, BACKEND_REQUIRED 0.
- **Product-wide 신규 백로그 2건**: ADM-API-14(MFA reset) — 미구현, 정책 차단 UI 유지, **BACKEND_REQUIRED**; ADM-API-16(Security alerts) — 미구현, Security 화면 "미측정" 카드 표기, **BACKEND_REQUIRED**. 둘 다 Prompt 4 24 분모 밖, B7 지시 7건 밖.
- Admin PARTIAL 7 재검토: backup/gateway metrics/gateway control은 안전 정책(로컬 MOCK/read-only, 실게이트웨이·restore 미구현)상 PARTIAL이 정확한 상태이며 로컬 추가 구현으로 FULL 승격 대상 아님(정렬·필터·페이징은 이미 구현됨).

---

## F. Official Mock Visual Fidelity (V3 — 목업 실제 렌더 측정)

self-comparison 없음. 공식 목업(design_handoff_quantumtrade_ai, React18+Babel via CDN)을 실제 렌더해 현재 앱과 동일 고정 조건(6 viewport × dark/light × ko/en, deviceScaleFactor 고정, 폰트 로드 후, 애니메이션/타임스탬프 고정)에서 측정.

| 지표 | 값 | 계산식 (분자/분모) |
|---|---|---|
| Structural Fidelity | 70.45% | 15.5/22 |
| Widget Fidelity | 83.33% | 30.0/36 (9 widget × 4 기준) |
| Responsive Fidelity | 70.83% | 8.5/12 |
| Interaction Fidelity | 92.31% | 12/13 (목업이 실동작 보인 항목) |
| Pixel (Visual) Fidelity | 77.66% | 1 − 0.2234 (위젯 9개 diff_ratio_overlap 평균 @1280×720 dark/ko) |
| **Overall** | **78.92%** | 5차원 비가중 산술평균 |

- MAJOR 4: 56px 아이콘 사이드바 부재, 패널 제목 로케일 미반영(영문 하드코딩), chart in-panel toolbar/drawtools/HUD/legend 부재, 768px 차트 공백.
- **<1100px pixel diff = NOT_COMPARABLE**(목업이 해당 구간 미구현), **Admin pixel = NOT_APPLICABLE**(공식 목업 없음). 100% 상향 안 함.
- 확장 화면(공식 목업에 없는 것)은 fidelity 분모 제외, 기능 검증엔 포함.
- 산출물: `/tmp/p6logs/v3/` (48+ 스크린샷, 66 diff/side-by-side, meta JSON 다수).

---

## G. Test Results (V4 — 이번 세션 직접 실행, HEAD 7e22d2f)

| Suite | Runtime | 결과 | Log |
|---|---|---|---|
| lint | node | 0 error / 6 warning | v4-lint.log |
| typecheck | node | 0 error | v4-typecheck.log |
| packages+web unit | node | 408 PASS | v4-pkg-unit.log |
| apps/api | node | 368 PASS / 13 SKIP (381) | v4-api.log |
| PostgreSQL integration | 임시 docker PG 16-alpine (127.0.0.1:15468, tmpfs) | **12/12 PASS** | v4-pg.log |
| User E2E | Chromium/Firefox/WebKit | **477 PASS** (159×3) | v4-e2e-user-3b.log |
| Admin E2E | Chromium/Firefox/WebKit | **222 PASS** (74×3) | v4-e2e-admin-3b.log |

- **skip 13 분류**: postgres.integration 12 = `skipIf(!PG_TEST_URL)` → 임시 컨테이너로 **별도 12/12 PASS 대체**(FINAL_REPLACEMENT_EVIDENCE, unique 추가 0/replaced 12); stage-a-probe 1 = `skipIf(!STAGE_A_LIVE)` = **INTENTIONAL_BLOCKED_EXTERNAL**(Live BitMart/AWS).
- **Unique Final**: executions **1,488** / passed **1,487** / failed **0** / skipped **1**(effective, PG 대체 반영: pkg+web 408 + api 380PASS+1SKIP + user 477 + admin 222).
- RBAC 4-role / CSRF / IDOR / step-up / optimistic conflict / idempotency / rate-limit / AI injection·tool allowlist / no-live-order / no-live-provider — 모두 해당 suite 내 PASS(포트폴리오·주문·알림·admin·ai API 테스트 + E2E).
- 임시 PostgreSQL 컨테이너는 테스트 후 제거(로컬 15432-15434·데이터 미접촉).

---

## H. Security / Supply-Chain (V5 — 설치된 실제 버전)

| 도구 | 버전 | 결과 |
|---|---|---|
| pnpm audit --prod | 9.15.0 | **0** advisories (114 prod deps) |
| pnpm audit (dev 포함) | 9.15.0 | 9 (CRITICAL 1 vitest / HIGH 3 / MOD 5 / LOW 1) — **전량 dev-only, 런타임 0** |
| osv-scanner | 2.4.0 | 10 (전량 dev) |
| semgrep | 1.172.0 | **0** (5-ruleset + p/default) |
| gitleaks | 8.21.2 | HEAD에서 5 → 문서화 allowlist 후 **0** (4 test fixture + 1 doc, 전부 triaged) |
| trivy fs | 0.72.0 | 1 (IaC AWS-0104: network.tf egress 0.0.0.0/0 tcp443, 단일 NAT EIP 경유 — triaged) |
| checkov/tfsec/tflint | 3.3.8 / 1.28.13 / 0.53.0 | 304 pass·0 fail·31 skip / 0 fail / 0 issue |
| SBOM (syft 1.18.1) | — | source 550(.terraform 제외) / dir-as-scripted 934 / **image 98** |
| license | — | INCONCLUSIVE(syft 미식별 96.2%; `pnpm licenses`로 보완 권장) |

- **prod vs dev 명확 분리**: 프로덕션 런타임 취약점 0. dev-dep 취약점은 CI 러너 리스크로 실재하나 배포 이미지 미포함(V6 image Trivy 0).
- **pnpm 공급망 정책 실효성**: `pnpm.overrides`만 실효(ws 8.21.1 확인). `minimumReleaseAge`는 pnpm 9.15.0 미지원(10.16+), `.npmrc` 0개 — **enforcement 부분적**(P2 백로그).
- suppression 인벤토리: IaC 30건(checkov 26 + tfsec 4) 인라인 근거 양호하나 owner/expiry 누락(P3). gitleaks allowlist 5건은 owner/expiry 부여함.

---

## I. Container / SBOM (V6 — 재빌드 실측)

- `docker build --no-cache -f infrastructure/docker/Dockerfile.api` 3-stage 재빌드 성공.
- **Hardening 14/14 PASS**: pinned base digest(node:24-alpine@sha256), prod deps only, non-root uid 10001, cap-drop ALL, no-new-privileges(NoNewPrivs:1), health/live/ready 200, secret 0, dev seed 0, .terraform 0, live disabled/kill switch active(ENV). read-only fs는 **조건부**(쓰기 가능 data 마운트 필요 — SQLite 경로).
- **Trivy image: Critical 0 / High 0 (전체 0)** — alpine 3.24.1 + node-pkg 실제 스캔.
- **image SBOM = 98 components**(npm 78 + apk 18 + node 1 + alpine 1), 이미지 실제 package와 교차검증 일치.
- **image size 66.6 MiB**(69,849,092 B). Phase 6(78MB, Node20) → closure(69.8MB, Node24, npm/npx 제거, layer 9→7) → 현재 +47KB(Phase 7 migration 0007~0009 코드).
- **SBOM 934→550 원인 확정**: dir-scope 스캔의 `.terraform` 제외 실패. `scripts/phase7-security-scan.sh:175`의 `--exclude ./.terraform`가 루트만 매칭, 실 provider 캐시는 `infrastructure/terraform/phase7/.terraform`(692MB)에 있어 golang 384개 유입. `934 − 550 = 384 = .terraform provider`. 권위값: **배포 대상 = image 98**, 소스 의존 = 550, 현행 스크립트 = 934. (V5 dir-scope 952는 +18 node_modules 잔차로 재현 불완전 — 정직 기록.)

---

## J. Performance / Soak / Chaos (V7 — 로컬 격리, 자원 한계 명시)

환경: 4 core / 7.6Gi RAM (전용 부하 인프라 아님).

| 항목 | 결과 |
|---|---|
| HTTP `/health` (autocannon, 50 conn, 20s) | **44,456 req/s**, p50 0ms / p97.5 1ms / p99 2ms / max 24ms, 889,131 2xx, **0 error/timeout** |
| HTTP `/api/market/search` (50 conn, 20s) | **20,780 req/s**, p50 2ms / p99 5ms, 415,610 2xx, **0 error** |
| 1,000 VU HTTP 목표 | **NOT_EXECUTED** — 4-core 환경 한계. 실측 최대 50 conn에서 무오류·저지연 |
| 10,000 WS 연결 목표 | **NOT_EXECUTED** — 환경 한계 |
| Soak 2~8h | **NOT_EXECUTED** — 시간/자원 한계 |
| Chaos (PG 중단/DNS/429/5xx/timeout/gateway/restart) | **NOT_EXECUTED** — 본 세션 미수행 |

목표 미달 항목은 PASS로 만들지 않고 NOT_EXECUTED로 유지. 외부 운영 서비스 장애 주입 없음.

---

## K. IaC Static Validation (V8 — AWS 미실행)

- terraform fmt -check / init -backend=false / validate / tflint / checkov / tfsec **전부 PASS**(checkov 304 pass·0 fail·31 skip, tfsec 0 fail·44 checks, tflint 0). init은 backend 미접속.
- Stage 0 계약 19항목: **존재 14 / 부분 5 / 부재 0**. 7 Secrets(값 리소스 0개 → plan/state 유입 불가), 4 KMS CMK(rotation), RDS(암호화/SSL강제/multi-az), Redis TLS, ECR immutable(validation block), 21 alarms(18 app + 3 infra), 고정 NAT EIP 확인.
- **P1**: `alerting.tf:81`가 `docs/PHASE7-16-INCIDENT-RESPONSE.md`(리포에 **없음**)를 참조 → 21개 알람 runbook 앵커 파손.
- 부분: DNS(`enable_dns` default false), SNS 수신처 default `[]`, OTel collector 미구현(로그 그룹만), BitMart IP allowlist(out-of-band).
- `terraform plan/apply/destroy`·AWS API·secret 조회 **미실행**(금지 규칙).

---

## L. Stage 0 AWS Handoff (상세 `docs/STAGE0-AWS-HANDOFF.md`)

AWS 담당자용 실행 명령·예상 증거를 작성(미실행). Step -1(선행 수정: alerting runbook 경로, SNS 수신처, PostgreSQL 0006~0009 DDL) → Step 0~6(terraform apply 범위, Secrets 주입, KMS/RDS/ECR/알람 실물 확인, controlled live-order 승인 절차). secret은 `describe-secret` 메타데이터만 증거로 사용하도록 명시.

---

## M. Remaining Backlog

| ID | 우선 | 항목 | 근거 |
|---|---|---|---|
| BL-01 | **P1** | PostgreSQL DDL 4 migration 뒤처짐 (0006~0009 테이블 PG DDL 부재) | infrastructure/postgres 0005까지만. managed PG 채택 시 MFA/favorites/order_drafts/admin_ops 미동작 |
| BL-02 | **P1** | alerting.tf → 존재하지 않는 runbook 문서 참조 (21 알람 앵커 파손) | v8-iac-report |
| BL-03 | P2 | 문서 낡음 (README "Phase 1 MVP", Node 버전 불일치) | P7-R34 |
| BL-04 | P2 | IaC AWS-0104 egress 0.0.0.0/0:443 (NAT 경유, triaged) | trivy fs |
| BL-05 | P2 | dev-dep CRITICAL(vitest CVE-2026-47429) 등 9건 — dev/CI 한정 | osv/pnpm audit |
| BL-06 | P2 | Visual MAJOR 4 (사이드바·패널 제목 i18n·chart 크롬·768px) | V3 |
| BL-07 | P2 | pnpm 공급망 정책 부분 실효(minimumReleaseAge 미지원, .npmrc 0) | V5 |
| BL-08 | P3 | suppression owner/expiry 누락(IaC 30건), license 미식별 96.2% | V5 |
| BL-09 | P3 | OTel collector 미구현, SNS 수신처 공백, DNS default off | V8 |

Prompt 5 gitleaks 회귀는 `.gitleaks.toml` 문서화로 **해소**(PROMPT6_CHANGE, 미커밋).

---

## N. Phase 1~7 Final Verdict (V9)

| Phase | 원래 판정 | 현재 판정 | 변경 이유 / 조건 |
|---|---|---|---|
| 1 기반·UI 셸 | (RC) | **PASS** | 18/22 PASS, 4 CONDITIONAL(반응형 세부). 회귀 0 |
| 2 인증·영속 | (RC) | **CONDITIONAL_PASS** | SQLite 검증 견고하나 P2-R12(PG DDL 뒤처짐) FAIL로 managed PG 경로 미완 |
| 3 BitMart 트레이딩 | (RC) | **CONDITIONAL_PASS / Production 금지** | MOCK/read-only·리스크게이트·kill switch 견고. **Live BitMart 미검증 → Production PASS 불가**(BLOCKED_EXTERNAL) |
| 4 AI Copilot | (RC) | **CONDITIONAL_PASS / live-provider 금지** | mock provider·tool allowlist·injection 방어·컨텍스트 하드코딩 제거. **Live OpenAI 미검증 → live-provider PASS 불가** |
| 5 Admin | (RC) | **PASS** | 12/14 PASS, RBAC 100%, order-mutation 0. 1 CONDITIONAL·1 NA |
| 6 MFA·게이트웨이·관측 | approved(d63ee29) | **CONDITIONAL_PASS** | MFA/암호화 코드 견고하나 6 NOT_EXECUTED(soak/load/gateway scale)·PG DDL 의존 |
| 7 프로덕션 런칭·Stage 0 | (없음) | **BLOCKED** | AWS Stage 0 미실행(13 BLOCKED_EXTERNAL), P1 2건, 문서 낡음. Stage 0 BLOCKED 유지 |

**원칙 준수**: Phase 3 Live 미검증→Production PASS 없음, Phase 4 Live OpenAI 미검증→live-provider PASS 없음, Phase 7 AWS 미실행→BLOCKED, Pixel Fidelity 측정했으나 <1100px·Admin은 NOT_COMPARABLE/NOT_APPLICABLE로 100% 상향 안 함, 의도적 차단 실거래(DISABLED_BY_POLICY)와 미구현 구분.

---

## O. Production Go / No-Go

**NO-GO (현 상태). Production Readiness BLOCKED / Stage 0 BLOCKED.**

Go 전제(미충족):
1. AWS Stage 0 실행 및 실물 증거(IAM/Secrets/KMS/RDS/ECR/알람) — 담당자 인계.
2. Live BitMart read-only(Stage A) 및 controlled live-order 승인 절차 — 외부.
3. Live OpenAI 검증 — 외부.
4. P1 2건 해소: PostgreSQL 0006~0009 DDL, alerting runbook 경로.
5. soak/load(1000VU/10000WS)·chaos 실환경 실행.

RC 태그: **불가**(Stage 0 미통과). 안전 플래그(MOCK/live off/kill switch on) 불변.

---

## P. Commit Recommendation

- 이번 세션 PROMPT6_CHANGES: `.gitleaks.toml`(문서화 allowlist) + 신규 문서 3종(본 보고서/TRACEABILITY/STAGE0-HANDOFF). 전부 미커밋.
- 권장: 승인 시 파일 개별 지정 스테이징(보호 32 제외), 예시 메시지 `docs(phase7): Prompt 6 final integration audit + gitleaks allowlist refresh`.
- **금지 유지**: push, Phase 7 RC/Approved 태그, AWS/Terraform apply, Live 호출, 보호 artifact 스테이징.

---

## 필수 최종 출력값

| 항목 | 값 |
|---|---|
| 시작/종료 HEAD | 7e22d2f… / 7e22d2f… (불변) |
| Prompt 6 변경 파일 수 | remediation 반영: PG migration 8(.postgres.sql 4+down 4), 신규 test 2, runbook 1, neg-control script 1, e2e fixture 4, .gitleaks.toml 1, 문서 4 (§R) |
| 보호 artifact 32개 보존 | ✔ (HEAD 이후 수정 0건) |
| Phase별 최종 상태 | 1 **CONDITIONAL_PASS**(fidelity 78.92%, threshold 미정의) · 2 COND · 3 COND(Prod 금지) · 4 COND(live 금지) · 5 PASS · 6 COND · 7 BLOCKED |
| User structural/visual/data completeness | Structural 70.45% / Visual(overall) 78.92% / Data FULLY 7/8=87.5%·Policy 100% |
| Admin functional/API/RBAC | 비-API 기능 148/156, API FULL 17/24+PARTIAL 7/24(연결 100%), RBAC 100% |
| unique final tests | executions 1,488 / passed 1,487 / failed 0 / skipped 1 |
| supplemental/total executions | supplemental(Prompt5 로그) 5,018; Prompt6 세션 추가 실행 별도 원장(/tmp/p6logs) |
| security finding counts | prod 0 / dev 9(dev-only) / semgrep 0 / gitleaks: worktree 0(값 교체) · history 0(좁은 allowlist) · negative-control PASS / trivy fs 1(IaC AWS-0104, §R4) / image Trivy 0 |
| image / SBOM | image 66.6 MiB, Trivy 0 Critical/High, SBOM image 98 / source 550 / dir-script 934 |
| load / soak / chaos | HTTP 44k req/s(p99 2ms) 실측; 1000VU/10000WS/soak/chaos NOT_EXECUTED(환경 한계) |
| Live BitMart / OpenAI calls | 0 / 0 |
| AWS / Terraform | AWS API 0 · terraform plan/apply/destroy 0 · **terraform static(fmt/validate/tflint/checkov/tfsec) EXECUTED** · terraform **source mutation 0**(alerting.tf 미수정; BL-02는 runbook 문서 신설로 해소) |
| commit / tag / push | 0 / 0 / 0 |
| BL-01 PostgreSQL DDL parity | **RESOLVED** — PG 0006~0009 신설, 실 PG 11 parity + 12 legacy PASS |
| BL-02 alarm runbook | **RESOLVED** — runbook 신설(21 anchor 실절차) + link/anchor 테스트 5 PASS |
| Stage 0 | **BLOCKED** |
| Production Readiness | **BLOCKED** |
| Phase 7 RC tag 허용 | **불가** (Stage 0 미통과) |

---

## R. Prompt 6 Remediation (BL-01 / BL-02 / Gitleaks / Phase 1 재판정)

리뷰어 Remediation Gate(P1 2건) 대응. 커밋/태그/push/AWS/Terraform apply 없이 로컬에서 해소.

### R1 — BL-01 PostgreSQL migration parity (RESOLVED)
- 원인: `infrastructure/postgres`가 0005까지만 존재, SQLite는 0009까지. 9개 테이블(mfa_credentials, mfa_challenges, user_favorites, user_favorites_meta, account_lockouts, admin_reports, mock_gateway_state, ai_policy, ai_policy_history) + 컬럼(user_preferences.version, notifications.severity/read_at/correlation_id, order_drafts.source/executable/version/updated_at/idempotency_key/valid/allowed, incidents.acknowledged_at/by)의 PG DDL 부재.
- 조치: PG 0006~0009 `.postgres.sql` + `.down.postgres.sql` 신설. 타입 매핑 = user_id UUID(FK), ms-epoch → BIGINT, boolean flag → INTEGER(0/1, SQLite 미러 + `ai_policy.live_execution_enabled CHECK(=0)` 보존), JSON → TEXT, order_drafts 멱등 **partial unique index** 재현.
- 검증(임시 postgres:16-alpine, 격리 포트 15469, tmpfs, 실행 후 제거): 신규 parity **11 PASS**(clean install / 컬럼 존재 / idempotent / MFA PK·FK·CASCADE / favorites PK·ownership·optimistic version / order-draft partial-unique·NULL 허용·executable=0 / ai_policy CHECK·digest-only·version / lockouts·reports / incidents ack / tx rollback / down→re-apply) + 기존 legacy **12 PASS**. AWS/RDS 호출 0.
- **정확한 표현 분리**: 기존 PostgreSQL integration 12/12 = 테스트된 기존 PG 불변식 PASS. Prompt 5 전체 schema parity = 이제 PASS(신규 11건). **주의**: 앱 런타임 store는 여전히 SQLite(`openDb`)이고 PG repo 계층은 auth(User/Session/Audit)만 구현 — 신규 9테이블의 PG *repo* 컷오버는 별도 과제(BL-10, P2)로 남고, BL-01(스키마 DDL parity) 자체는 해소. Prompt 5 DB 완전 연결은 이 관점에서 SQLite=완전, managed-PG schema=parity 확보/repo 컷오버 잔여.

### R2 — BL-02 alarm runbook (RESOLVED)
- 원인: `alerting.tf:85` `runbook_base="docs/PHASE7-16-INCIDENT-RESPONSE.md"`가 존재하지 않는 파일 참조 → 21 알람 앵커 파손.
- 조치: **경로는 이미 정확**했으므로 alerting.tf **미수정**(terraform source mutation 0). 누락된 `docs/PHASE7-16-INCIDENT-RESPONSE.md`를 21개 anchor(api-5xx … redis-memory) 각각에 Symptom/Immediate/Diagnose/Recover/Escalate 실제 절차로 신설(placeholder·빈 heading 아님). 각 절차는 시스템 실제 설계(kill switch fail-closed, account_lockouts, 리스크게이트, RDS/redis, reconciliation 등) 기반.
- 자동 검증: `apps/api/src/__tests__/runbook-links.test.ts` — alerting.tf의 runbook_base 해석, 21 anchor 추출, 파일 존재 + GitHub-slug anchor 매칭 + 각 섹션 최소 본문 길이(placeholder 방지) 검사 → **5 PASS**.
- terraform 정적 재실행: fmt -check 0 / init -backend=false 0 / validate valid / tflint 0 / checkov 304 pass·0 fail·31 skip / tfsec no problems. plan/apply 미실행.

### R3 — Gitleaks suppression 재검증 + negative control
- fixture 값 교체(리뷰어 권고): 4개 스펙의 `password = 'longenough12345'` → `'e2e-fixture-not-a-secret'`(저엔트로피·비-secret 형태). **워킹트리 gitleaks = 0**(값이 rule 미트리거, `--no-git` 전체 스캔으로 확인).
- 히스토리: 커밋 7e22d2f(불변, rebase/force-push 금지)의 옛 값에만 **좁은 regex** `longenough12345` allowlist 유지 — 전체 파일/전체 rule 무시 아님. 기존 `resetlongenough123`/`AKIA1234567890`/`sk-x` + 문서 경로 1건과 함께 rule/file/line/근거/owner(QA·Platform Security)/expiry(2026-11-01) 명시. `detect`(히스토리) = **0**.
- **negative control**: `scripts/gitleaks-negative-control.sh` — 매 실행 랜덤 고엔트로피 secret을 임시 파일에 삽입 후 스캔 → **탐지됨(PASS)**. 설정이 전역적으로 탐지를 끄지 않았음을 증명. (AWS 예시키 `…EXAMPLEKEY`는 gitleaks 기본 allowlist라 negative control에서 배제.)

### R4 — Phase 1 재판정 + 표현 정정
- **Phase 1: PASS → CONDITIONAL_PASS.** 사용자 핵심 요구가 "목업 그대로 개발"인데 사전 정의된 fidelity acceptance threshold가 없고 MAJOR 차이 4건(사이드바·패널 제목 i18n·chart 크롬·768px)이 남아 Overall 78.92%. 기능·자동화 회귀는 PASS이나 구조/반응형 fidelity 미완 → CONDITIONAL_PASS가 정확.
- **AWS/Terraform 표현 분리**: AWS API call 0 · terraform plan/apply/destroy 0 · terraform **static commands EXECUTED**(fmt/validate/tflint/checkov/tfsec) · terraform **source mutation 0**(alerting.tf 미수정, BL-02는 문서 신설로 해소). `.terraform/`는 init 산물이며 .gitignore 대상·git 미추적.
- **Trivy filesystem 1건 상세**:

| 항목 | 값 |
|---|---|
| Advisory/Rule ID | AVD-AWS-0104 (trivy misconfig) |
| Severity | CRITICAL(trivy 파일-스코프); root-module 스코프에서는 0 failure |
| File/line | `infrastructure/terraform/phase7/network.tf:176` (`aws_vpc_security_group_egress_rule.api_https`) |
| Reason | egress `0.0.0.0/0` tcp/443. **단일 NAT EIP** 경유 고정 egress이며 BitMart/OpenAI HTTPS 아웃바운드에 필요. 인바운드 아님 |
| Reachability | 아웃바운드 443만; 고정 EIP는 BitMart IP allowlist에 등록되는 egress 지점 |
| Suppression 여부 | 미적용(FAIL로 정직 계상). checkov/tfsec/tflint는 미검출 — 도구·스코프 편차 실증 |
| Owner / expiry | Platform Security / Stage 0 apply 전 재검토(egress를 필요한 목적지 대역으로 좁힐지 결정) |
| Final gate impact | BL-04(P2). Production NO-GO의 독립 사유 아님(Stage 0 자체가 BLOCKED). RC 태그 전 결정 필요 |

### Remediation 후 Backlog 갱신
- BL-01 → **RESOLVED**(schema DDL parity). 신규 **BL-10(P2)**: 9개 신규 테이블의 PG *repo* 컷오버(런타임 store는 아직 SQLite).
- BL-02 → **RESOLVED**.
- 나머지 BL-03~09 유지. Production Readiness/Stage 0/RC tag 판정 불변: **BLOCKED / BLOCKED / 불가**.

---

## R5 / R6 Remediation (BL-10 Production DB runtime + Redis/Valkey role)

리뷰어 2차 지적(BL-10 P1 상향, Redis 모순 해소) 대응. 커밋/태그/push/AWS·RDS·ElastiCache 생성 없이 로컬 임시 컨테이너로만 검증.

### R5a — 프로덕션 DB fail-closed 가드 (구현·검증 완료)
- `assertProductionDatabaseReadiness`(env.ts): **NODE_ENV=production에서 `DATABASE_URL`(postgres://) 필수, SQLite/기타 backend 거부, 누락·비-postgres URL은 fail-closed**. index.ts 프로덕션 시작 블록에 배선(dev/e2e 무영향). backend는 서버 env로만 결정(클라이언트 입력 불가).
- 테스트 `production-db-guard.test.ts` **5 PASS**: dev 통과 / prod DATABASE_URL 없음 throw / 비-postgres throw / postgres 승인 / env-only 계약.
- 효과: **RDS 프로비저닝 후에도 앱이 SQLite로 조용히 돌아가는 상태가 불가능**(프로세스가 기동 거부).

### R5b — repository contract + PG 참조 구현 (favorites exemplar)
- `db/favorites-repo.ts`: async `IFavoritesRepo` contract + `SqliteFavoritesRepo`(dev, 기존 ResourceRepo 위임) + `PgFavoritesRepo`(prod, 실 pg, 파라미터화 쿼리, 단일 트랜잭션, `FOR UPDATE` optimistic version, user_id 스코프). auth 계층(IUserRepository)이 이미 쓰는 backend-추상화 패턴을 Prompt 5 도메인에 확립.
- `favorites-contract.test.ts`: **동일 계약을 양 backend에서** — SQLite 5 PASS, +임시 PG 5 PASS(총 10). ownership 격리·중복제거·optimistic conflict·cap·순서.
- **정직한 범위**: 이는 컷오버 패턴의 참조 구현이다. 나머지 도메인(preferences/notifications/order-drafts/mfa/lockouts/admin-ops/gateway/ai-policy)의 PG repo + **라우트 async 전환(~118 메서드/~124 호출부)** + 전체 E2E-on-PG는 대규모 작업으로 **BL-10(P1) OPEN 유지**. 단, R5a fail-closed 가드가 "SQLite로 프로덕션 기동"이라는 위험 상태를 원천 차단하므로, 미완 컷오버가 조용히 배포되는 일은 없다(프로덕션은 PG repo 완성 전까지 기동 불가 = 정직한 BLOCKED).
- **표현 분리**: 기존 PostgreSQL integration 12/12 = 기존 PG 불변식 PASS. PG schema parity(0006~0009) = PASS(11). Prompt 5 **runtime** DB connectivity = **CONDITIONAL_PASS**(스키마·참조 repo·가드 완료, 전체 repo 컷오버 잔여).

### R6a — Redis/Valkey 모순 해소 + 아키텍처 원장
- `docs/PHASE7-17-REDIS-VALKEY-ARCHITECTURE.md` 신설. **"Redis 2/2"는 실체**: `packages/cluster`의 **직접 구현 RESP 클라이언트**(`resp-client.ts`) + `RedisSharedState` + `RedisPubSub` + `redis.integration.test.ts`. npm `redis`/`ioredis` 의존성이 없던 이유는 원시 RESP 직접 구현. 이전 V5/V8의 "Redis 미사용" 판정은 `packages/cluster` 누락 → **정정: APPLICABLE**. 실사용처 = market-gateway(pubsub), mfa lockout(shared-state). apps/api rate-limit만 미연결(=결함). ElastiCache는 실제 필요하므로 제거하지 않음. State category 원장(store/target/consistency/TTL/multi-instance/failure) 포함.

### R6b — 분산 rate-limit (구현·검증 완료)
- `security/rate-limiter.ts`: `RateLimiter` 인터페이스 + `InMemoryRateLimiter`(dev) + `RedisRateLimiter`(prod, **EVAL 원자 INCR+PEXPIRE**, cluster RedisClient 재사용) + `FailClosedRateLimiter`(장애 시 deny) + `createRateLimiter`(**production은 REDIS_URL 필수, Map fallback 금지, 런타임 실패 deny**).
- 검증: 유닛 6 PASS + 임시 Redis(redis:7-alpine) **11 PASS** — atomic 동시성(50요청 중 정확히 30 허용), TTL/window 리셋, namespace/isolation, **multi-instance 예산 공유**(두 인스턴스가 하나의 Redis 예산 6 공유 → in-process Map의 N×budget 우회 차단), reconnect, production fail-closed.
- **잔여**: 기존 OrderRateLimiter/AdminRateLimiter/LoginRateLimiter 호출부를 이 어댑터로 교체(라우트 await) — **BL-11(P2)**. 어댑터·검증·production 선택 로직은 완료.

### R5/R6 회귀 (직접 실행)
| Suite | 결과 |
|---|---|
| lint / typecheck | 0 error / 0 error |
| apps/api (all) | 389 PASS / 29 SKIP (신규 db-guard 5 + rate-limiter unit 6 + favorites SQLite 5) |
| packages+web unit | 408 PASS |
| PostgreSQL (ephemeral): phase67 / legacy / favorites-contract | 11 / 12 / 5 PASS |
| Redis (ephemeral): rate-limiter | 11 PASS |
| User E2E 3-browser | 477 PASS |
| Admin E2E 3-browser | 222 PASS (1 webkit flaky[positions loading]→재실행 222; supplemental) |
| gitleaks worktree/history + negative-control | 0 / 0 / PASS |
| terraform fmt/validate/tflint/checkov/tfsec | pass/valid/0/304-0-31/0 |

### 파일 수 (git 실측)
```
porcelain entries:     62  (tracked-modified 41 + untracked 21)
tracked modified:      41  (보호 32 + Prompt6 9)
untracked actual:      21
Prompt6 actual files:  30  (9 수정 + 21 신규)
보호셋 ∩ Prompt6:      0
```
9 수정: .gitleaks.toml, apps/api/{package.json,src/env.ts,src/index.ts}, pnpm-lock.yaml, tests/e2e/flow-{r,s,t,u}. 21 신규: PG migration 8, test 5, favorites-repo, rate-limiter, runbook, redis 원장, neg-control script, docs 4(traceability/report/handoff/incident-response), redis-architecture.

### 테스트 표기 정규화 (replacement vs unique)
- **PostgreSQL 대체(replacement, unique 추가 아님)**: apps/api의 skip 중 PG 계열은 ephemeral PG로 실행됨. 단 phase67(11)·favorites PG(5)는 **신규 테스트**(unique 증가), postgres.integration legacy(12)는 기존 12 skip의 replacement.
- **신규 unique**: runbook-links 5, production-db-guard 5, rate-limiter 6(+Redis 11), phase67 11, favorites-contract 5(+PG 5). 이들은 Prompt5 1,488에 대한 **신규 unique 증가**이며 replacement 아님.
- 잔여 SKIP 1건 = stage-a-probe(STAGE_A_LIVE, BLOCKED_EXTERNAL). Redis 계열 skip은 ephemeral로 대체 실행됨.

### Backlog 갱신
- BL-01 RESOLVED(DDL parity), **BL-10 P1 OPEN**(runtime repo 컷오버 — 참조 구현·가드 완료, 전체 도메인 잔여), **BL-11 P2**(rate-limit 호출부 교체 — 어댑터 완료). Redis NOT_APPLICABLE 판정 **철회**(APPLICABLE, 부분 연결).
- 판정 불변: Production Readiness **BLOCKED**, Stage 0 **BLOCKED**, Phase 7 RC tag **불가**.

---

## R5/R6 Safety Wiring 완결 (repository-aware guard + limiter 실제 연결)

리뷰어 3차 지적 반영: (1) URL 존재만으로는 SQLite 런타임을 못 막음 → **repository-aware** guard, (2) 미연결 Redis limiter는 무효 → **실제 호출부 연결**. BL-11 P1 상향.

### repository-aware production startup guard (완료)
- `db/repository-registry.ts`: `REQUIRED_PRODUCTION_REPOSITORY_IDS`(auth.users/sessions/audit, mfa, account_lockout, favorites, preferences, notifications, order_drafts, admin_operations, gateway_state, ai_policy) + `assertProductionRepositoryReadiness(descriptors, isProduction)`. 각 repo는 실제 wiring에서 `backend`/`productionReady` 선언. **production은 모든 필수 repo가 backend='postgres' && productionReady일 때만 기동**, 아니면 offender 목록과 함께 throw. env/client boolean으로 우회 불가.
- index.ts 배선: 런타임이 `openDb`(SQLite)이므로 descriptor 전부 sqlite → **현재 production은 의도적으로 기동 거부**(honest fail-closed). "postgres:// URL이 있어도 실제 repo가 SQLite면 거부"를 실증.
- 테스트 `repository-registry.test.ts` **9 PASS**: all-PG boot / all-SQLite refuse / partial-PG refuse(order_drafts=not_postgres) / not-ready refuse / missing refuse / dev·test allow / boolean 우회 불가 / 필수셋 커버.
- → 이제 **"Production cannot silently run on SQLite"가 사실**(URL이 아니라 실제 wired backend 검사).

### Redis limiter 실제 호출부 연결 (완료, BL-11 P1)
- order-routes/admin-routes의 in-process `Map` limiter 클래스 **제거**, 주입식 `RateLimiter`로 교체(`await rl.allow(\`order:${uid}\`|\`admin:${uid}\`, limit, 60_000)`). index.ts가 `createRateLimiter({isProduction, redisUrl})`로 **단일 공유 limiter** 생성해 양 라우터에 주입. production=Redis(REDIS_URL 필수, fail-closed), dev/e2e=InMemory.
- `rediss://`(TLS): `parseRedisUrl`이 스킴으로 tls 판정, RedisClient에 additive `tls`/`tlsServerName` 옵션 + `tls.connect` 분기(gateway/mfa 소비자 회귀 0: cluster 10/mfa 20/gateway 13 PASS). 실제 ElastiCache TLS 핸드셰이크는 Stage 0 BLOCKED_EXTERNAL, 구성·옵션 전달은 로컬 검증.
- 테스트: rate-limiter 유닛+rediss/tls/timeout/credential **10 PASS** + 임시 Redis 통합 **5 PASS**(합 15); HTTP wiring `rate-limit-http.test.ts` **3 PASS**(429+Retry-After, 다중 인스턴스 공유 예산, 주입 limiter 실제 사용을 denying-stub로 증명). credential 로그 미노출, timeout fail-closed.
- **잔여 정직 기록**: login(실패-기반 LoginRateLimiter)·MFA(persisted lockout)·AI(비용-기반)는 별개 메커니즘 — 분산 request-rate limiter 연결은 order/admin(감사가 지목한 Map limiter) 완료. login-failure 분산화는 BL-11 잔여 범위.

### 최종 회귀 (직접 실행, HEAD 7e22d2f + PROMPT6_CHANGES)
| Gate | 결과 |
|---|---|
| lint / typecheck | 0 error / 0 error |
| apps/api (all) | 405 PASS / 29 SKIP |
| packages+web unit | 408 PASS |
| PG ephemeral: phase67 / legacy / favorites-contract | 11 / 12 / 10 PASS |
| Redis ephemeral: rate-limiter | 15 PASS (10 unit + 5 integration) |
| repository-registry / production-db-guard / rate-limit-http | 9 / 5 / 3 PASS |
| cluster / mfa / gateway (tls 회귀) | 10 / 20 / 13 PASS |
| User E2E 3-browser | 477 PASS (1 firefox visual-audit flaky[h1]→재실행 3 PASS; supplemental) |
| Admin E2E 3-browser | 222 PASS |
| gitleaks worktree/history + negative-control | 0 / 0 / PASS |

### 파일 수 (git 실측)
```
porcelain 68 = tracked-modified 44(보호 32 + Prompt6 12) + untracked 24
Prompt6 actual files: 36 (12 수정 + 24 신규)
보호셋 ∩ Prompt6 = 0
```

### Backlog 최종
- BL-01 RESOLVED, BL-02 RESOLVED.
- **BL-10 P1 OPEN** — 전체 PostgreSQL repository 런타임 컷오버(~118 메서드/~124 호출부 async 전환 + 전체 E2E-on-PG)는 **독립 후속 P1 배치**. 단 **repository-aware guard가 미완 상태의 프로덕션 기동을 원천 차단**(honest BLOCKED), favorites PG 참조 구현 + 계약 테스트로 패턴 확립.
- **BL-11 (P1) 부분 완료** — 분산 limiter 구현 + order/admin 실제 호출부 연결 + 검증 완료. login-failure/MFA/AI 메커니즘 분산화 잔여.
- Production Readiness **BLOCKED** / Stage 0 **BLOCKED** / Phase 7 RC tag **불가** / Prompt 5 Runtime DB **CONDITIONAL_PASS**.

---

## 체크포인트 커밋 시점 정확 표현 (승인 조건)

이 커밋은 **Production 승인 커밋이 아니라 fail-closed 안전장치 + 최종 감사 체크포인트**다.

**BL-10 (P1 OPEN)**: Production이 SQLite로 **조용히** 기동되는 위험은 repository-aware guard로 **차단**됐다. 그러나 PostgreSQL repository 런타임 컷오버 미완으로 **Production 자체가 기동 불가능**하다(guard가 fail-closed로 거부). "Production runtime DB 연결 완료"가 **아니다** — Prompt 5 Runtime DB = **CONDITIONAL_PASS**.

**BL-11 (P1 OPEN)**: Order/Admin 경로의 분산 rate-limit **우회는 해결**됐다(주입식 Redis limiter 실연결 + 검증). 그러나 Login(실패-기반)/MFA(persisted lockout)/AI(비용-기반) 경로는 **별도 제어를 사용하며 분산 통합 검증이 남았다**. "BL-11 전체 해결"이 **아니다**.

### 실행 원장 (재검증 — 분리, 기존 Unique Final에 단순 가산 금지)
```
Unique final cases (Prompt6 재검증 시점):
  apps/api 405 PASS / 29 SKIP, packages+web 408, User E2E 477(3-browser), Admin E2E 222(3-browser)
Final replacement evidence (기존 skip의 ephemeral 대체 실행, unique 추가 아님):
  PG legacy 12 (postgres.integration), Redis 5 (rate-limiter integration)
Unique 증가(신규 테스트, replacement 아님):
  repository-registry 9, production-db-guard 5, rate-limiter unit 10(+rediss/tls/timeout), rate-limit-http 3,
  postgres-phase67 11, favorites-contract 5(SQLite)+5(PG), runbook-links 5
Supplemental executions:
  개발/재검증 재실행(각 R단계 로그 /tmp/p6logs) — Final과 분리, 단순 합산하지 않음
Flaky retry executions:
  - Observed flaky failure: 1 (firefox zz-visual-audit "exactly one h1")
    Replacement rerun: 3 PASS (chromium/firefox/webkit)
    Final gate impact: 0
    Flaky status: TRIAGED (측정 스펙의 firefox 렌더 타이밍; 코드 변경과 무관)
  - Observed flaky failure: 1 (webkit admin-a4 positions 'loading', 앞선 R단계)
    Replacement rerun: 222 PASS · Final gate impact: 0 · Flaky status: TRIAGED
Intentional skip:
  stage-a-probe 1 (STAGE_A_LIVE, BLOCKED_EXTERNAL). Redis/PG 계열 skip은 ephemeral로 대체 실행됨.
```
