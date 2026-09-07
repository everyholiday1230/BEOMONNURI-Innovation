import { defineConfig, devices } from '@playwright/test';
import {
  assertPortFree,
  buildSha,
  port,
  reuseExistingServer,
} from '../support/env-guard';

// MFA E2E (Phase 6 §5) — boots the BFF (MOCK, MFA wired) + the web app, runs the MFA flows in a real
// browser. Chromium required; Firefox/WebKit opt-in (PW_ALL_BROWSERS=1 / PW_WEBKIT=1).
const repoRoot = process.cwd();
const allBrowsers = process.env.PW_ALL_BROWSERS === '1';
const withWebkit = process.env.PW_WEBKIT === '1';

// ---------------------------------------------------------------------------
// Phase 7 §5 — environment isolation: ports asserted free before Playwright starts
// (scripts/phase7-e2e-isolated.sh), in-memory database, no server reuse unless explicitly opted into,
// and an in-suite guard that proves the API is THIS build.
//
// The default ports match the user suite on purpose. The suites run sequentially with cleanup between
// them, and the pre-flight check makes an occupied port a hard failure — so uniqueness is not needed
// for isolation, while keeping the ports the MFA scenarios were verified against avoids re-tuning
// origin/CORS coupling inside the spec. Both are still overridable for concurrent runs.
// ---------------------------------------------------------------------------
const API_PORT = port('E2E_MFA_API_PORT', 8787);
const WEB_PORT = port('E2E_MFA_WEB_PORT', 5173);
const API_URL = `http://127.0.0.1:${API_PORT}`;
/*
   ★★ BASE_URL 을 **API 서버**로 잡는다.

     전에는 `http://localhost:5173` — Vite 개발 서버 — 를 가리키고, 두 번째
     webServer 로 `pnpm --filter @quantumtrade/web dev` 를 띄우려 했다. **그 패키지는
     존재하지 않는다.** 그래서 그 프로세스가 즉시 죽고 Playwright 가
     "Process from config.webServer exited early" 로 중단했다 — 이 스위트는 **한 번도
     실행되지 않았다.** 2단계 인증(MFA)은 계정 탈취를 막는 마지막 장치인데 그 검증이
     통째로 비어 있었다.

     같은 결함을 tests/e2e 에서 이미 고쳤다(그 파일 상단 주석에 기록돼 있다). API 가
     정적 파일을 함께 서빙하므로 서버는 하나로 충분하다.

   ★ WEB_PORT 는 더 이상 서버를 띄우지 않지만 포트 점검 목록에 남긴다 — 예전 방식으로
     수동 실행한 개발 서버가 떠 있으면 알려주는 편이 낫다.
*/
const BASE_URL = process.env.E2E_MFA_BASE_URL ?? API_URL;
const GIT_SHA = buildSha();

export default defineConfig({
  testDir: '.',
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

  use: { baseURL: BASE_URL, trace: 'on-first-retry', viewport: { width: 1280, height: 800 } },
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
        SQLITE_PATH: ':memory:',
        NODE_ENV: 'development',
        // The suite drives its own port, so that origin must be allowlisted for CSRF-protected
        // mutations. Hard-coding 5173 here is what broke isolation (Phase 7 §5).
        /* ★ 브라우저가 API 오리진에서 요청하므로 그 오리진을 허용한다(BASE_URL = API_URL). */
        CORS_ALLOWED_ORIGINS: `http://127.0.0.1:${API_PORT},http://localhost:${API_PORT}`,
        // Batch 1: the login/MFA distributed rate limiter is now on the real HTTP path; a test suite
        // hammers login from one IP, so raise the budget here exactly as the admin suite raises its own
        // (real limits are exercised by the dedicated rate-limit unit/integration tests, not the flows).
        LOGIN_RATE_LIMIT_PER_MIN: '100000',
        MFA_RATE_LIMIT_PER_MIN: '100000',
        GIT_SHA,
      },
    },
    /*
       ★ 두 번째 webServer 를 제거했다. `@quantumtrade/web` 은 존재하지 않는 패키지이고,
         그것을 띄우려는 시도가 이 스위트를 시작조차 못 하게 만들고 있었다.
    */
  ],
});

export const isolation = { API_PORT, WEB_PORT, API_URL, BASE_URL, GIT_SHA };

export const portsToCheck: Array<[number, string]> = [
  [API_PORT, 'BFF / API (MFA suite)'],
  [WEB_PORT, 'web app (MFA suite)'],
];

export { assertPortFree };
