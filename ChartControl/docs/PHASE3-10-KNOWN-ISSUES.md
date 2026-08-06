# PHASE 3 — Known Issues

- **Credential rotation required:** during testing a real BitMart API key was pasted into chat by the
  owner and used for a one-off read-only probe (`phase3-stageA-live.log`, masked). That key is
  compromised and MUST be rotated; future credentials must load only via AWS Secrets Manager / env,
  never via chat.
- Stage A via AWS Secrets Manager (2026-07-29 re-attempt): **Not Executed / FAIL-CLOSED** — runtime has an
  IAM role + fixed egress IP, but at the time `@aws-sdk` was not installed and `BITMART_SECRET_ARN`/
  `AWS_REGION` were unset. **Security-hardening pass since applied**: `@aws-sdk/client-secrets-manager`
  is now an explicit API production dependency; a production **startup fail-closed guard** refuses to
  boot without SDK + Secret ARN + region; the Stage A probe is now `apps/api/src/trading/stage-a-probe.ts`
  and loads credentials **only** via `credential-source.ts` → AWS Secrets Manager (no env/CLI/file secret;
  the old `scripts/phase3-stageA-live.mjs` env-injection path was **removed**). To run live: set
  `BITMART_SECRET_ARN` + `AWS_REGION`, whitelist egress `15.164.47.4`, run the probe with `STAGE_A_LIVE=1`.
- Live Validation Pass (2026-07-29): **30-min/2-h Private WS soak, Controlled Live Order = Not Executed**
  (no real credential / owner authorization). Deployment env verified credential-free.
- `BITMART_WS_PRIVATE` is now wired into `env.ts` + `BitMartPrivateStreamAdapter` with a production-only
  allowlist (demo/non-official rejected fail-closed). Live private-WS connect still needs real credentials.
- Real BitMart Production Read-Only connection: Not Executed (no API key). Adapter code + normalization
  are unit-tested against mock HTTP; live field mapping unverified.
- Private WebSocket live auth/heartbeat/reconnect: Not Executed (needs credentials); mock + dedup tested.
- Controlled Live Order: Not Executed (owner authorization + safe credentials not provided). Live
  activation not approved.
- App default DB store is SQLite (dev); PostgreSQL verified via integration harness/container, not as the
  running app store. (Production Release Gate.)
- Rate limiting: per-scope token bucket (API key/IP/UID), order/cancel priority config, 429/418 +
  Retry-After, backoff+jitter, and circuit breaker are **implemented + unit/integration-tested**
  (`packages/exchange-bitmart/src/rate-limit.ts`, wired into the adapter). A **distributed** priority
  queue + Redis-backed coalescing across nodes remains **not implemented** (single-node) — PROD gate.
- Order/position DB repositories: schema + constraints verified on PG; full ORM-style repos are partial
  (LiveOrderService uses an in-memory store in tests). Persistence tables + idempotency uniqueness proven.
