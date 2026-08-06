# 03 — Mock vs Real Implementation Matrix (authoritative)

This is the single source of truth for "what is real". Legend in `00-architecture.md`.

| Capability | Implementation | Data source | Status |
|---|---|---|---|
| Design tokens (OKLCH 3-layer) | real CSS + typed TS | prototype verbatim | ✅ |
| Zod schemas (Widget/Layout/ChartCommand/Signal/Order) | real | — | ✅ |
| Runtime validation of external responses | real (Zod) | — | ✅ |
| Decimal order math (value/fee/liq est/RR/max loss) | real | — | ✅ |
| Order state machine (12 states) | real | — | ✅ |
| Signal state machine (10 states) + confirm gate | real | — | ✅ |
| Layout engine (collision/snap/undo/redo/migration) | real | — | ✅ (core unit-tested) |
| BitMart candle normalization (dedup/OOO/OHLC) | real | pure fn, tested w/ fixtures | ✅ |
| Order book sequence/gap resync logic | real | pure fn, tested | ✅ |
| Recent trades dedup + bounded buffer | real | pure fn, tested | ✅ |
| BitMart REST historical candles | real HTTP | **live BitMart public** | 🌐✅ verified live (real BTC/ETH klines; start_time/end_time fix) |
| BitMart REST ticker (last/index/funding/24h) | real HTTP | **live BitMart public** | 🌐✅ verified live (BTCUSDT last=63209.5, funding=0.0000515) |
| BitMart REST symbols (contract details) | real HTTP | **live BitMart public** | 🌐✅ verified live (1215 contracts; tick/step/precision mapped) |
| BitMart WS realtime candle/book/trade | real client code | live BitMart public | 🟡 subscription lifecycle unit-tested (fake WS); live env unverified |
| MockReplay provider | real | deterministic seed | 🧪✅ verified live (BFF MOCK_REPLAY) |
| Rate-limit token bucket + backoff + circuit breaker | real | config-driven | ✅ reliability-tested (429/timeout/5xx) |
| Hono BFF market-data proxy routes | real | proxies provider | 🟡✅ smoke-verified both modes |
| SSE fan-out endpoint | real interface | in-memory pub/sub | 🟡 (single-node) |
| AI orchestrator + provider adapter | real boundary | — | 🟡 |
| MockAIProvider (structured tool calls) | real | scripted deterministic | 🧪 |
| OpenAI-compatible provider | interface | — | 🔌 |
| ChartCommand allowlist enforcement | real | Zod + permission check | ✅ |
| KLineChart renderer | adapter real | npm klinecharts pinned | 🔌/🟡 |
| Simulated order fills | real | mock state machine | 🧪 |
| BitMart Demo trading adapter | — | — | 🔌 (interface) |
| BitMart production orders | — | — | ⛔ hard-disabled |
| Auth / session / cookies | policy + interface | — | 🔌/📄 |
| **Phase 2 — Auth (scrypt hash, session, CSRF, RBAC, rate limit, audit)** | real | `packages/auth` + SQLite | ✅ (unit + api tests) |
| **Phase 2 — DB persistence (SQLite dev, Postgres-portable DDL, migrations)** | real | `apps/api/src/db` | ✅ (migration + repo tests) |
| **Phase 2 Closure — real PostgreSQL 16 integration** | real | Docker `postgres:16` | ✅ 11 tests: migrate up/down, tx rollback, unique/FK/index, 20 concurrent sessions, pooling, repo parity, SQLi-safe, reconnect, restart, empty bootstrap |
| **Phase 2 Closure — HMAC signed session-bound CSRF + Origin check** | real | `packages/auth/csrf` | ✅ (missing/mismatch/cross-origin tests) |
| **Phase 2 Closure — RBAC 6 roles / 12 permissions (server-enforced)** | real | `packages/auth/policy` | ✅ (vertical/horizontal priv-esc tests) |
| **Phase 2 Closure — hashed session tokens + rotation + device list + revoke** | real | `packages/auth/service` | ✅ |
| **Phase 2 Closure — auth lifecycle (verify/reset/change/disable, hashed single-use tokens)** | real | `packages/auth` + MailSink | ✅ (Mock mail = MailSink; real MailProvider = interface) |
| **Phase 2 Closure — user-owned persistence + cross-user isolation** | real | `apps/api/src/db/resource-repo` | ✅ (layouts+versions/signals+versions/order-drafts/overlays/conversations+messages/sim-orders/preferences) |
| **Phase 2 — Web login/signup wired (optional, /trade public)** | real | BFF `/api/auth/*` | ✅ (1 auth e2e) |
| Real email sending (SMTP/SES) | interface only (MailProvider) | — | 🔌 (dev uses MailSink) |
| Exchange credential vault (KMS envelope) | interface only | — | 🔌/📄 |
| PostgreSQL persistence | schema proposal | — | 📄 |
| Redis cache/pub-sub/rate-limit | interface | — | 🔌/📄 |
| Queue / DLQ | — | — | 📄 |
| Object storage (reports) | — | — | 📄 |
| Observability (structured logs/metrics/trace) | partial (logger iface) | — | 🟡/📄 |
| Reliability scenarios (WS disc/reconnect, timeout, 429, malformed, dup, OOO, AI timeout, offline, layout corruption, invalid ChartCommand) | real | deterministic tests | ✅ 12/12 reproduced (see docs/16) |
| E2E (Playwright flows A–E) | scripts | Chromium (auto webServer) | ✅ executed, 5/5 pass (Chromium) |
| E2E Firefox / WebKit | scripts | — | 📄 not executed (browsers not installed) |
| Load tests (k6 profiles 1–10) | scripts | — | 📄 not executed |
| Visual regression / a11y automated | — | — | 📄 |

**No capability in this matrix is marked "passed/verified" unless it has a corresponding passing
automated test in this repo (✅), or it genuinely hits live public BitMart (🌐).**
