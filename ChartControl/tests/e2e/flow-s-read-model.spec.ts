import { test, expect, type Page } from '@playwright/test';

/**
 * B3 / B5 — the orders, trades, positions and account tables are served by the API and scoped to the
 * signed-in user.
 *
 * What makes this test meaningful rather than decorative: it signs in as a FRESH user, confirms a
 * simulated order through the real UI, and then asserts the row appears in the SERVER read model
 * (`/api/orders/history`, `/api/trades`, `/api/positions`) as well as in the table. A UI-only or
 * mock-intercepted assertion would pass even if the endpoint returned nothing, so the server responses
 * are read directly alongside the DOM.
 */

async function signIn(page: Page): Promise<string> {
  const email = `b3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ex.com`;
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

/** Read a read-model endpoint directly, bypassing the UI. */
async function readModel(page: Page, path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(async (p) => {
    const r = await fetch(p, { credentials: 'include' });
    return { status: r.status, body: r.ok ? await r.json() : {} };
  }, path);
}

/** Create one simulated order through the order-entry UI. */
async function placeSimulatedOrder(page: Page): Promise<void> {
  await page.goto('/trade');
  await page.locator('[data-testid="oe-qty"]').fill('0.010');
  await page.locator('[data-testid="oe-preview"]').click();
  await page.locator('[data-testid="oe-final-confirm"]').check();
  await page.locator('[data-testid="oe-submit"]').click();
  await expect(page.locator('[data-testid="order-success"]')).toBeVisible({ timeout: 20_000 });
}

test.describe('[B3] server-backed orders / trades / positions read model', () => {
  test('[B3-1] every read model endpoint requires a session', async ({ page }) => {
    await page.goto('/');
    for (const p of ['/api/orders/open', '/api/orders/history', '/api/trades', '/api/positions', '/api/account/summary', '/api/account/assets']) {
      const r = await readModel(page, p);
      expect(r.status, p).toBe(401);
    }
  });

  test('[B3-2] an anonymous visitor sees the local simulation, clearly labelled', async ({ page }) => {
    await page.goto('/portfolio');
    const panel = page.locator('[data-testid="orders-panel"]');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    // The panel must state which source it is rendering; a table with no provenance is the defect this
    // batch exists to remove.
    await expect(panel).toHaveAttribute('data-source', 'local');
    await expect(page.locator('[data-testid="orders-provenance"]')).toBeVisible();
  });

  test('[B3-3] a signed-in user reads the server model and a confirmed order is persisted there', async ({ page }) => {
    await signIn(page);
    await placeSimulatedOrder(page);

    // Server first: the row must exist in the database-backed read model, not merely in the DOM.
    await expect
      .poll(async () => (await readModel(page, '/api/orders/history')).body as { page?: { total?: number } }, {
        timeout: 20_000,
      })
      .toMatchObject({ page: { total: 1 } });

    const history = (await readModel(page, '/api/orders/history')).body as {
      items: { symbol: string; quantity: string; mode: string; status: string }[];
      source: string;
      tradingMode: string;
      liveTradingEnabled: boolean;
      killSwitchActive: boolean;
      freshness: string;
    };
    expect(history.items).toHaveLength(1);
    expect(history.items[0]!.status).toBe('FILLED');
    // Provenance: a simulated fill must be labelled MOCK at the source, not just in the UI copy.
    expect(history.items[0]!.mode).toBe('MOCK');
    expect(history.source).toBe('MOCK');
    expect(history.liveTradingEnabled).toBe(false);

    const trades = (await readModel(page, '/api/trades')).body as { page: { total: number }; items: { price: string }[] };
    expect(trades.page.total).toBe(1);

    const positions = (await readModel(page, '/api/positions')).body as {
      page: { total: number };
      items: { size: string; markPrice: string | null; unrealizedPnl: string | null }[];
    };
    expect(positions.page.total).toBe(1);
    // No mark-price feed exists in this deployment: the field must be null rather than a fabricated number.
    expect(positions.items[0]!.markPrice).toBeNull();
    expect(positions.items[0]!.unrealizedPnl).toBeNull();

    // Now the UI, which must be reading that same source.
    await page.goto('/portfolio');
    const panel = page.locator('[data-testid="orders-panel"]');
    await expect(panel).toHaveAttribute('data-source', 'server', { timeout: 20_000 });
    await expect(page.locator('[data-testid="positions-table"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="position-row"]').first()).toBeVisible();
    await expect(page.locator('[data-testid="pos-count-orderHistory"]')).toHaveText('1');

    await page.locator('[data-testid="pos-tab-orderHistory"]').click();
    await expect(page.locator('[data-testid="order-history-row"]').first()).toBeVisible();
    await page.locator('[data-testid="pos-tab-tradeHistory"]').click();
    await expect(page.locator('[data-testid="trade-history-row"]').first()).toBeVisible();
  });

  test('[B3-4] server-side filters actually filter', async ({ page }) => {
    await signIn(page);
    await placeSimulatedOrder(page);
    await expect
      .poll(async () => ((await readModel(page, '/api/orders/history')).body as { page?: { total?: number } }).page?.total, {
        timeout: 20_000,
      })
      .toBe(1);

    // The order was placed on the default symbol; a different symbol must return nothing.
    const other = (await readModel(page, '/api/orders/history?symbol=XRPUSDT')).body as { page: { total: number } };
    expect(other.page.total).toBe(0);

    // A parameter the server does not know is a 400, not a silently unfiltered result.
    expect((await readModel(page, '/api/orders/history?nope=1')).status).toBe(400);
    // A status that is not terminal is invalid on the history endpoint.
    expect((await readModel(page, '/api/orders/history?status=ACCEPTED')).status).toBe(400);
  });

  test('[B3-5] one user never sees another user\u2019s rows', async ({ page, context }) => {
    await signIn(page);
    await placeSimulatedOrder(page);
    await expect
      .poll(async () => ((await readModel(page, '/api/orders/history')).body as { page?: { total?: number } }).page?.total, {
        timeout: 20_000,
      })
      .toBe(1);

    // Second user in a separate context: a fresh cookie jar, same server, same tables.
    const page2 = await context.browser()!.newPage();
    try {
      await signIn(page2);
      const theirs = (await readModel(page2, '/api/orders/history')).body as { page: { total: number } };
      expect(theirs.page.total).toBe(0);
      const theirPositions = (await readModel(page2, '/api/positions')).body as { page: { total: number } };
      expect(theirPositions.page.total).toBe(0);
    } finally {
      await page2.close();
    }
  });

  test('[B3-6] the portfolio page issues no request that is guaranteed to 401 when anonymous', async ({ page }) => {
    const unauthorized: string[] = [];
    page.on('response', (r) => {
      if (r.status() === 401 && /\/api\/(orders|trades|positions|account)/.test(r.url())) unauthorized.push(r.url());
    });
    await page.goto('/portfolio');
    await expect(page.locator('[data-testid="orders-panel"]')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    // A predictable 401 is a request that should not have been made, not an error to be swallowed.
    expect(unauthorized, `unauthorized reads issued anonymously: ${unauthorized.join(', ')}`).toEqual([]);
  });
});

test.describe('[B5] account read model and validation-only position contracts', () => {
  test('[B5-1] account summary reports absent figures as null with an unavailable list', async ({ page }) => {
    await signIn(page);
    const summary = (await readModel(page, '/api/account/summary')).body as {
      available: string | null;
      marginRatio: string | null;
      unavailable: string[];
      source: string;
    };
    // A brand-new account has no balance snapshot. Zero would be a number the sizer would act on.
    expect(summary.available).toBeNull();
    expect(summary.marginRatio).toBeNull();
    expect(summary.unavailable).toContain('available');
    expect(summary.source).toBe('MOCK');
  });

  test('[B5-2] the assets widget distinguishes sign-in-required from no-data-source', async ({ page }) => {
    await page.goto('/portfolio');
    const panel = page.locator('[data-testid="assets-risk"]');
    await expect(panel).toBeVisible({ timeout: 20_000 });
    // Anonymous: the backend EXISTS, so reporting BACKEND_REQUIRED would misstate the system.
    await expect(panel).toHaveAttribute('data-account-status', 'SIGN_IN_REQUIRED');

    await signIn(page);
    await page.goto('/portfolio');
    await expect(page.locator('[data-testid="assets-risk"]')).toHaveAttribute('data-account-status', 'OK', {
      timeout: 20_000,
    });
  });

  test('[B5-3] close validation returns executable=false with blocking reasons and changes nothing', async ({ page }) => {
    await signIn(page);
    await placeSimulatedOrder(page);
    await expect
      .poll(async () => ((await readModel(page, '/api/positions')).body as { page?: { total?: number } }).page?.total, {
        timeout: 20_000,
      })
      .toBe(1);

    await page.goto('/portfolio');
    await expect(page.locator('[data-testid="position-row"]').first()).toBeVisible({ timeout: 20_000 });

    // Executing a close is still impossible and its control stays disabled.
    const close = page.locator('[data-testid="pos-act-close"]').first();
    await expect(close).toBeDisabled();

    // The validation-only contract, however, is reachable and reports why it is blocked.
    await page.locator('[data-testid="pos-act-close-draft"]').first().click();
    const dlg = page.locator('[data-testid="close-draft-dialog"]');
    await expect(dlg).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="close-draft-not-executable"]')).toBeVisible();
    await expect(page.locator('[data-testid="close-draft-reasons"]')).toContainText('LIVE_TRADING_DISABLED');

    // The position is unchanged: validation is a calculation, not an action.
    const after = (await readModel(page, '/api/positions')).body as { page: { total: number } };
    expect(after.page.total).toBe(1);
  });

  test('[B5-4] no request to a live exchange or a live order path is ever made', async ({ page }) => {
    const forbidden: string[] = [];
    page.on('request', (r) => {
      const u = r.url();
      if (/bitmart|api\.openai|\/trading\/orders|\/live\//i.test(u)) forbidden.push(u);
    });
    await signIn(page);
    await placeSimulatedOrder(page);
    await page.goto('/portfolio');
    await expect(page.locator('[data-testid="orders-panel"]')).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-testid="pos-act-close-draft"]').first().click();
    await expect(page.locator('[data-testid="close-draft-dialog"]')).toBeVisible({ timeout: 20_000 });
    expect(forbidden, `live endpoints called: ${forbidden.join(', ')}`).toEqual([]);
  });
});
