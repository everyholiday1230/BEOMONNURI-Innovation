# PHASE 5 — Security Tests (25 scenarios)

Result: **Pass** (reproduced+verified) · **Documented** (design/structural) · **Not Executed**.
Evidence: `packages/admin-domain/src/__tests__/admin-domain.test.ts` (16),
`apps/api/src/__tests__/admin-api.test.ts` (13), `artifacts/logs/phase5-*.log`.

| # | Scenario | Expected | Result | Evidence |
|---|---|---|---|---|
| 1 | Normal user admin access | 403 on all admin routes | Pass | admin-api [1] |
| 2 | SUPPORT role escalation | 403 (no admin.role.write) | Pass | admin-api [2] |
| 3 | ADMIN creates SUPER_ADMIN | 403 (escalation blocked) | Pass | admin-api [3], admin-domain |
| 4 | Self role change | 403 | Pass | admin-api [4], admin-domain |
| 5 | Disable last SUPER_ADMIN | 403 | Pass | admin-api [5], admin-domain |
| 6 | CSRF failure | 403 | Pass | admin-api [6] |
| 7 | Session expiry | invalid session → 401 | Pass (validateSession) | admin-api [8] |
| 8 | Disabled admin session | 401 immediately after disable | Pass | admin-api [8] |
| 9 | IDOR user detail | admin-scoped + redacted; unknown → 404 | Pass | admin-api [7/11] |
| 10 | Audit export no permission | 403 (SUPPORT), 200 (ANALYST) | Pass | admin-api [10] |
| 11 | Secret field exposure | no hash/token/secret in responses | Pass | admin-api [7/11], admin-domain redact |
| 12 | Kill switch concurrent edit | optimistic-lock 409 | Pass | admin-api [12] |
| 13 | Kill switch DB failure | fail-closed (live scopes active) | Pass (unit) | admin-domain killSwitchDefaultOnError |
| 14 | Feature flag cache delay | version + history; single-node | Documented | PHASE5-06 |
| 15 | Prompt unapproved activation | DRAFT→…→ACTIVE required; no direct edit | Documented (state machine) | admin-domain promptChange |
| 16 | Release gate fake Passed | PASSED without evidence blocked; ADMIN can't WAIVE | Pass | admin-api [16], admin-domain |
| 17 | Stored XSS | escapeHtml + redact | Pass (unit) | admin-domain escapeHtml |
| 18 | CSV injection | csvSafe formula neutralize | Pass (unit) | admin-domain csvSafe |
| 19 | SQL injection | parameterized queries | Pass | admin-api [19] |
| 20 | Bulk export | row-limited (≤10k) + audited + permission | Pass | schema ExportRequest, admin-api [10] |
| 21 | Rate limit | per-actor fixed window (429) | Pass | admin-api [21] (429 after window) |
| 22 | Admin A/B concurrent edit | optimistic version conflict → 409 | Pass | admin-api [12] |
| 23 | Audit log tamper (update/delete) | no update/delete route; append-only | Documented (structural) | admin-routes (no such endpoint) |
| 24 | Admin session hijack | HttpOnly/Secure/SameSite cookies + CSRF + Origin | Documented (Phase 2 session security) | PHASE2-05 |
| 25 | Service outage dashboard state | Unavailable/Not Connected/Not Executed (no fake OK) | Pass | admin-routes health/overview |

## Summary
Reproduced+verified: 1,2,3,4,5,6,7,8,9,10,11,12,13,16,17,18,19,20,21,22,25. Documented (structural/
design/single-node): 14,15,23,24. No item falsely marked Pass.

## Admin UI Closure update (2026-07-29)
Rate limit [21] is an executed test (429 after the per-actor window). The expanded Admin E2E (Chromium,
31 passed — see PHASE5-15) now exercises many of these scenarios **end-to-end in a real browser** in
addition to the server integration tests:

- **[1] user admin access denied**, **[2] SUPPORT can't change role**, ANALYST read-only (disable 403),
  **[4] self role change blocked**, **[5] last SUPER_ADMIN disable blocked** — E2E [2,3,4,10,11].
- **[6] CSRF failure** → CSRF-less mutation 403 — E2E [27].
- **[7/8] session expiry / unauth** → Session-expired state — E2E [26].
- **[9/11] IDOR / secret exposure** → redacted user detail, "no password hash", masked exchange keys —
  E2E [6,12].
- **[12/22] concurrent edit 409** → feature-flag stale-version conflict surfaced — E2E [20].
- **[16] release gate fake-Passed blocked** — E2E [23]; **[18] CSV injection** → export asserted
  formula-injection-safe — E2E [16]; **[19] SQL injection** parameterized (server) — admin-api [19].
- **[25] service outage states** → Not Connected/Not Executed/Unavailable, plus API 500/429 UI states —
  E2E [14,29,30].

Remaining **Documented / Production Release Gate** items (environment-impossible in this single-node,
no-MFA build): **[14] multi-node feature-flag cache propagation**, **[15] prompt-lifecycle activation**
(state machine present; no live prompt store), **[17] stored XSS** (unit `escapeHtml`; no live rich
content surface), **[23] audit tamper** (structural: no update/delete route — append-only), **[24]
admin session hijack** (cookie posture: HttpOnly/Secure/SameSite + CSRF + Origin — Phase 2). Real MFA
step-up remains a gate. No item is falsely marked Pass.
