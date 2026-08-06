import { defineConfig, devices } from '@playwright/test';
import {
  assertPortFree,
  buildSha,
  ephemeralSqlitePath,
  port,
  reuseExistingServer,
} from '../support/env-guard';

// Repo root. `pnpm e2e` invokes Playwright from the workspace root, so process.cwd() is the root.
const repoRoot = process.cwd();

// Self-contained E2E: Playwright boots the BFF (deterministic MOCK_REPLAY / MOCK trading) and the
// Vite web app, then runs the flows in a real browser. Chromium is always on. Firefox is added with
// PW_ALL_BROWSERS=1, WebKit with PW_WEBKIT=1 (all three launch in this environment).
const allBrowsers = process.env.PW_ALL_BROWSERS === '1';
const withWebkit = process.env.PW_WEBKIT === '1';

// ---------------------------------------------------------------------------
// Phase 7 §5 — environment isolation.
// Ports are overridable so concurrent runs never collide, they are asserted FREE before anything
// starts, the database is a throwaway file, and server reuse is off unless explicitly opted into.
// ---------------------------------------------------------------------------
const API_PORT = port('E2E_API_PORT', 8787);
const WEB_PORT = port('E2E_WEB_PORT', 5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${WEB_PORT}`;
const GIT_SHA = buildSha();
const SQLITE_PATH = process.env.E2E_SQLITE_PATH ?? ephemeralSqlitePath('user');

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
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

  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    viewport: { width: 1440, height: 900 },
  },
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
      env: {
        DATA_MODE: 'MOCK_REPLAY',
        TRADING_MODE: 'MOCK',
        API_PORT: String(API_PORT),
        API_HOST: '127.0.0.1',
        AUTH_COOKIE_INSECURE: 'true',
        // Throwaway database: never a developer's persistent .data file.
        SQLITE_PATH: SQLITE_PATH,
        // The CSRF guard checks an Origin/Referer allowlist as well as the token, and the default only
        // covers port 5173. This suite runs on a dynamic port, so a browser-side mutation would be a 403
        // for the wrong reason. The admin suite already does this; the user suite needed it once a test
        // began issuing mutations from page context (B2 favourites/preferences).
        CORS_ALLOWED_ORIGINS: `http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}`,
        // Batch 1: the login/MFA distributed rate limiter is now on the real HTTP path; a test suite
        // hammers login from one IP, so raise the budget here exactly as the admin suite raises its own
        // (real limits are exercised by the dedicated rate-limit unit/integration tests, not the flows).
        LOGIN_RATE_LIMIT_PER_MIN: '100000',
        MFA_RATE_LIMIT_PER_MIN: '100000',
        // Reported by /health/ready so the suite can prove it is testing THIS build.
        GIT_SHA,
      },
    },
    {
      command: 'pnpm --filter @quantumtrade/web dev',
      cwd: repoRoot,
      url: BASE_URL,
      timeout: 60_000,
      reuseExistingServer: reuseExistingServer(),
      // Port via env: pnpm swallows a forwarded `-- --port` flag (Phase 7 §5).
      // DEV_API_PROXY_TARGET (server-only) points the dev proxy at this suite's API.
      // VITE_API_BASE_URL is deliberately NOT set: it would be inlined into the client bundle,
      // making browser calls cross-origin so the SameSite session cookie is dropped.
      env: { DEV_API_PROXY_TARGET: API_URL, VITE_DEV_PORT: String(WEB_PORT) },
    },
  ],
});

// Exported so the env-guard spec can assert against exactly what this config launched.
export const isolation = { API_PORT, WEB_PORT, API_URL, BASE_URL, GIT_SHA, SQLITE_PATH };

// Used by global-setup.ts (kept here so there is a single source of truth for the ports).
export const portsToCheck: Array<[number, string]> = [
  [API_PORT, 'BFF / API'],
  [WEB_PORT, 'web app (Vite)'],
];

export { assertPortFree };
