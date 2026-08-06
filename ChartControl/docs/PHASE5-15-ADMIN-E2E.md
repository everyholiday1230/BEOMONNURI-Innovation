# PHASE 5-15 — Admin E2E

Separate Playwright project: `tests/e2e-admin/playwright.config.ts` (distinct from the user-app E2E).
Run with `pnpm e2e:admin`. It boots the BFF on port 8788 + the SEPARATE admin app on 5174 (Chromium).
A dev-only, env-gated seed (`ADMIN_SEED=true`, `NODE_ENV!=production`) creates the role fixtures
(never active in production):

| Account | Role | Password |
|---|---|---|
| admin@qt.local | SUPER_ADMIN | adminpass1234 |
| support@qt.local | SUPPORT | supportpass1234 |
| analyst@qt.local | ANALYST | analystpass1234 |
| user@qt.local | USER | userpass1234 |
| disable-me@qt.local | USER (disposable) | disablepass1234 |
| role-me@qt.local | USER (disposable) | rolepass1234 |

The e2e API server also allowlists the admin origin (`CORS_ALLOWED_ORIGINS=http://localhost:5174,…`)
so admin **mutations** (which enforce Origin + double-submit CSRF) run end-to-end, and raises the
per-actor admin rate budget (`ADMIN_RATE_LIMIT_PER_MIN`) so the single seeded SUPER_ADMIN can drive the
whole suite (the real 120/min enforcement is covered by `admin-api.test.ts [21]`).

## Results (2026-07-29 closure)
- **User App E2E: 10 passed** (Chromium) — `artifacts/logs/phase5-closure-e2e.log`.
- **Admin App E2E: 31 passed** (Chromium) — 30 required scenarios + `[21b]` live-switch warning —
  `artifacts/logs/phase5-closure-admin-e2e.log`.
- **Firefox Admin E2E: Not Executed** (opt-in `PW_ALL_BROWSERS=1`; not run this pass).
- **WebKit Admin E2E: Not Executed** (not in the project matrix; host libraries require
  `sudo playwright install-deps`).

## The 30 required scenarios (all Executed on Chromium)
| # | Scenario | What it asserts |
|---|---|---|
| 1 | SUPER_ADMIN login | nav + overview shell |
| 2 | USER /admin denied | access-denied state, no nav |
| 3 | SUPPORT limited | can read users, role change → server 403 |
| 4 | ANALYST read-only | disable → server 403 |
| 5 | User search | email filter narrows the table |
| 6 | User detail | detail dialog; "no password hash" note |
| 7 | Account disable | confirmation + reason; enable restores |
| 8 | Session revoke | revoke-all succeeds, no error |
| 9 | Role change | role-me → ANALYST |
| 10 | Self role change blocked | server invariant → alert |
| 11 | Last SUPER_ADMIN disable blocked | server invariant → alert |
| 12 | Exchange masking | "keys masked", secrets never shown |
| 13 | Orders/Positions read-only | no submit/cancel controls |
| 14 | AI Operations | Not Connected / Not Executed shown |
| 15 | Audit search | recorded `user.revoke_sessions` visible + action filter |
| 16 | Audit export | CSV (text/csv) + JSON 200; CSV formula-injection-safe |
| 17 | Incident create + status change | create → OPEN → INVESTIGATING |
| 18 | Illegal incident transition | CLOSED → INVESTIGATING → server 409 + alert |
| 19 | Feature flag change | reason + optimistic version increment |
| 20 | Feature flag 409 conflict | concurrent edit → stale version → 409 in UI |
| 21 | Kill switch change | non-live scope + step-up reauth → toggles |
| 22 | Kill switch reauth fail | no reauth → STEP_UP_REQUIRED (403) |
| 23 | Release gate no-fake-pass | Try PASS w/o evidence → blocked |
| 24 | i18n ko/en | language toggle |
| 25 | dark/light | theme toggle |
| 26 | Session expiry | 401 → Session-expired state |
| 27 | CSRF failure | CSRF-less mutation → 403 |
| 28 | Offline/resume | offline state then recovers on retry |
| 29 | API 500 | page-level error state |
| 30 | API 429 | rate-limited state |

Extra: `[21b]` asserts the live-trading kill switch shows the server-blocked warning (UI cannot enable
live trading). Scenarios 26/29/30 drive the real UI error-handling path via Playwright route
interception (401/500/429); 28 uses `context.setOffline`; 16/20/27 use `page.request` for the
CSV/JSON export, the concurrent 409 edit, and the CSRF-less mutation respectively.

## Browser matrix (recorded honestly)
| Browser | Status |
|---|---|
| Chromium | **31 passed** (real run) |
| Firefox | **Not Executed** (opt-in `PW_ALL_BROWSERS=1`) |
| WebKit | **Not Executed** (not in matrix; needs host deps) |
