# PHASE 3 — BitMart Production API & Signature

Base (PRODUCTION only; demo endpoints forbidden): `https://api-cloud-v2.bitmart.com`,
public WS `wss://openapi-ws-v2.bitmart.com/api?protocol=1.1`. Private WS requires auth.

## Signature (`packages/exchange-bitmart/signature.ts`)
- Headers: `X-BM-KEY` (access key), `X-BM-SIGN`, `X-BM-TIMESTAMP` (ms).
- Signing payload: `timestamp + "#" + memo + "#" + requestPayload`.
- `X-BM-SIGN = HMAC_SHA256(secretKey, signingPayload)` (hex).
- GET/DELETE: `normalizeQuery` (sorted, encoded). POST/PUT: `serializeBody` (stable key order) — the
  signed string is byte-identical to the transmitted body.
- KEYED vs SIGNED endpoints separated (`buildKeyedHeaders` / `buildSignedHeaders`).
- Timestamp drift: `timestampDriftMs`/`driftAcceptable` (±5s) → re-sync before signing.
- Test vector (unit-tested): secret `mySecret`, ts `1700000000000`, memo `myMemo`, payload
  `symbol=BTCUSDT&size=1` → sign `b2574adb845e56c725ac689b86659f6ad5beacdf0ba25145110292b7d279d5b0`.
- Secrets/memo never logged/traced (module returns headers only).

## API key permissions (guidance)
Required: Read-Only + Future-Trade. Forbidden: Withdraw, Margin-Trade, Finance. IP whitelist + fixed
egress recommended.

## §15 Rate limit & fault handling (`packages/exchange-bitmart/rate-limit.ts`)
- Rate-limit VALUES live in ONE central config (`BITMART_RATE_LIMITS`) — never hardcoded per call-site.
- Per-scope token buckets: API key / IP / UID (`RateLimiter`), each endpoint keyed independently.
- Order/cancel endpoints carry the highest priority (for a priority queue); reads are lower.
- 429 + 418 (IP block) mapped to ambiguous errors; `Retry-After` parsed (delta-seconds or HTTP-date).
- Exponential backoff with full jitter (`backoffDelayMs`), capped; honors `Retry-After` when present.
- `CircuitBreaker` (closed/open/half-open) wired into the adapter: opens on repeated 429/418/5xx,
  fails fast while open → order submit becomes SUBMIT_UNKNOWN (reconcile, never blind-resubmit).
- Order submission is NEVER blindly retried; on timeout the caller queries order state first.
- Distributed priority queue / Redis coalescing across nodes: not implemented (single-node) — PROD gate.

## Real connection test: **Not Executed** (no real API key provided) → PHASE3-11 matrix.

## Live Validation — deployment environment (§2, credential-free) — EXECUTED
Probe: `scripts/phase3-stageA-env.sh` → evidence `artifacts/logs/phase3-stageA-env.log`
(redacted; no key/secret/memo). Measured against **BitMart production** (unauthenticated `/system/time` only):
- **Egress IP**: `15.164.47.4` (AWS ap-northeast-2). This is the address that MUST be added to the
  BitMart API-key IP whitelist. **Whitelist match: Not Executed** (no real key / whitelist to compare).
- **Production REST base**: `https://api-cloud-v2.bitmart.com` — reachable **HTTP 200**, **TLS verified**
  (`ssl_verify_result=0`). Not a demo endpoint. ✓
- **Server-time drift**: ≈ **−21 ms** (within ±5 s) vs BitMart `server_time`. ✓
- **Production WS**: public `wss://openapi-ws-v2.bitmart.com/api?protocol=1.1`; private (user stream)
  `wss://openapi-ws-v2.bitmart.com/user?protocol=1.1` — production (not `wsdemo`). No connect without creds.
- **Safe defaults**: `BITMART_LIVE_TRADING_ENABLED=false`, `BITMART_EMERGENCY_KILL_SWITCH=true`,
  `BITMART_MODE=BITMART_LIVE_READ_ONLY`. ✓
- **Secret Manager/KMS**: NOT configured in this environment → dev `LocalKekProvider`. Prod KMS = **Not Executed**.
- **Log redaction**: no `console.*` logs any secret/memo/access-key value; API secret used only for HMAC,
  never returned to the client (verified by grep + `trading-core` vault test).

**Stage A authenticated items (API-key auth, HMAC-live, futures account/balances/positions/position-mode/
leverage/open-orders/order-history/trade-history/metadata, private-WS auth+subscribe/heartbeat/reconnect,
REST-vs-WS snapshot compare): Not Executed** — no real credential injected. Not marked Passed.

## Runtime credentials (production) — fail-closed
Credentials load ONLY from AWS Secrets Manager via the instance IAM role
(`apps/api/src/trading/credential-source.ts`), never from the prompt/env in production. Missing secret
id/region or absent SDK → **fail-closed** (throws; no silent degrade). Stage A attempt on this runtime
(`scripts/phase3-stageA.sh` → `artifacts/logs/phase3-stageA.log`): managed source **not connected**
(no `BITMART_SECRET_ARN`/`AWS_REGION`, `@aws-sdk` absent) → all authenticated items Not Executed
(fail-closed); egress IP `15.164.47.4` + redaction Passed. No order/withdraw/transfer/margin call made.
