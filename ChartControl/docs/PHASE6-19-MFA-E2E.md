# PHASE 6-19 — MFA E2E

Two layers, both executed:
- **API integration** (`pnpm test:mfa` → `apps/api/src/__tests__/mfa-api.test.ts`): 16 tests (18
  scenarios) — `artifacts/logs/phase6-test-mfa.log`.
- **Browser E2E** (`pnpm e2e:mfa` → `tests/e2e-mfa/`, Chromium): 16 test blocks (18 scenarios) —
  `artifacts/logs/phase6-e2e-mfa.log`. TOTP codes computed from the enrollment secret (no flaky sleeps).

## Scenarios (browser)
1 enroll: QR/otpauth + manual secret · 2 first-code verify → activate + recovery codes · 3 status ENABLED
(login now requires MFA) · 4 login shows MFA challenge (no session yet) · 5 wrong code rejected · 6 correct
code → session · 7 replay (reused code) rejected · 8 recovery-code login · 9 recovery code single-use ·
10 regenerate recovery (valid code) · 11 disable (password+code) · 12 post-disable login has no MFA ·
13 user A/B isolation (B's code fails A) · 14 recovery toggle · 15 setup requires correct password ·
16 lockout on repeated wrong codes · 17 step-up (valid 200 / invalid 401) · 18 secret never re-displayed.

## Security properties verified
TOTP secret AES-256-GCM encrypted at rest (never plaintext, shown once); recovery codes SHA-256 hashed +
single-use; TOTP replay guard (last-used counter); brute-force lockout (429); CSRF + Origin on account
mutations; session ROTATION after challenge/recovery; per-user isolation; last-SUPER_ADMIN MFA-disable
guard; step-up decoupled from the login replay counter.

## Admin step-up
The `/api/auth/mfa/step-up` endpoint elevates an authenticated session (verified in E2E [17]); the admin
dashboard's high-risk actions already require a structural step-up (reauth) flag — wiring the admin modal
to call the live step-up endpoint for kill-switch/role/gate/flag/prompt actions is the remaining
integration and is tracked in PHASE6-13.
