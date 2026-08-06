# PHASE 6-03 — MFA & Step-up Authentication

Package: `@quantumtrade/mfa` (20 tests, `pnpm test:mfa`). Pure, framework-agnostic; wired behind the
auth service via the `SecretCipher` (encryption-at-rest) and the shared lockout (Redis-backable).

## Implemented + verified
| Area | Detail | Test |
|---|---|---|
| TOTP | RFC 6238 (SHA-1, 6 digits, 30s), authenticator-standard | verify current/skew/wrong |
| QR / manual secret | `otpauthUri()` (issuer/label/secret) + base32 secret | uri + base32 round-trip |
| Replay prevention | last-used counter rejects reused step | replay rejected |
| Skew bound | ±1 step default, capped ≤ ±2 (bounded drift) | out-of-window rejected |
| Recovery codes | 10 codes, **hash-only** storage, one-time use | redeem-once + reuse rejected |
| Secret at rest | `AesGcmSecretCipher` (AES-256-GCM), never re-displayed | encrypt/decrypt + tamper fails |
| Brute-force lockout | N fails/window → cooldown lock | lock + unlock + reset |
| Step-up levels | session `none/mfa/stepup` + freshness window | STEP_UP_REQUIRED / STALE / ok |
| High-risk actions | kill_switch / role change / release_gate / mfa.disable / feature_flag | flagged for step-up |
| Admin MFA enforcement | `mfaRequiredForRole` (SUPPORT/ANALYST/ADMIN/SUPER_ADMIN) | enforced |
| Last-SUPER_ADMIN guard | cannot disable MFA for the last SUPER_ADMIN | blocked |

## Security properties
Encrypted secret storage; secret shown once at enrolment; recovery codes hashed (SHA-256) + one-time;
constant-time comparisons (`timingSafeEqual`); replay + rate-limit + lockout; bounded time skew.
SMS MFA intentionally excluded from scope.

## Not Executed
- Live pairing with a physical authenticator app / real user enrolment flow through the running UI →
  **Not Executed** (the TOTP algorithm is standard and unit-verified; the API/UI wiring of enrol/challenge
  screens is a follow-up integration). Recorded as a Production Release Gate (MFA).

## Closure update (RC v0.6.1)
MFA is now fully wired end-to-end: API (setup/verify-enrollment/challenge/recovery/disable/regenerate/
status/step-up), Account-Security UI + Login MFA challenge, and 18 E2E scenarios (API 16 + browser 16).
Login for MFA-enabled users returns a pending challenge (pre-MFA session discarded) → session rotation on
success. See PHASE6-19. Admin-modal→live-step-up wiring tracked in PHASE6-13.
