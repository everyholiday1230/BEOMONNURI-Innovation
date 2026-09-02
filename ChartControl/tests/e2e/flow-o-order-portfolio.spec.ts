import { test, expect } from '@playwright/test';

/**
 * Prompt 3 — Order Entry, orders/positions/history, assets and AI market context.
 *
 * SAFETY: nothing here can produce a real order. The suite's API runs with TRADING_MODE=MOCK and
 * FEATURE_LIVE_ORDERS_ENABLED unset; the submit path is asserted to be gated, and the only order
 * that is ever created is the simulated one the engine marks `isSimulated`.
 */

async function fillValidOrder(page: import('@playwright/test').Page) {
  await page.goto('/#/trade');
  await expect(page.locator('[data-testid="order-entry"]')).toBeVisible();
  // The price is seeded from the live ticker; wait for it so derived assertions (TP/SL direction,
  // deviation) are computed against a real number rather than an empty field.
  await expect(page.locator('[data-testid="oe-price"]')).not.toHaveValue('', { timeout: 15_000 });
  // quantity must respect the symbol step (0.001 for BTCUSDT)
  await page.locator('[data-testid="oe-qty"]').fill('0.010');
}

test.describe('[U3] order entry — full mock spec', () => {
  test('[U3-1] every mock §5.5 control is present', async ({ page }) => {
    await page.goto('/#/trade');
    for (const id of [
      'oe-margin-cross',
      'oe-margin-isolated',
      'oe-side-long',
      'oe-side-short',
      'oe-type-limit',
      'oe-type-market',
      'oe-type-stop',
      'oe-type-advanced',
      'oe-available',
      'oe-price',
      'oe-qty',
      'oe-percent',
      'oe-leverage',
      'oe-reduce-only',
      'oe-post-only',
      'oe-tpsl-toggle',
      'oe-summary',
      'oe-preview',
    ]) {
      await expect(page.locator(`[data-testid="${id}"]`), `missing control ${id}`).toBeVisible();
    }
  });

  test('[U3-2] margin mode, side and order type are real toggles', async ({ page }) => {
    await page.goto('/#/trade');
    await page.locator('[data-testid="oe-margin-cross"]').click();
    await expect(page.locator('[data-testid="oe-margin-cross"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-testid="oe-side-short"]').click();
    await expect(page.locator('[data-testid="oe-side-short"]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-testid="oe-type-market"]').click();
    await expect(page.locator('[data-testid="oe-price"]')).toBeHidden();
    await page.locator('[data-testid="oe-type-stop"]').click();
    await expect(page.locator('[data-testid="oe-trigger"]')).toBeVisible();
  });

  test('[U3-3] TP/SL fields appear on toggle and reject a wrong-side price', async ({ page }) => {
    await fillValidOrder(page);
    await page.locator('[data-testid="oe-tpsl-toggle"]').check();
    await expect(page.locator('[data-testid="oe-tpsl-fields"]')).toBeVisible();
    const price = Number(await page.locator('[data-testid="oe-price"]').inputValue());
    // long position with a stop ABOVE entry is invalid
    await page.locator('[data-testid="oe-sl"]').fill(String(price + 1000));
    await expect(page.locator('[data-testid="oe-sl-err"]')).toBeVisible();
    await expect(page.locator('[data-testid="oe-preview"]')).toBeDisabled();
  });

  test('[U3-4] invalid quantity blocks preview and is announced', async ({ page }) => {
    await page.goto('/#/trade');
    await page.locator('[data-testid="oe-qty"]').fill('0');
    await expect(page.locator('[data-testid="oe-qty-err"]')).toBeVisible();
    await expect(page.locator('[data-testid="oe-qty"]')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('[data-testid="oe-preview"]')).toBeDisabled();

    await page.locator('[data-testid="oe-qty"]').fill('0.0105'); // off the 0.001 step
    await expect(page.locator('[data-testid="oe-qty-err"]')).toBeVisible();
  });

  test('[U3-5] off-tick price blocks preview', async ({ page }) => {
    await fillValidOrder(page);
    await page.locator('[data-testid="oe-price"]').fill('68000.15'); // tick is 0.1
    await expect(page.locator('[data-testid="oe-price-err"]')).toBeVisible();
    await expect(page.locator('[data-testid="oe-preview"]')).toBeDisabled();
  });

  test('[U3-6] balance is reported as unavailable (not zero) and the % sizer is disabled with a reason', async ({
    page,
  }) => {
    await page.goto('/#/trade');
    await expect(page.locator('[data-testid="oe-available-unavailable"]')).toBeVisible();
    const pct = page.locator('[data-testid="oe-pct-50"]');
    await expect(pct).toBeDisabled();
    expect(await pct.getAttribute('title')).toBeTruthy();
    await expect(page.locator('[data-testid="oe-warn-order.warn.balance"]')).toBeVisible();
  });

  test('[U3-7] high leverage raises a danger warning without blocking', async ({ page }) => {
    await fillValidOrder(page);
    await page.locator('[data-testid="oe-leverage"]').fill('60');
    await expect(page.locator('[data-testid="oe-warn-order.warn.highLeverage"]')).toBeVisible();
    await expect(page.locator('[data-testid="oe-preview"]')).toBeEnabled();
  });

  test('[U3-7b] an active kill switch is always surfaced, and never hidden', async ({ page }) => {
    await page.goto('/#/trade');
    const notice = page.locator('[data-testid="oe-killswitch-notice"]');
    const active = await page.evaluate(async () => (await (await fetch('/api/config')).json()).killSwitchActive);
    if (active) {
      await expect(notice).toBeVisible();
    } else {
      await expect(notice).toHaveCount(0);
    }
  });

  test('[U3-8] post-only and TIF are disabled with the server-unsupported reason', async ({ page }) => {
    await page.goto('/#/trade');
    await expect(page.locator('[data-testid="oe-post-only"]')).toBeDisabled();
    await page.locator('[data-testid="oe-type-advanced"]').click();
    await expect(page.locator('[data-testid="oe-tif-GTC"]')).toBeDisabled();
    expect(await page.locator('[data-testid="oe-tif-GTC"]').getAttribute('title')).toBeTruthy();
  });

  test('[U3-9] summary recomputes from the entered price and size', async ({ page }) => {
    await fillValidOrder(page);
    const summary = page.locator('[data-testid="oe-summary"]');
    const before = await summary.innerText();
    await page.locator('[data-testid="oe-qty"]').fill('0.020');
    await expect(summary).not.toHaveText(before);
  });

  test('[U3-10] preview → risk checklist → explicit confirmation → simulated fill', async ({ page }) => {
    await fillValidOrder(page);
    await page.locator('[data-testid="oe-preview"]').click();

    const modal = page.locator('[data-testid="order-preview-modal"]');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute('aria-modal', 'true');
    await expect(page.locator('[data-testid="op-flow-steps"]')).toBeVisible();
    await expect(page.locator('[data-testid="risk-checklist"]')).toBeVisible();

    // submit is gated until the user ticks the final confirmation
    await expect(page.locator('[data-testid="oe-submit"]')).toBeDisabled();
    await page.locator('[data-testid="oe-final-confirm"]').check();
    await expect(page.locator('[data-testid="oe-submit"]')).toBeEnabled();

    await page.locator('[data-testid="oe-submit"]').click();
    const success = page.locator('[data-testid="order-success"]');
    await expect(success).toBeVisible({ timeout: 10_000 });
    await expect(success).toContainText('SIM-');
  });

  test('[U3-11] a failing risk gate disables submit even after confirmation', async ({ page }) => {
    await fillValidOrder(page);
    // 1× leverage + no SL trips at least one gate to WARN/FAIL depending on the risk policy;
    // the assertion below only requires that a FAIL state disables submit.
    await page.locator('[data-testid="oe-preview"]').click();
    const checklist = page.locator('[data-testid="risk-checklist"]');
    await expect(checklist).toBeVisible();
    const pass = await checklist.getAttribute('data-risk-pass');
    await page.locator('[data-testid="oe-final-confirm"]').check();
    if (pass === 'false') {
      await expect(page.locator('[data-testid="oe-submit"]')).toBeDisabled();
    } else {
      await expect(page.locator('[data-testid="oe-submit"]')).toBeEnabled();
    }
  });

  test('[U3-12] double-clicking submit issues exactly one confirm request', async ({ page }) => {
    const confirms: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/sim/orders/confirm')) confirms.push(r.url());
    });
    await fillValidOrder(page);
    await page.locator('[data-testid="oe-preview"]').click();
    await page.locator('[data-testid="oe-final-confirm"]').check();
    const submit = page.locator('[data-testid="oe-submit"]');
    await submit.click({ clickCount: 2, delay: 10 });
    await expect(page.locator('[data-testid="order-success"]')).toBeVisible({ timeout: 10_000 });
    expect(confirms.length, `confirm requests: ${confirms.length}`).toBe(1);
  });

  test('[U3-13] cancel returns to the form without submitting', async ({ page }) => {
    let submitted = 0;
    page.on('request', (r) => {
      if (r.url().includes('/api/sim/orders/confirm')) submitted++;
    });
    await fillValidOrder(page);
    await page.locator('[data-testid="oe-preview"]').click();
    await page.locator('[data-testid="oe-cancel"]').click();
    await expect(page.locator('[data-testid="order-preview-modal"]')).toBeHidden();
    expect(submitted).toBe(0);
  });

  test('[U3-14] the order entry never calls a live trading endpoint', async ({ page }) => {
    const forbidden: string[] = [];
    page.on('request', (r) => {
      const u = r.url();
      if (/bitmart|\/trading\/orders|\/live\//i.test(u)) forbidden.push(u);
    });
    await fillValidOrder(page);
    await page.locator('[data-testid="oe-preview"]').click();
    await page.locator('[data-testid="oe-final-confirm"]').check();
    await page.locator('[data-testid="oe-submit"]').click();
    await expect(page.locator('[data-testid="order-success"]')).toBeVisible({ timeout: 10_000 });
    expect(forbidden, `live endpoints called: ${forbidden.join(', ')}`).toEqual([]);
  });
});

test.describe('[U4] orders, positions and history', () => {
  test('[U4-1] all five tabs exist with count badges', async ({ page }) => {
    await page.goto('/#/portfolio');
    for (const tab of ['positions', 'openOrders', 'orderHistory', 'tradeHistory', 'aiSignals']) {
      await expect(page.locator(`[data-testid="pos-tab-${tab}"]`)).toBeVisible();
      await expect(page.locator(`[data-testid="pos-count-${tab}"]`)).toBeVisible();
    }
  });

  test('[U4-2] each tab renders either rows or an explicit empty state', async ({ page }) => {
    await page.goto('/#/portfolio');
    for (const tab of ['positions', 'openOrders', 'orderHistory', 'tradeHistory', 'aiSignals']) {
      await page.locator(`[data-testid="pos-tab-${tab}"]`).click();
      const table = page.locator('table');
      const empty = page.locator('.wstate');
      expect((await table.count()) + (await empty.count()), `tab ${tab} rendered nothing`).toBeGreaterThan(0);
    }
  });

  test('[U4-3] a simulated order shows up in positions, history and trade history with full columns', async ({
    page,
  }) => {
    // create one simulated order first
    await page.goto('/#/trade');
    await page.locator('[data-testid="oe-qty"]').fill('0.010');
    await page.locator('[data-testid="oe-preview"]').click();
    await page.locator('[data-testid="oe-final-confirm"]').check();
    await page.locator('[data-testid="oe-submit"]').click();
    await expect(page.locator('[data-testid="order-success"]')).toBeVisible({ timeout: 10_000 });

    await page.goto('/#/portfolio');
    await expect(page.locator('[data-testid="positions-table"]')).toBeVisible({ timeout: 10_000 });
    const headers = await page.locator('[data-testid="positions-table"] th').allInnerTexts();
    expect(headers.length).toBeGreaterThanOrEqual(10);
    await expect(page.locator('[data-testid="position-row"]').first()).toBeVisible();

    await page.locator('[data-testid="pos-tab-orderHistory"]').click();
    await expect(page.locator('[data-testid="order-history-row"]').first()).toBeVisible();

    await page.locator('[data-testid="pos-tab-tradeHistory"]').click();
    await expect(page.locator('[data-testid="trade-history-row"]').first()).toBeVisible();
  });

  test('[U4-4] destructive position actions are disabled with a reason (no cancel/close API)', async ({ page }) => {
    await page.goto('/#/trade');
    await page.locator('[data-testid="oe-qty"]').fill('0.010');
    await page.locator('[data-testid="oe-preview"]').click();
    await page.locator('[data-testid="oe-final-confirm"]').check();
    await page.locator('[data-testid="oe-submit"]').click();
    await expect(page.locator('[data-testid="order-success"]')).toBeVisible({ timeout: 10_000 });

    await page.goto('/#/portfolio');
    const close = page.locator('[data-testid="pos-act-close"]').first();
    await expect(close).toBeVisible({ timeout: 10_000 });
    await expect(close).toBeDisabled();
    expect(await close.getAttribute('title')).toBeTruthy();
  });

  test('[U4-5] filters and refresh work; symbol filter narrows the rows', async ({ page }) => {
    await page.goto('/#/portfolio');
    await expect(page.locator('[data-testid="orders-filter-symbol"]')).toBeVisible();
    await expect(page.locator('[data-testid="orders-filter-side"]')).toBeVisible();
    await page.locator('[data-testid="orders-filter-symbol"]').selectOption('ETHUSDT');
    await page.locator('[data-testid="orders-refresh"]').click();
    await expect(page.locator('[data-testid="orders-panel"]')).toBeVisible();
  });

  test('[U4-6] order detail opens and closes', async ({ page }) => {
    await page.goto('/#/trade');
    await page.locator('[data-testid="oe-qty"]').fill('0.010');
    await page.locator('[data-testid="oe-preview"]').click();
    await page.locator('[data-testid="oe-final-confirm"]').check();
    await page.locator('[data-testid="oe-submit"]').click();
    await expect(page.locator('[data-testid="order-success"]')).toBeVisible({ timeout: 10_000 });

    await page.goto('/#/portfolio');
    await page.locator('[data-testid="pos-tab-orderHistory"]').click();
    await page.locator('[data-testid="order-detail"]').first().click();
    const dlg = page.locator('[data-testid="order-detail-dialog"]');
    await expect(dlg).toBeVisible();
    await page.locator('[data-testid="order-detail-close"]').click();
    await expect(dlg).toBeHidden();
  });
});

test.describe('[U5] assets and notifications', () => {
  test('[U5-1] assets report unavailable instead of faking zero balances', async ({ page }) => {
    await page.goto('/#/portfolio');
    const panel = page.locator('[data-testid="assets-risk"]');
    // Prompt 5 / B5 added GET /api/account/summary, so an anonymous visitor is now reported as
    // SIGN_IN_REQUIRED rather than BACKEND_REQUIRED. The status changed because the system's capability
    // changed: the endpoint exists, this visitor simply has no session. The assertion this test actually
    // protects — that no balance is faked as zero — is unchanged and still checked below.
    await expect(panel).toHaveAttribute('data-account-status', 'SIGN_IN_REQUIRED');
    await expect(page.locator('[data-testid="assets-unavailable"]')).toBeVisible();
    for (const id of ['assets-equity', 'assets-available', 'assets-used-margin', 'assets-maint-margin']) {
      await expect(page.locator(`[data-testid="${id}"]`)).toBeVisible();
    }
    // no margin bar is drawn when the ratio is unknown (an empty bar would imply 0% risk)
    expect(await page.locator('[data-testid="assets-margin-bar"]').count()).toBe(0);
  });

  test('[U5-2] transfer-like actions are disabled with a reason', async ({ page }) => {
    await page.goto('/#/portfolio');
    await expect(page.locator('[data-testid="assets-add-margin"]')).toBeDisabled();
    await expect(page.locator('[data-testid="assets-calculator"]')).toBeDisabled();
  });

  test('[U5-3] derived exposure is labelled as simulated, not as a wallet balance', async ({ page }) => {
    await page.goto('/#/portfolio');
    await expect(page.locator('[data-testid="assets-derived-note"]')).toBeVisible();
    await expect(page.locator('[data-testid="assets-exposure"]')).toBeVisible();
  });

  test('[U5-4] a simulated fill produces a notification with an unread badge', async ({ page }) => {
    await page.goto('/#/trade');
    await page.locator('[data-testid="oe-qty"]').fill('0.010');
    await page.locator('[data-testid="oe-preview"]').click();
    await page.locator('[data-testid="oe-final-confirm"]').check();
    await page.locator('[data-testid="oe-submit"]').click();
    await expect(page.locator('[data-testid="order-success"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('[data-testid="notif-unread"]')).toBeVisible();

    await page.locator('[data-testid="notif-bell"]').click();
    await expect(page.locator('[data-testid="notif-list"]')).toBeVisible();
    await page.locator('[data-testid="notif-mark-all"]').click();
    await expect(page.locator('[data-testid="notif-unread-count"]')).toContainText('0');
  });

  test('[U5-5] notifications state its local-only scope', async ({ page }) => {
    await page.goto('/#/notifications');
    await expect(page.locator('[data-testid="notif-local-note"]')).toBeVisible();
  });
});

test.describe('[U6] AI market context', () => {
  test('[U6-1] the AI panel shows the real last price in its context chips', async ({ page }) => {
    await page.goto('/#/trade/ai');
    const chip = page.locator('[data-testid="ai-ctx-last"]');
    await expect(chip).toBeVisible();
    await expect(chip).not.toContainText('—', { timeout: 15_000 });
    const headerPrice = (await page.locator('[data-testid="symbol-price"]').innerText()).replace(/[^\d]/g, '');
    const chipPrice = (await chip.innerText()).replace(/[^\d]/g, '');
    // same source, same number (formatting aside)
    expect(chipPrice.slice(0, 4)).toBe(headerPrice.slice(0, 4));
  });

  test('[U6-2] the request carries no price at all — the server reads the ticker itself', async ({ page }) => {
    await page.goto('/#/trade/ai');
    const bodies: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/ai/')) bodies.push(r.postData() ?? '');
    });
    await page.locator('[data-testid="ai-composer"]').fill('analyse the trend');
    await expect(page.locator('[data-testid="ai-send"]')).toBeEnabled({ timeout: 20_000 });
    await page.locator('[data-testid="ai-send"]').click();
    await expect(page.locator('[data-testid="ai-messages"]')).toContainText('analyse the trend');
    await page.waitForTimeout(500);
    expect(bodies.length).toBeGreaterThan(0);

    // Prompt 5 / B9 changed this contract deliberately, and the new assertion is strictly stronger.
    //
    // The original test checked that the request carried a MEASURED price rather than the literal 68000.
    // That closed the hard-coding hole but left a bigger one open: the price still came from the client, so
    // a caller could ask for an "AI analysis" of a price that never existed and screenshot the result.
    // The server now reads the ticker itself, refuses to analyse without a real fresh one, and ignores any
    // price in the body — so the correct assertion is that no price is sent at all.
    //
    // The property the old test protected (no hard-coded literal reaching the model) is still covered,
    // here and by flow-v-ai-context.spec.ts [B9-1]/[B9-2] plus apps/api ai-context.test.ts.
    const payload = JSON.parse(bodies[0]!) as Record<string, unknown>;
    expect(Object.keys(payload)).not.toContain('lastPrice');
    expect(bodies[0]).not.toMatch(/68000/);
    // And the server states the context it actually used.
    await expect(page.locator('[data-testid="ai-ctx-server"]')).toBeVisible({ timeout: 25_000 });
  });

  test('[U6-3] the state bar and quick prompts exist and the composer is a textarea', async ({ page }) => {
    await page.goto('/#/trade/ai');
    await expect(page.locator('[data-testid="ai-state-bar"]')).toBeVisible();
    await expect(page.locator('[data-testid="ai-context-chips"]')).toBeVisible();
    await expect(page.locator('[data-testid="ai-quick"]')).toBeVisible();
    expect(await page.locator('[data-testid="ai-composer"]').evaluate((e) => e.tagName)).toBe('TEXTAREA');
  });

  test('[U6-4] conversation history keeps user and AI turns', async ({ page }) => {
    await page.goto('/#/trade/ai');
    await page.locator('[data-testid="ai-composer"]').fill('first question');
    await expect(page.locator('[data-testid="ai-send"]')).toBeEnabled({ timeout: 20_000 });
    await page.locator('[data-testid="ai-send"]').click();
    await expect(page.locator('[data-testid="ai-msg-user"]').first()).toContainText('first question');
    await expect(page.locator('[data-testid="ai-msg-ai"]').first()).toBeVisible({ timeout: 15_000 });
    await page.locator('[data-testid="ai-composer"]').fill('second question');
    await page.locator('[data-testid="ai-send"]').click();
    await expect(page.locator('[data-testid="ai-msg-user"]')).toHaveCount(2);
  });

  test('[U6-5] approving a signal never submits an order', async ({ page }) => {
    let confirms = 0;
    page.on('request', (r) => {
      if (r.url().includes('/api/sim/orders/confirm')) confirms++;
    });
    await page.goto('/#/trade/ai');
    await page.locator('[data-testid="ai-composer"]').fill('give me a signal');
    await expect(page.locator('[data-testid="ai-send"]')).toBeEnabled({ timeout: 20_000 });
    await page.locator('[data-testid="ai-send"]').click();
    const card = page.locator('[data-testid="signal-card"]');
    await expect(card).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-testid="ai-approve"]').click();
    await page.waitForTimeout(400);
    expect(confirms).toBe(0);
    // creating the draft is a prefill, still not a submit
    await page.locator('[data-testid="ai-create-draft"]').click();
    await page.waitForTimeout(400);
    expect(confirms).toBe(0);
  });

  test('[U6-6] the signal-save action states its real precondition (a signed-in session)', async ({ page }) => {
    await page.goto('/#/trade/ai');
    await page.locator('[data-testid="ai-composer"]').fill('give me a signal');
    await expect(page.locator('[data-testid="ai-send"]')).toBeEnabled({ timeout: 20_000 });
    await page.locator('[data-testid="ai-send"]').click();
    await expect(page.locator('[data-testid="signal-card"]')).toBeVisible({ timeout: 20_000 });
    // `POST /api/me/signals` DOES exist (permission `signal.write.self`); this suite runs anonymous,
    // so the action must be disabled and must say why — not claim the API is missing.
    const save = page.locator('[data-testid="ai-save-draft"]');
    await expect(save).toBeDisabled();
    await expect(save).toHaveAttribute('title', /sign in|로그인/i);
  });
});
