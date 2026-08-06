import { test, expect } from '@playwright/test';
import { assertServerIdentity, strictIsolation } from '../support/env-guard';
import { isolation } from './playwright.config';

/**
 * Flow 00 — environment guard. Runs first (file order, workers: 1) so every later assertion is known
 * to describe THIS build rather than some other process that happened to own the port.
 *
 * Phase 7 §5: a previous regression run produced a false `e2e:admin` failure because
 * `reuseExistingServer` adopted a manually started dev server pointed at a persistent database.
 */

test('[env] the servers under test are this build, on the expected URL, with live trading off', async () => {
  await assertServerIdentity({
    baseUrl: isolation.BASE_URL,
    rootElementId: 'root',
    apiUrl: isolation.API_URL,
    expectedSha: isolation.GIT_SHA,
  });
});

test('[env] the API reports the expected build SHA and a deterministic mock data mode', async ({ request }) => {
  const res = await request.get(`${isolation.API_URL}/health/ready`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    status: string;
    version: string;
    dataMode: string;
    tradingMode: string;
    liveTradingEnabled: boolean;
  };

  expect(body.status).toBe('ok');
  expect(body.dataMode).toBe('MOCK_REPLAY');
  expect(body.tradingMode).toBe('MOCK');
  expect(body.liveTradingEnabled).toBe(false);

  if (strictIsolation() && isolation.GIT_SHA !== 'unknown') {
    expect(
      body.version,
      'API build SHA must match this run — a mismatch means another server owns the port',
    ).toBe(isolation.GIT_SHA);
  }
});

test('[env] the suite uses a throwaway database, not a developer data file', async () => {
  // The config points the API at a mkdtemp path; assert it is not the checked-in dev database.
  expect(isolation.SQLITE_PATH).not.toMatch(/\.data\//);
  // Either the config's own mkdtemp path or the run-scoped temp dir created by
  // scripts/phase7-e2e-isolated.sh — both live under the OS temp directory.
  expect(isolation.SQLITE_PATH).toMatch(/^\/tmp\/qt-e2e-/);
});

test('[env] the base URL serves the QuantumTrade shell', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBeLessThan(400);
  await expect(page.locator('#root')).toBeAttached();
  await expect(page).toHaveTitle(/QuantumTrade/i);
});
