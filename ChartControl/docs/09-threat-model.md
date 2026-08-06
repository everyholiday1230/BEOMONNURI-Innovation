# 09 — Threat Model (STRIDE-oriented, trading-specific)

Scope: web SPA + BFF + market-data + (future) trading/AI services. Assets: user sessions,
exchange API credentials, order integrity, market-data integrity, AI command surface.

## Trust boundaries
1. Browser ↔ BFF (untrusted client input).
2. BFF ↔ BitMart (untrusted upstream data + rate limits).
3. BFF ↔ AI provider (untrusted LLM output — treated as hostile).
4. Services ↔ datastores (secrets at rest).

## Top threats & mitigations
| # | Threat (STRIDE) | Mitigation |
|---|---|---|
| T1 | **Credential theft** (I) | Exchange secrets never sent to browser/logs/errors. Envelope encryption (KMS), ciphertext-only at rest, no plaintext persistence, key rotation, strict service access, audit trail. Withdrawal-disabled keys recommended; withdrawal not implemented. |
| T2 | **LLM prompt injection → arbitrary action** (E,T) | AI output constrained to allowlisted `ChartCommand` union, Zod-validated, permission-checked. No arbitrary JS/HTML/Canvas execution. AI cannot submit orders / change leverage / read keys. External/tool content treated as untrusted data. |
| T3 | **Unauthorized order submission** (T,E) | Mandatory human confirmation gate + `confirmationToken`; idempotency by `clientOrderId`; simulation-only in Phase 1; production hard-disabled behind feature flag + admin approval. |
| T4 | **Session hijack / CSRF** (S,T) | HttpOnly + Secure + SameSite cookies; CSRF tokens on state-changing routes; CORS allowlist (no wildcard); MFA-ready. |
| T5 | **XSS** (T) | React escaping; strict CSP; output encoding; no `dangerouslySetInnerHTML` for untrusted; AI text rendered as plain text. |
| T6 | **Market-data poisoning / malformed upstream** (T) | Runtime Zod validation, OHLC sanity checks, sequence/gap detection, reject zero/negative/NaN, stale detection. |
| T7 | **DoS via rate limits / reconnect storm** (D) | Token-bucket limiter, backoff+jitter, circuit breaker, request coalescing, load shedding, bounded queues. |
| T8 | **Privilege escalation** (E) | RBAC, user/admin separation, least privilege service roles. |
| T9 | **Sensitive data in logs** (I) | Redaction of secrets/PII; correlation IDs instead of raw identifiers; error sanitization. |
| T10 | **Supply chain** (T) | Pinned dependency versions, dependency + secret scanning in CI, license checks. |

## Security controls checklist (see also CI in `12-deployment.md`)
Auth+session, HttpOnly/Secure/SameSite cookies, CSRF, MFA-ready, RBAC, input validation, output
encoding, CSP, CORS allowlist, security headers, rate limiting, bot protection, audit logging,
secret management, encrypted sensitive data, dependency scanning, secret scanning, error
sanitization. Phase 1 status: policy + interfaces defined; several are 🔌/📄 pending real
auth/datastore wiring (see mock/real matrix).
