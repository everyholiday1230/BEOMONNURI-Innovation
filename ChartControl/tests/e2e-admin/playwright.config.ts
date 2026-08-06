import { defineConfig, devices } from '@playwright/test';
import {
  assertPortFree,
  buildSha,
  port,
  reuseExistingServer,
} from '../support/env-guard';

// Admin-only Playwright project (separate from the user-app E2E). Boots the BFF (with a dev-only
// SUPER_ADMIN seed) + the SEPARATE admin app. Chromium is required; Firefox/WebKit are opt-in
// (PW_ALL_BROWSERS=1 / PW_WEBKIT=1) and all three launch in this environment.
const repoRoot = process.cwd();
const allBrowsers = process.env.PW_ALL_BROWSERS === '1';
const withWebkit = process.env.PW_WEBKIT === '1';

// ---------------------------------------------------------------------------
// Phase 7 §5 — environment isolation. Distinct default ports from the user suite so the two can run
// back to back (or concurrently) without contending, ports asserted free, throwaway database, and no
// server reuse unless explicitly opted into.
// ---------------------------------------------------------------------------
const API_PORT = port('E2E_ADMIN_API_PORT', 8788);
const ADMIN_PORT = port('E2E_ADMIN_PORT', 5174);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const BASE_URL = process.env.E2E_ADMIN_BASE_URL ?? `http://localhost:${ADMIN_PORT}`;
const GIT_SHA = buildSha();
// `:memory:` is already isolated per process; a temp file is used when a path is needed on disk.
const SQLITE_PATH = process.env.E2E_ADMIN_SQLITE_PATH ?? ':memory:';

export default defineConfig({
  testDir: '.',
  globalSetup: './global-setup.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'results.json' }]],

  // NOTE: the port-occupancy pre-check deliberately does NOT live in `globalSetup` — Playwright
  // starts `webServer` BEFORE globalSetup, so by then this run's own server already owns the port.
  // It runs ahead of Playwright in scripts/phase7-e2e-isolated.sh instead. The in-suite guard spec
  // (`*-00-env-guard.spec.ts`) is what catches a foreign server: it asserts the API reports THIS
  // build's SHA, which a manually started server cannot do.

  use: { baseURL: BASE_URL, trace: 'on-first-retry', viewport: { width: 1366, height: 768 } },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(allBrowsers ? [{ name: 'firefox', use: { ...devices['Desktop Firefox'] } }] : []),
    ...(withWebkit ? [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }] : []),
  ],
  webServer: [
    {
      command: 'pnpm --filter @quantumtrade/api dev',
      cwd: repoRoot,
      url: `${API_URL}/health`,
      timeout: 60_000,
      reuseExistingServer: reuseExistingServer(),
      // The admin app runs on its own port. Admin MUTATIONS enforce the Origin/CSRF allowlist, so the
      // admin origin MUST be allowlisted for the mutation scenarios (users disable/role/revoke,
      // incident/flag/kill-switch/gate). Login is pre-session and does not enforce Origin. Live
      // trading is NOT enabled anywhere by this config.
      env: {
        DATA_MODE: 'MOCK_REPLAY',
        TRADING_MODE: 'MOCK',
        API_PORT: String(API_PORT),
        API_HOST: '127.0.0.1',
        AUTH_ENABLED: 'true',
        AUTH_COOKIE_INSECURE: 'true',
        SQLITE_PATH,
        ADMIN_SEED: 'true',
        NODE_ENV: 'development',
        CORS_ALLOWED_ORIGINS: `http://localhost:${ADMIN_PORT},http://127.0.0.1:${ADMIN_PORT}`,
        // A local/e2e run drives many admin requests as a SINGLE seeded actor, so the limit is raised
        // to avoid false 429s (real rate-limit enforcement is covered by admin-api unit test [21]).
        ADMIN_RATE_LIMIT_PER_MIN: '100000',
        // BL-13 ROOT CAUSE — `loginAdmin` re-authenticates admin@qt.local on EVERY test (74 logins from
        // one IP). The distributed LOGIN limiter (wired in Batch 1, default 10/min, IP bucket NOT reset
        // on success by design) otherwise 429s the later logins, which surfaced as `loginAdmin`
        // shell-ready timeouts that worsened across the run. Raised here to a test-only quota exactly as
        // the user/mfa E2E suites already do. This is an isolated elevated TEST quota only: production
        // defaults (10/min) are unchanged, and the dedicated rate-limiter unit/integration tests verify
        // real 429/Retry-After/fail-closed behaviour at the low production limit.
        LOGIN_RATE_LIMIT_PER_MIN: '100000',
        MFA_RATE_LIMIT_PER_MIN: '100000',
        GIT_SHA,
      },
    },
    {
      // BL-13 — serve a PREBUILT admin bundle via `vite preview` instead of the dev server. The dev
      // server compiled routes on first request, and under a sustained full-suite run that first-paint
      // latency intermittently exceeded the (deliberately unchanged) 10s assertion timeout. A prebuilt
      // static server has no request-time compilation, so the admin shell paints immediately. The build
      // step is why this server's START timeout is larger — that is the SERVER-READY budget and is
      // separate from `expect.timeout` (assertions still get 10s; the flake was never hidden by a longer
      // assertion window).
      command: 'pnpm --filter @quantumtrade/admin build && pnpm --filter @quantumtrade/admin preview',
      cwd: repoRoot,
      url: BASE_URL,
      timeout: 240_000,
      // Test-only isolated server: never reuse a foreign/dev server for the official gate run.
      reuseExistingServer: false,
      // Port via env: pnpm swallows a forwarded `-- --port` flag (Phase 7 §5). `vite preview` reads
      // `preview.port`/`preview.proxy` (added to apps/admin/vite.config.ts), so the app's relative
      // `/api` calls reach the BFF exactly as in dev.
      env: { VITE_API_BASE_URL: API_URL, VITE_DEV_PORT: String(ADMIN_PORT), VITE_PREVIEW_PORT: String(ADMIN_PORT) },
    },
  ],
});

export const isolation = { API_PORT, ADMIN_PORT, API_URL, BASE_URL, GIT_SHA, SQLITE_PATH };

export const portsToCheck: Array<[number, string]> = [
  [API_PORT, 'BFF / API (admin suite)'],
  [ADMIN_PORT, 'admin app (Vite)'],
];

export { assertPortFree };
