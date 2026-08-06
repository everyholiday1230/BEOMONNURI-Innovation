import { test, expect, type Page } from '@playwright/test';

/**
 * B4 — order draft / validation.
 *
 * The property that matters most here is negative: nothing in this flow can submit an order. The tests
 * therefore assert on what is ABSENT (no live endpoint call, no executable verdict, no submit route) as
 * well as on the validation output the UI shows.
 */

async function signIn(page: Page): Promise<string> {
  const email = `b4-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ex.com`;
  const password = 'e2e-fixture-not-a-secret'; // low-entropy test fixture (min-10 policy); intentionally not secret-shaped
  await page.goto('/signup');
  await page.getByLabel('email').fill(email);
  await page.getByLabel('password').fill(password);
  await page.getByLabel('confirm').fill(password);
  await page.locator('button.btn--primary').first().click();
  await expect(page.getByTestId('signup-ok')).toBeVisible({ timeout: 20_000 });
  await page.goto('/login');
  await page.getByLabel('email').fill(email);
  await page.getByLabel('password').fill(password);
  await page.locator('button.btn--primary').first().click();
  await expect
    .poll(async () => page.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'include' })).status), {
      timeout: 20_000,
    })
    .toBe(200);
  return email;
}

/** POST helper that mints a CSRF token first (the cookie is only set by GET /auth/csrf). */
async function post(
  page: Page,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(
    async ({ p, b, h }) => {
      const t = await fetch('/api/auth/csrf', { credentials: 'include' });
      const token = ((await t.json()) as { csrfToken: string | null }).csrfToken ?? '';
      const r = await fetch(p, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token, ...h },
        body: JSON.stringify(b),
      });
      let parsed: Record<string, unknown> = {};
      try {
        parsed = (await r.json()) as Record<string, unknown>;
      } catch {
        /* empty body */
      }
      return { status: r.status, body: parsed };
    },
    { p: path, b: body, h: headers },
  );
}

const goodIntent = {
  symbol: 'BTCUSDT',
  side: 'long',
  type: 'limit',
  quantity: '0.002',
  price: '65000.0',
  leverage: 10,
  marginMode: 'cross',
};

test.describe('[B4] order validation contract', () => {
  test('[B4-1] validate and draft both require a session', async ({ page }) => {
    await page.goto('/');
    expect((await post(page, '/api/orders/validate', goodIntent)).status).toBe(401);
    expect((await post(page, '/api/orders/draft', goodIntent, { 'idempotency-key': 'anon-key-0001' })).status).toBe(401);
  });

  test('[B4-2] a valid intent is never executable', async ({ page }) => {
    await signIn(page);
    const r = await post(page, '/api/orders/validate', goodIntent);
    expect(r.status).toBe(200);
    const b = r.body as { executable: boolean; allowed: boolean; blockingReasons: { code: string }[]; riskChecks: unknown[] };
    expect(b.executable).toBe(false);
    expect(b.allowed).toBe(false);
    expect(b.blockingReasons.map((x) => x.code)).toContain('LIVE_TRADING_DISABLED');
    expect(b.riskChecks.length).toBeGreaterThan(5);
  });

  test('[B4-3] an unknown field is rejected rather than ignored', async ({ page }) => {
    await signIn(page);
    // `submit: true` must be a hard 422. Silently dropping unknown fields is how a bypass flag ships.
    const r = await post(page, '/api/orders/validate', { ...goodIntent, submit: true });
    expect(r.status).toBe(422);
  });

  test('[B4-4] a numeric quantity is rejected so the parser cannot pre-round it', async ({ page }) => {
    await signIn(page);
    const r = await post(page, '/api/orders/validate', { ...goodIntent, quantity: 0.002 });
    expect(r.status).toBe(422);
  });

  test('[B4-5] draft requires an idempotency key and replays under the same key', async ({ page }) => {
    await signIn(page);
    expect((await post(page, '/api/orders/draft', goodIntent)).status).toBe(400);

    const key = `e2e-draft-${Date.now()}`;
    const first = await post(page, '/api/orders/draft', goodIntent, { 'idempotency-key': key });
    expect(first.status).toBe(201);
    const second = await post(page, '/api/orders/draft', { ...goodIntent, quantity: '0.005' }, { 'idempotency-key': key });
    expect(second.status).toBe(200);
    expect((second.body as { replayed: boolean }).replayed).toBe(true);
    // The replay returns the ORIGINAL verdict; a retry that reported a different outcome would make the
    // key meaningless.
    expect((second.body as { draftId: string }).draftId).toBe((first.body as { draftId: string }).draftId);
    expect((second.body as { normalizedOrder: { quantity: string } }).normalizedOrder.quantity).toBe('0.002');
  });

  test('[B4-6] there is no order submit endpoint', async ({ page }) => {
    await signIn(page);
    for (const p of ['/api/orders/submit', '/api/orders/draft/submit', '/api/orders/execute']) {
      const r = await post(page, p, goodIntent, { 'idempotency-key': 'submit-probe-01' });
      expect([404, 405], `${p} responded ${r.status}`).toContain(r.status);
    }
  });

  test('[B4-7] the order preview shows the server verdict and its blocking reasons', async ({ page }) => {
    await signIn(page);
    await page.goto('/trade');
    await page.locator('[data-testid="oe-qty"]').fill('0.010');
    await page.locator('[data-testid="oe-preview"]').click();

    const panel = page.locator('[data-testid="server-validation"]');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel).toHaveAttribute('data-state', 'blocked', { timeout: 20_000 });
    await expect(page.locator('[data-testid="server-validation-reasons"]')).toContainText('LIVE_TRADING_DISABLED');
    // The UI reads executability from the response rather than assuming it.
    await expect(page.locator('[data-testid="server-validation-executable"]')).toHaveText('false');
  });

  test('[B4-8] an anonymous preview says server validation needs a sign-in rather than 401-ing', async ({ page }) => {
    const unauthorized: string[] = [];
    page.on('response', (r) => {
      if (r.status() === 401 && /\/api\/orders\/(validate|draft)/.test(r.url())) unauthorized.push(r.url());
    });
    await page.goto('/trade');
    await page.locator('[data-testid="oe-qty"]').fill('0.010');
    await page.locator('[data-testid="oe-preview"]').click();
    await expect(page.locator('[data-testid="server-validation"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="server-validation-signin"]')).toBeVisible();
    expect(unauthorized, `predictable 401s issued: ${unauthorized.join(', ')}`).toEqual([]);
  });

  test('[B4-9] validation never contacts a live exchange or AI provider', async ({ page }) => {
    const forbidden: string[] = [];
    page.on('request', (r) => {
      const u = r.url();
      if (/bitmart|api\.openai|\/trading\/orders|\/live\//i.test(u)) forbidden.push(u);
    });
    await signIn(page);
    await post(page, '/api/orders/validate', goodIntent);
    await post(page, '/api/orders/draft', goodIntent, { 'idempotency-key': `e2e-live-probe-${Date.now()}` });
    await page.goto('/trade');
    await page.locator('[data-testid="oe-qty"]').fill('0.010');
    await page.locator('[data-testid="oe-preview"]').click();
    await expect(page.locator('[data-testid="server-validation"]')).toBeVisible({ timeout: 20_000 });
    expect(forbidden, `live endpoints called: ${forbidden.join(', ')}`).toEqual([]);
  });

  test('[B4-10] drafts are listed per user only', async ({ page, context }) => {
    await signIn(page);
    await post(page, '/api/orders/draft', goodIntent, { 'idempotency-key': `e2e-iso-${Date.now()}` });
    const mine = await page.evaluate(async () => {
      const r = await fetch('/api/orders/drafts', { credentials: 'include' });
      return (await r.json()) as { page: { total: number } };
    });
    expect(mine.page.total).toBe(1);

    const page2 = await context.browser()!.newPage();
    try {
      await signIn(page2);
      const theirs = await page2.evaluate(async () => {
        const r = await fetch('/api/orders/drafts', { credentials: 'include' });
        return (await r.json()) as { page: { total: number } };
      });
      expect(theirs.page.total).toBe(0);
    } finally {
      await page2.close();
    }
  });
});
