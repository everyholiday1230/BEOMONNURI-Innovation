import { test, expect } from '@playwright/test';
import { assertServerIdentity, strictIsolation } from '../support/env-guard';
import { isolation } from './playwright.config';

/** MFA 00 — environment guard (Phase 7 §5). Runs first so later MFA assertions describe this build. */

test('[env] MFA suite servers are this build, with live trading off', async () => {
  await assertServerIdentity({
    baseUrl: isolation.BASE_URL,
    rootElementId: 'root',
    apiUrl: isolation.API_URL,
    expectedSha: isolation.GIT_SHA,
  });
});

test('[env] the MFA API reports the expected build SHA', async ({ request }) => {
  const res = await request.get(`${isolation.API_URL}/health/ready`);
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { status: string; version: string; liveTradingEnabled: boolean };
  expect(body.status).toBe('ok');
  expect(body.liveTradingEnabled).toBe(false);
  if (strictIsolation() && isolation.GIT_SHA !== 'unknown') {
    expect(body.version).toBe(isolation.GIT_SHA);
  }
});
