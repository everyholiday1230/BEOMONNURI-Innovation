# PHASE 8 · 01 — 신규 디자인(42라우트) vs 기존 백엔드 갭 분석

**작성일**: 2026-08-02
**분석 대상**: `team_delivery/` 디자인 핸드오프 (프론트 42라우트) ↔ `apps/api` 기존 구현
**방법**: 추측 없음. 라우트는 `team_delivery/src/app.jsx`에서, 스키마는 `mock-app-data.js`를
node VM으로 실제 로드해 추출. 기존 엔드포인트는 `apps/api/src`의 `.get/.post/...` 호출을
grep으로 전수 추출. 부재 판정은 키워드 grep 파일수 0으로 확인.

---

## 0. 검증 베이스라인 (본 분석 시점)

작업 트리(미커밋 프론트 변경 포함) 기준, 전부 실제 실행:

| 명령 | exit | 결과 |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | 22 workspace projects |
| `pnpm -r typecheck` | 0 | 22개 전부 |
| `pnpm -r test` | 0 | **975 passed / 39 skipped** |
| `pnpm build` | 0 | — |
| 통합(PG16+Redis7 임시 컨테이너) | 0 | **64 passed / 0 skipped** |

skip 39의 정체: `PG_TEST_URL` 게이팅 23 (`postgres.integration.test.ts:12`,
`postgres-phase67.integration.test.ts:22`), `REDIS_TEST_URL` 게이팅 15
(`rate-limiter.test.ts:66`, `login-mfa-rate-limit.test.ts:305`), `STAGE_A_LIVE` 1
(`stage-a-probe.test.ts:46`). 앞의 38개는 임시 컨테이너로 전부 실행해 통과시켰다.

**유일한 미검증 항목**: `stage-a-probe.test.ts:46` — 실 BitMart REST + AWS Secrets Manager
라이브 호출. 실 자격증명 필요. 사용자 결정 대기.

**주의**: `scripts/phase6-verify.sh:12`의 기본 `PG_TEST_URL`은 포트 15432를 가리키는데,
이 머신에서 15432/16379는 타 프로젝트 컨테이너(`newchart-postgres-1`, `newchart-redis-1`)가
점유 중이다. 그대로 실행하면 타 프로젝트 DB에 접속한다. 15499/16399를 쓸 것.

---

## 1. 라우트 전수 (42개) — 근거: `team_delivery/src/app.jsx`

| # | 라우트 | 파일:라인 | Role |
|---|---|---|---|
| 1 | `/` | app.jsx:288 | public |
| 2 | `/login` | app.jsx:289 | public |
| 3 | `/signup` | app.jsx:290 | public |
| 4 | `/verify-email` | app.jsx:291 | public |
| 5 | `/kyc` | app.jsx:292 | public |
| 6 | `/password-reset` | app.jsx:293 | public |
| 7 | `/trade` | app.jsx:261 | user+ |
| 8 | `/markets` | app.jsx:429 | user+ |
| 9 | `/ai-strategies` | app.jsx:430 | user+ |
| 10 | `/ai-strategies/detail?id=` | app.jsx:431 | user+ |
| 11 | `/ai-strategies/my` | app.jsx:432 | user+ |
| 12 | `/portfolio` | app.jsx:433 | user+ |
| 13 | `/analytics` | app.jsx:434 | user+ |
| 14 | `/multi-chart` | app.jsx:435 | user+ |
| 15 | `/wallet` | app.jsx:436 | user+ |
| 16 | `/wallet/deposit` | app.jsx:437 | user+ |
| 17 | `/wallet/withdraw` | app.jsx:438 | user+ |
| 18 | `/wallet/transactions` | app.jsx:439 | user+ |
| 19 | `/referral` | app.jsx:440 | user+ |
| 20 | `/fees` | app.jsx:441 | user+ |
| 21 | `/help` | app.jsx:442 | user+ |
| 22 | `/settings` | app.jsx:443 | user+ |
| 23 | `/notifications` | app.jsx:444 | user+ |
| 24 | `/order-history` | app.jsx:445 | user+ |
| 25 | `/admin` | app.jsx:448 | ops+ |
| 26 | `/admin/users` | app.jsx:449 | ops+ |
| 27 | `/admin/users/detail?id=` | app.jsx:450 | ops+ |
| 28 | `/admin/trades` | app.jsx:451 | ops+ |
| 29 | `/admin/ai-ops` | app.jsx:452 | admin+ |
| 30 | `/admin/design-ops` | app.jsx:453 | super |
| 31 | `/admin/risk` | app.jsx:454 | admin+ |
| 32 | `/admin/assets` | app.jsx:455 | admin+ |
| 33 | `/admin/kyc` | app.jsx:456 | ops+ |
| 34 | `/admin/deposits` | app.jsx:457 | admin+ |
| 35 | `/admin/withdrawals` | app.jsx:458 | admin+ |
| 36 | `/admin/fees` | app.jsx:459 | admin+ |
| 37 | `/admin/notices` | app.jsx:460 | ops+ |
| 38 | `/admin/notices/new` | app.jsx:461 | ops+ |
| 39 | `/admin/system` | app.jsx:462 | admin+ |
| 40 | `/admin/audit` | app.jsx:463 | admin+ |
| 41 | `/admin/broadcast` | app.jsx:464 | admin+ |
| 42 | `/admin/cs?id=` | app.jsx:465 | ops+ |

Role 매핑 근거: `page-shell.jsx`의 `SIDEBAR_ITEMS[].roles`.

---

## 2. 도메인별 갭

부재 판정 근거 (`grep -ril <kw> apps/api/src packages --include='*.ts'`, 테스트 제외):

```
kyc=0  referral=0  deposit=0  strategy=0  promotion=0
fee_tier=0  feeTier=0  broadcast=0  notice=0  ticket=0
allocation=0  equity_curve=0  equityCurve=0
withdraw=3 → 전부 AI 안전가드 문자열/주석 (packages/ai/src/safety.ts:31,
             prompts.ts:23, trading/stage-a-probe.ts:6). 출금 기능 아님.
journal=3  → 전부 SQLite `journal_mode` (db/sqlite.ts:14, db/admin-repos.ts:674+).
             트레이드 저널 아님.
```

### 2.1 이미 구현되어 있음 (재사용)

| 프론트 라우트 | 기존 엔드포인트 | 근거 |
|---|---|---|
| `/login` `/signup` `/verify-email` `/password-reset` | `/auth/login` `/auth/register` `/auth/verify-email` `/auth/verify-email/request` `/auth/forgot-password` `/auth/reset-password` `/auth/csrf` `/auth/logout` | `auth-routes.ts` |
| `/login` 2FA | `/auth/mfa/challenge` `/auth/mfa/totp/setup` `/auth/mfa/totp/verify-enrollment` `/auth/mfa/recovery` `/auth/mfa/step-up` | `mfa/mfa-routes.ts` |
| `/settings` 보안탭 (세션) | `/auth/sessions` `/auth/sessions/revoke` `/auth/sessions/revoke-others` `/auth/change-password` | `auth-routes.ts` |
| `/settings` 프로필/환경/계정관리 | `/account/me` `/account/preferences` `/account/summary` `/account/assets` `/account/disable` `/account/mfa/*` | `auth-routes.ts` |
| `/markets` | `/api/market/symbols` `/ticker` `/candles` `/orderbook` `/trades` `/market/search` | `market/market-routes.ts`, `market/search.ts` |
| `/trade` 실시간 | `/api/stream/market` + `apps/market-gateway` | `market-routes.ts` |
| `/trade` 주문 | `/orders/draft` `/orders/validate` `/orders/open` `/orders/history` `/trading/orders/submit` `/api/sim/orders` `/api/sim/orders/confirm` | `portfolio/order-routes.ts`, `trading-routes.ts`, `sim/order-engine.ts` |
| `/trade` 리스크 | `trading/risk-engine.ts` | — |
| `/portfolio` 포지션 | `/positions` `/positions/:id/close-draft` `/positions/:id/margin-adjustment/validate` `/trades` | `portfolio/portfolio-routes.ts` |
| `/order-history` | `/orders/history` | `portfolio/order-routes.ts` |
| `/notifications` | `/notifications` `/notifications/:id/read` `/notifications/read-all` | `notifications/notification-routes.ts` |
| `/trade` AI Copilot | `/ai/copilot` `/ai/status` `/ai/conversations` `/api/ai/analyze` | `ai-routes.ts`, `ai/production-ai.ts` |
| `/trade` 레이아웃 | `/me/layouts` `/me/layouts/:id` `/me/layouts/:id/versions` `/me/overlays` `/me/favorites` | — |
| `/admin` 대시보드 | `/admin/overview` `/admin/system/health` | `admin/admin-routes.ts` |
| `/admin/users` `/admin/users/detail` | `/admin/users` `/admin/users/:id` `/:id/disable` `/:id/enable` `/:id/role` `/:id/unlock` `/:id/revoke-sessions` | `admin/admin-routes.ts` |
| `/admin/trades` | `/admin/orders` `/admin/positions` | `admin/admin-routes.ts` |
| `/admin/ai-ops` | `/admin/ai/usage` `/admin/ai/errors` `/admin/ai/policy` | `admin/admin-routes.ts` |
| `/admin/system` | `/admin/system/health` `/admin/gateway/metrics` `/admin/gateway/reconnect` `/admin/gateway/resync` `/admin/backup/status` `/admin/incidents` `/admin/kill-switches` `/admin/feature-flags` `/admin/release-gates` | `admin/admin-routes.ts` |
| `/admin/audit` | `/admin/audit` `/admin/audit/export` | `admin/admin-routes.ts` |
| `/wallet` 거래소 연동 | `/trading/credentials` `/trading/credentials/:id` `/:id/verify` `/trading/connection-status` `/admin/exchange-connections` | `trading-routes.ts`, `trading/credential-vault.ts` |

### 2.2 완전 부재 — 신규 구현 필요

| # | 도메인 | 프론트 라우트 | 필요 엔드포인트(제안) | 스키마 근거 |
|---|---|---|---|---|
| G1 | **거래소 카탈로그** | `/wallet`, `/` (랜딩) | `GET /api/v1/exchanges` | `QTApp.EXCHANGES` (8개, 15필드) |
| G2 | **KYC** | `/kyc`, `/admin/kyc` | `POST /kyc/applications` · `POST /kyc/documents` · `GET /kyc/status` · `GET /admin/kyc/queue` · `POST /admin/kyc/:id/{approve,reject,review}` | `pages-admin-more.jsx:274-277` |
| G3 | **입금** | `/wallet/deposit`, `/admin/deposits` | `GET /wallet/deposit/address?asset=&network=` · `GET /wallet/deposit/history` · `GET /admin/deposits` · `POST /admin/deposits/:id/{approve,reject}` | `pages-more.jsx:234-236`, `pages-admin-more.jsx:330-333` |
| G4 | **출금** | `/wallet/withdraw`, `/admin/withdrawals` | `POST /wallet/withdraw` · `GET /wallet/withdraw/limits` · `GET/POST /wallet/addresses` · `GET /admin/withdrawals` · `POST /admin/withdrawals/:id/{approve,reject}` | `pages-more.jsx:425-426`, `pages-admin-more.jsx:368-371` |
| G5 | **트랜잭션 원장** | `/wallet/transactions` | `GET /wallet/transactions?kind=&q=` | `pages-more.jsx:481-488` (kind 6종: deposit·withdraw·transfer·trade·fee·rebate) |
| G6 | **AI 전략** | `/ai-strategies`, `/detail`, `/my` | `GET /strategies` · `GET /strategies/:id` · `GET /strategies/:id/{backtest,trades,reviews}` · `POST/DELETE /strategies/:id/follow` · `GET /me/strategies` | `QTApp.STRATEGIES` (11필드), `pages-more.jsx:713-716, 738-740` |
| G7 | **애널리틱스·저널** | `/analytics` | `GET /analytics/journal` · `GET /analytics/daily-pnl` · `GET /analytics/insights` | `QTApp.TRADE_JOURNAL` (11필드, mood·tag 포함) |
| G8 | **포트폴리오 집계** | `/portfolio` | `GET /portfolio/allocation` · `GET /portfolio/equity-curve?days=30` | `QTApp.ALLOCATION`, `QTApp.EQUITY_CURVE` |
| G9 | **Referral** | `/referral` | `GET /referral/summary` · `GET /referral/tiers` · `GET /referral/invitees` · `GET /referral/payouts` | `pages-more.jsx:853-857` (5티어 20/25/30/35/40%) |
| G10 | **수수료·프로모션** | `/fees`, `/admin/fees` | `GET /fees/me` · `GET /fees/tiers` · `GET /promotions` · `GET/PUT /admin/fees/tiers` · `GET/POST /admin/promotions` | `QTApp.FEE_TIERS`, `QTApp.PROMOTIONS` |
| G11 | **Hot/Cold 자산** | `/admin/assets` | `GET /admin/assets/{hot,cold}` · `GET /admin/assets/reserve-ratio` · `POST /admin/assets/transfer` | `pages-admin-more.jsx:682-685, 699-702` (multi-sig 3-of-5) |
| G12 | **공지·CS** | `/admin/notices`, `/notices/new`, `/admin/cs`, `/help` | `GET/POST /admin/notices` · `GET /notices` · `GET /admin/cs/tickets` · `GET /admin/cs/tickets/:id` · `POST /admin/cs/tickets/:id/reply` · `GET /help/faq` | `QTApp.NOTICES`, `QTApp.CS_TICKETS`, `pages-more.jsx:982-988` |
| G13 | **Broadcast** | `/admin/broadcast` | `POST /admin/broadcast` · `GET /admin/broadcast/segments` | `pages-admin-more.jsx:420-424` (5 세그먼트) |
| G14 | **관리자 리스크 큐** | `/admin/risk` | `GET /admin/risk/queue` | `QTApp.ADMIN_RISK_QUEUE` (10필드, marginRatio·liqDist·severity) |
| G15 | **실시간 거래 스트림** | `/admin/trades` | `WS /admin/trades/stream` | `QTApp.ADMIN_LIVE_TRADES` (8필드) |
| G16 | **Design Ops** | `/admin/design-ops` | `GET /admin/design-ops/tokens` · `GET /admin/design-ops/changes` | `QTApp.DESIGN_OPS` |
| G17 | **사용자 활동 로그** | `/admin/users/detail` 활동탭 | `GET /admin/users/:id/activity` | `pages-admin-more.jsx:201-207` |

### 2.3 부분 구현 — 확장 필요

| 도메인 | 현재 | 필요 확장 |
|---|---|---|
| 거래소 어댑터 | BitMart만 (`packages/exchange-bitmart`) + Mock | 8개 (Binance·Bitget·OKX·Bybit·Gate·Kraken·Coinbase 추가) |
| 주문 유형 | Limit·Market·Trigger 계열 | OCO·TWAP·Iceberg |
| 거래 모드 | `TRADING_MODE=MOCK` 강제 | 실주문 경로 (KYC L1 게이팅 포함) |
| `/admin/users` | 정지/역할/잠금해제 | KYC 레벨 필드, `flags`, `country`, `vol30` |

---

## 3. 구현 순서 (의존성 기준)

의존성이 없고 프론트가 즉시 붙을 수 있는 것부터.

| 단계 | 항목 | 외부 의존 | 비고 |
|---|---|---|---|
| **S1** | G1 거래소 카탈로그 | 없음 | referral 링크는 대표님 확정 필요 (placeholder로 시작 가능) |
| **S2** | G10 수수료·티어, G9 Referral 조회 | 없음 | 계산 로직은 거래량 데이터 필요 → 조회 API 먼저 |
| **S3** | G7 저널, G8 포트폴리오 집계 | 없음 | 기존 `/trades` `/positions` 데이터 재사용 |
| **S4** | G6 AI 전략 | 없음 | 백테스트 엔진은 P2, 조회/팔로우 먼저 |
| **S5** | G12 공지·CS, G13 Broadcast, G16 Design Ops, G17 활동로그 | 알림 채널(P1) | DB + 관리자 CRUD |
| **S6** | G14 리스크 큐, G15 거래 스트림 | 없음 | 기존 risk-engine·gateway 재사용 |
| **S7** | G2 KYC | **벤더 선정 필요** (Onfido·Jumio·Sumsub) | 어댑터 인터페이스 먼저 |
| **S8** | G3·G4·G5 입출금·원장 | **커스터디 선정 필요** (Fireblocks vs 자체 multi-sig), 블록체인 노드 | 원장(G5)은 의존 없이 선행 가능 |
| **S9** | G11 Hot/Cold 자산 | S8 의존 | — |
| **S10** | 거래소 어댑터 7개 추가 | 각 거래소 API 계정 | — |

### 사용자 결정이 필요한 항목 (블로커)

1. **8개 거래소 referral 링크 확정** — G1에 필요. 임시로 placeholder 사용 가능.
2. **KYC 벤더** — G2. 어댑터 인터페이스만 먼저 만들 수 있음.
3. **커스터디 방식** — G4·G11. Fireblocks / 자체 multi-sig / 거래소 위탁.
4. **BitMart 실 API 키 + AWS 계정** — `stage-a-probe` 라이브 검증 및 실주문.
5. **알림 채널 벤더** — G13. SendGrid/SES · Twilio · FCM/APNs.
6. **프론트엔드 전략** — `team_delivery`는 정적 SPA(React CDN + JSX in browser),
   기존 `apps/web`은 Vite+TS SPA로 라우트 구성이 다르다. 옵션 A(정적 SPA에 API 연결) /
   옵션 B(`apps/web`으로 42라우트 이식) 중 결정 필요. 백엔드 API 자체는 어느 쪽이든 동일.
