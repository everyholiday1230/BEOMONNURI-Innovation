import { test, expect } from '@playwright/test';
import { assertServerIdentity, strictIsolation } from '../support/env-guard';
import { isolation } from './playwright.config';

/**
 * Admin 00 — environment guard. Runs before every admin scenario so a later failure can never be
 * caused by an unrelated server owning the port (Phase 7 §5).
 */

test('[env] admin base URL and API are this build, with live trading off', async () => {
  await assertServerIdentity({
    baseUrl: isolation.BASE_URL,
    rootElementId: 'admin-root',
    apiUrl: isolation.API_URL,
    expectedSha: isolation.GIT_SHA,
  });
});

test('[env] the admin API reports the expected build SHA', async ({ request }) => {
  const res = await request.get(`${isolation.API_URL}/health/ready`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { status: string; version: string; liveTradingEnabled: boolean };
  expect(body.status).toBe('ok');
  expect(body.liveTradingEnabled).toBe(false);
  if (strictIsolation() && isolation.GIT_SHA !== 'unknown') {
    expect(
      body.version,
      'admin API build SHA must match this run — a mismatch means another server owns the port',
    ).toBe(isolation.GIT_SHA);
  }
});

test('[env] the admin base URL serves the ADMIN shell, not the trading app', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#admin-root')).toBeAttached();
  await expect(page).toHaveTitle(/Admin/i);
});

test('[env] the admin suite runs against an in-memory or throwaway database', async () => {
  expect(isolation.SQLITE_PATH === ':memory:' || /qt-e2e-/.test(isolation.SQLITE_PATH)).toBe(true);
  expect(isolation.SQLITE_PATH).not.toMatch(/\.data\//);
});
