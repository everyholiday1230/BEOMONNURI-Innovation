import { test, expect, type Page } from '@playwright/test';
import { isolation } from './playwright.config';

/**
 * A5 — AI Operations and Market Gateway.
 *
 * Both screens replaced a raw dump over a stubbed route. What is asserted here: the screens are real
 * (tables, cards, states), the unmeasured stream metrics are shown as NOT MEASURED rather than zero,
 * control actions with no endpoint are disabled with the contract id instead of faked, and nothing
 * resembling a credential or a user's prompt reaches the DOM.
 */

async function loginAdmin(page: Page) {
  await page.goto('/');
  await page.getByLabel(/Email|이메일/).fill('admin@qt.local');
  await page.getByLabel(/Password|비밀번호/).fill('adminpass1234');
  await page.getByRole('button', { name: /Sign in|로그인/ }).click();
  await expect(page.getByRole('navigation', { name: 'admin' })).toBeVisible();
}

const settled = (testid: string) => `[data-testid="${testid}"]:not([data-table-status="loading"])`;

test('[A5-1] AI Ops is a real screen with a run table, not a key/value dump', async ({ page }) => {
  await loginAdmin(page);
  await page.getByRole('link', { name: /AI Operations|AI 운영/ }).click();
  await expect(page.getByTestId('ai-readonly-badge')).toBeVisible();
  await expect(page.getByTestId('ai-redaction-note')).toBeVisible();
  await expect(page.getByTestId('ai-card-summary')).toBeVisible();
  await expect(page.getByTestId('ai-runs')).toBeVisible();
  await page.locator(settled('ai-runs')).waitFor({ timeout: 15_000 });
  await expect(page.getByTestId('ai-runs-search')).toBeVisible();
  expect(await page.locator('main pre').count()).toBe(0);
});

test('[A5-2] AI order execution stays refused by policy; policy write is now a real gated action', async ({ page }) => {
  await loginAdmin(page);
  await page.getByRole('link', { name: /AI Operations|AI 운영/ }).click();
  const exec = page.getByTestId('ai-execute-order');
  await expect(exec).toBeVisible();
  await expect(exec).toBeDisabled();
  await expect(exec).toHaveAttribute('data-deny-reason', 'policy');

  // ASSERTION CHANGED (Prompt 5 / B7 — ADM-API-11). This previously asserted `data-deny-reason=backend`
  // because PUT /admin/ai/policy did not exist. It now exists (permission + CSRF + step-up + optimistic
  // version + audit), so asserting `backend` would assert the absence of a shipped feature. What is
  // asserted instead is the stronger property: the control is ENABLED for a permitted role, still demands
  // step-up, and the policy panel shows a prompt DIGEST rather than prompt text.
  const policy = page.getByTestId('ai-policy-write');
  await expect(policy).toBeEnabled();
  await expect(policy).toHaveAttribute('data-deny-reason', '');
  await expect(policy).toHaveAttribute('data-step-up', 'true');
  await expect(page.getByTestId('ai-card-policy-state')).toBeVisible();
  await expect(page.getByTestId('ai-policy-digest-note')).toBeVisible();
  await expect(page.getByTestId('ai-policy-live-note')).toBeVisible();
  // Live AI execution is reported as not executed, never as enabled.
  await expect(page.getByTestId('ai-card-policy-state-liveExecution')).toContainText(/Not Executed|미실행/);
});

test('[A5-3] no prompt/response text and no credential material reaches the AI Ops DOM', async ({ page }) => {
  await loginAdmin(page);
  await page.getByRole('link', { name: /AI Operations|AI 운영/ }).click();
  await page.locator(settled('ai-runs')).waitFor({ timeout: 15_000 });
  const note = (await page.getByTestId('ai-redaction-note').innerText()).toLowerCase();
  const main = (await page.locator('main').innerText()).toLowerCase().replace(note, '');
  for (const bad of ['password', 'secret', 'authorization', 'api_key', 'apikey', 'bearer ']) {
    expect(main, `"${bad}" must not appear on the AI Ops screen`).not.toContain(bad);
  }
});

test('[A5-4] Gateway shows unmeasured stream metrics as NOT MEASURED, never as zero', async ({ page }) => {
  await loginAdmin(page);
  await page.getByRole('link', { name: /Exchange|거래소 연결/ }).click();
  await expect(page.getByTestId('gw-card-unproxied')).toBeVisible();
  await expect(page.getByTestId('gw-unproxied-note')).toContainText(/ADM-API-07/);
  // The rolled-up severity of the unproxied card must be "unknown" — not ok.
  await expect(page.getByTestId('gw-card-unproxied')).toHaveAttribute('data-rollup', 'unknown');
  const card = await page.getByTestId('gw-card-unproxied').innerText();
  expect(card).toMatch(/Not measured|측정되지 않음/);
  // A metric that is not measured must not be rendered as a bare 0.
  expect(card).not.toMatch(/(^|\s)0(\s|$)/);
});

test('[A5-5] Gateway control actions are real but gated, and never fire on a mere click', async ({ page }) => {
  // ASSERTION CHANGED (Prompt 5 / B7 — ADM-API-08). These controls previously had no endpoint and this
  // test pinned them as disabled with `data-deny-reason=backend`. They now control the LOCAL MOCK gateway
  // state under permission + CSRF + step-up + idempotency key + audit, so "must be disabled" would assert
  // the absence of a shipped feature.
  //
  // The property that actually mattered is kept and strengthened: clicking the control must NOT itself
  // perform anything. It opens a confirmation dialog that demands a reason and an explicit step-up
  // acknowledgement, and no request is issued until that is satisfied.
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && /gateway|resync|reconnect/i.test(r.url())) posts.push(`${r.method()} ${r.url()}`);
  });
  await loginAdmin(page);
  await page.getByRole('link', { name: /Exchange|거래소 연결/ }).click();
  for (const id of ['gw-resync', 'gw-reconnect']) {
    const b = page.getByTestId(id);
    await expect(b).toBeEnabled();
    await expect(b).toHaveAttribute('data-deny-reason', '');
    await expect(b).toHaveAttribute('data-step-up', 'true');
    await b.click();
    const dialog = page.getByTestId('danger-dialog');
    await expect(dialog).toBeVisible();
    // Step-up is outstanding, so the confirm control cannot be used yet.
    await expect(dialog).toHaveAttribute('data-phase', 'STEP_UP_REQUIRED');
    await expect(page.getByTestId('danger-confirm')).toBeDisabled();
    await expect(page.getByTestId('gw-dialog-note')).toContainText(/LOCAL MOCK|로컬 MOCK/);
    await page.getByTestId('danger-cancel').click();
    await expect(dialog).toBeHidden();
  }
  expect(posts, `gateway control requests leaked before confirmation: ${posts.join(' | ')}`).toEqual([]);
});

test('[A5-6] the exchange connection table masks credentials', async ({ page }) => {
  await loginAdmin(page);
  await page.getByRole('link', { name: /Exchange|거래소 연결/ }).click();
  await expect(page.getByTestId('gw-connections')).toBeVisible();
  await page.locator(settled('gw-connections')).waitFor({ timeout: 15_000 });
  expect(await page.locator('main pre').count()).toBe(0);
  const note = (await page.getByTestId('gw-secret-note').innerText()).toLowerCase();
  const main = (await page.locator('main').innerText()).toLowerCase().replace(note, '');
  for (const bad of ['secret', 'memo', 'authorization', 'kms']) {
    expect(main, `"${bad}" must not appear on the Gateway screen`).not.toContain(bad);
  }
});

test('[A5-7] AI usage and exchange reads are same-origin; AI order execution has no endpoint', async ({ page, context }) => {
  await loginAdmin(page);
  const cookies = await context.cookies();
  const csrf = cookies.find((c) => c.name === 'qt_csrf')?.value ?? '';
  const headers = { 'x-csrf-token': csrf, origin: isolation.BASE_URL, 'content-type': 'application/json' };

  // AI order execution stays absent for every role.
  const exec = await context.request.post(`${isolation.BASE_URL}/api/admin/ai/execute-order`, { headers, data: {} });
  expect([404, 405], `POST /api/admin/ai/execute-order must not exist (got ${exec.status()})`).toContain(exec.status());

  // ASSERTION CHANGED (Prompt 5 / B7 — ADM-API-08). The gateway control endpoints now exist, so their
  // absence is no longer the contract. What is asserted is that an EMPTY body cannot mutate anything even
  // with a valid session and CSRF token: the server refuses with 422 (no reason / reauth / version /
  // idempotency key). That property holds whether or not the route exists, which is why it replaces the
  // 404 check rather than merely relaxing it.
  for (const path of ['/api/admin/gateway/resync', '/api/admin/gateway/reconnect']) {
    const res = await context.request.post(`${isolation.BASE_URL}${path}`, { headers, data: {} });
    expect(res.status(), `POST ${path} must refuse an empty body`).toBe(422);
  }
  // And a valid body without the step-up acknowledgement is refused too.
  const noStepUp = await context.request.post(`${isolation.BASE_URL}/api/admin/gateway/resync`, {
    headers,
    data: { reason: 'e2e probe without step-up', reauth: false, version: 0, idempotencyKey: 'e2e-a5-7-probe-key' },
  });
  expect(noStepUp.status()).toBe(403);
  expect(await noStepUp.text()).toContain('STEP_UP_REQUIRED');
});
