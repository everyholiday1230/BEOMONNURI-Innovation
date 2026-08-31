import { test, expect, type Page } from '@playwright/test';

/**
 * Prompt 3 — User App acceptance suite.
 *
 * Every assertion runs against THIS build on the isolated port pair started by the config; the
 * env-guard spec (`flow-00-env-guard.spec.ts`) proves that before any of this runs. No test creates
 * a real order: the API is pinned to TRADING_MODE=MOCK and the submit gate is asserted, not bypassed.
 */

const USER_ROUTES = [
  '/markets',
  '/trade',
  '/trade/ai',
  '/trade/layout',
  '/portfolio',
  '/notifications',
  '/account',
  '/settings',
  '/design-system',
  '/status',
];
const FULLSCREEN_ROUTES = ['/login', '/signup', '/account/security'];

/** Collects console errors, page errors and 4xx/5xx responses for the lifetime of a page. */
function watch(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const bad: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // Browser-generated "Failed to load resource ... 401" lines for the ANONYMOUS session probes
    // (`/api/auth/me`, `/api/account/mfa/status`) are expected: those screens render an explicit
    // unauthenticated state. Application-level console errors are still asserted to be zero, and the
    // `bad` list below still asserts zero non-auth 4xx/5xx responses.
    if (/Failed to load resource/.test(text) && /401/.test(text)) return;
    consoleErrors.push(text);
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (r) => {
    // 401 on the anonymous account/security probe is an expected, handled state.
    if (r.status() >= 400 && !r.url().includes('/api/account/mfa/status') && !r.url().includes('/api/auth/me'))
      bad.push(`${r.status()} ${r.url()}`);
  });
  return { consoleErrors, pageErrors, bad };
}

test.describe('[U0] shell, routing and navigation', () => {
  test('[U0-1] all 13 user routes render with no console/page/network errors', async ({ page }) => {
    // 13 full navigations, each of which the dev server may have to transform on first request
    // (every route is its own lazy chunk). The default 30 s budget covers Chromium but not a cold
    // Firefox/WebKit pass, and a timeout here reports as a routing failure it is not. The assertions
    // themselves are unchanged.
    test.setTimeout(180_000);
    const w = watch(page);
    for (const route of [...USER_ROUTES, ...FULLSCREEN_ROUTES]) {
      await page.goto(route);
      // Wait for the Suspense fallback to detach, so this asserts the rendered screen rather than
      // the loading placeholder (which is itself a `.page`).
      await expect(page.locator('[data-testid="route-fallback"]')).toHaveCount(0, { timeout: 15_000 });
      await expect(page.locator('.page, .trade-body, .card').first()).toBeVisible({ timeout: 15_000 });
      const text = (await page.locator('body').innerText()).trim();
      expect(text.length, `route ${route} rendered no text`).toBeGreaterThan(10);
    }
    expect(w.pageErrors, `page errors: ${w.pageErrors.join(' | ')}`).toEqual([]);
    expect(w.consoleErrors, `console errors: ${w.consoleErrors.join(' | ')}`).toEqual([]);
    expect(w.bad, `failed requests: ${w.bad.join(' | ')}`).toEqual([]);
  });

  test('[U0-2] every primary nav item resolves to a live route and marks itself active', async ({ page }) => {
    await page.goto('/trade');
    const links = page.locator('[data-testid="desktop-nav"] a');
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(8);
    for (let i = 0; i < count; i++) {
      const href = await links.nth(i).getAttribute('href');
      expect(href, 'nav item must have a real href').toBeTruthy();
      expect(href).not.toBe('#');
    }
    await page.locator('[data-testid="nav-portfolio"]').click();
    await expect(page.locator('[data-testid="portfolio-page"]')).toBeVisible();
    await expect(page.locator('[data-testid="nav-portfolio"]')).toHaveClass(/active/);
  });

  test('[U0-3] no dead links anywhere in the shell', async ({ page }) => {
    await page.goto('/trade');
    expect(await page.locator('a[href="#"]').count()).toBe(0);
    expect(await page.locator('a[href=""]').count()).toBe(0);
  });

  test('[U0-4] unknown route renders the 404 screen and can navigate back', async ({ page }) => {
    await page.goto('/definitely-not-a-route');
    await expect(page.locator('[data-testid="not-found"]')).toBeVisible();
    await page.locator('[data-testid="not-found"] button').click();
    await expect(page.locator('.trade-body')).toBeVisible();
  });

  test('[U0-5] mobile: burger opens a modal drawer with focus trap, Escape and backdrop close', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/trade');
    await expect(page.locator('[data-testid="desktop-nav"]')).toBeHidden();
    const burger = page.locator('[data-testid="burger"]');
    await expect(burger).toBeVisible();

    await burger.click();
    const panel = page.locator('[data-testid="mobile-nav"] [role="dialog"]');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('aria-modal', 'true');
    // initial focus moved inside the dialog
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('mobile-nav-close');
    // focus stays trapped: shift+Tab from the first control wraps to the last
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement))).toBe(
      true,
    );
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    // focus returned to the trigger
    expect(await page.evaluate(() => document.activeElement?.getAttribute('data-testid'))).toBe('burger');

    await burger.click();
    await expect(panel).toBeVisible();
    // The drawer is 320px wide; click the backdrop to its right so the panel is not the hit target.
    await page.mouse.click(375, 500);
    await expect(panel).toBeHidden();
  });

  test('[U0-6] mobile navigation reaches a route', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/trade');
    await page.locator('[data-testid="burger"]').click();
    await page.locator('[data-testid="mnav-portfolio"]').click();
    await expect(page.locator('[data-testid="portfolio-page"]')).toBeVisible();
  });

  test('[U0-7] account menu is a keyboard-dismissable popup that routes', async ({ page }) => {
    await page.goto('/trade');
    await page.locator('[data-testid="account-menu-trigger"]').click();
    await expect(page.locator('[data-testid="account-menu"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="account-menu"]')).toBeHidden();
    await page.locator('[data-testid="account-menu-trigger"]').click();
    await page.locator('[data-testid="account-menu-account"]').click();
    await expect(page.locator('[data-testid="account-page"]')).toBeVisible();
  });

  test('[U0-8] the skip link is the first tab stop and moves focus to main', async ({ page }) => {
    await page.goto('/trade');
    // `goto` resolves on `load`, which can precede React's first commit; pressing Tab before the
    // shell exists leaves focus on <body> and says nothing about tab ORDER, which is what this
    // asserts. Wait for the link to be in the DOM first.
    await expect(page.locator('.skip-link')).toHaveCount(1);
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.className ?? '');
    expect(focused).toContain('skip-link');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.location.hash)).toBe('#main');
  });

  test('[U0-9] deposit and unimplemented actions are disabled with a reason, not silent no-ops', async ({ page }) => {
    await page.goto('/trade');
    const deposit = page.locator('[data-testid="deposit-btn"]');
    await expect(deposit).toBeDisabled();
    expect(await deposit.getAttribute('title')).toBeTruthy();
  });
});

test.describe('[U1] symbol search and favourites', () => {
  test('[U1-1] search filters, keyboard-selects and syncs the whole workspace', async ({ page }) => {
    await page.goto('/markets');
    const input = page.locator('[data-testid="mw-search"]');
    await input.fill('eth');
    await expect(page.locator('[data-testid="mw-row-ETHUSDT"]')).toBeVisible();
    await expect(page.locator('[data-testid="mw-row-BTCUSDT"]')).toBeHidden();
    await page.locator('[data-testid="mw-select-ETHUSDT"]').click();
    await expect(page.locator('[data-testid="symbol-header"]')).toContainText('ETH');
  });

  test('[U1-2] header combobox: ArrowDown/Enter selects, Escape closes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/trade');
    const combo = page.locator('.header-search [data-testid="symbol-search-input"]');
    await combo.fill('eth');
    await expect(page.locator('[data-testid="symbol-search-popup"]')).toBeVisible();
    await expect(combo).toHaveAttribute('aria-expanded', 'true');
    // MKT-01 search is server-side and debounced, so the options arrive asynchronously. Wait for a real
    // ETH option before using the keyboard — the pending state deliberately exposes NO selectable rows,
    // so pressing Enter early cannot commit a stale "recent" symbol.
    await expect(page.locator('[data-testid="search-pending"]')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('[data-testid="symbol-search-popup"] [role="option"]').first()).toContainText(/ETH/, {
      timeout: 15_000,
    });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="symbol-header"]')).toContainText('ETH');
    await combo.fill('btc');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="symbol-search-popup"]')).toBeHidden();
  });

  test('[U1-2b] the pending window exposes no selectable option, so Enter cannot commit a stale pick', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/trade');
    // Seed a "recent" entry, which is what the dropdown shows for an EMPTY query.
    const combo = page.locator('.header-search [data-testid="symbol-search-input"]');
    await combo.fill('eth');
    await expect(page.locator('[data-testid="symbol-search-popup"] [role="option"]').first()).toContainText(/ETH/, {
      timeout: 15_000,
    });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="symbol-header"]')).toContainText('ETH');

    // Now type a different term and assert that, while the search is pending, no option is offered.
    // The MOCK_REPLAY catalogue is BTCUSDT + ETHUSDT, so BTC is the other real term available here.
    await combo.fill('btc');
    const pending = page.locator('[data-testid="search-pending"]');
    if (await pending.count()) {
      expect(await page.locator('[data-testid="symbol-search-popup"] [role="option"]').count()).toBe(0);
    }
    // Once it resolves, the option list matches the typed term rather than the previous one.
    await expect(page.locator('[data-testid="symbol-search-popup"] [role="option"]').first()).toContainText(/BTC/, {
      timeout: 15_000,
    });
    await expect(page.locator('[data-testid="symbol-search-popup"] [role="option"]').first()).not.toContainText(/ETH/);
  });

  test('[U1-3] no results renders an explicit empty state', async ({ page }) => {
    await page.goto('/trade');
    await page.locator('.header-search [data-testid="symbol-search-input"]').fill('zzzznotasymbol');
    await expect(page.locator('[data-testid="search-no-results"]')).toBeVisible();
  });

  test('[U1-4] favourite toggles, appears in the favourites tab and survives a reload', async ({ page }) => {
    await page.goto('/markets');
    const star = page.locator('[data-testid="mw-star-BTCUSDT"]');
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-testid="mw-tab-favorites"]').click();
    await expect(page.locator('[data-testid="mw-row-BTCUSDT"]')).toBeVisible();
    await expect(page.locator('[data-testid="mw-row-ETHUSDT"]')).toBeHidden();

    await page.reload();
    await page.locator('[data-testid="mw-tab-favorites"]').click();
    await expect(page.locator('[data-testid="mw-row-BTCUSDT"]')).toBeVisible();

    // toggling twice never duplicates
    await page.locator('[data-testid="mw-tab-all"]').click();
    await page.locator('[data-testid="mw-star-BTCUSDT"]').click();
    await page.locator('[data-testid="mw-star-BTCUSDT"]').click();
    expect(await page.locator('[data-testid="mw-row-BTCUSDT"]').count()).toBe(1);
  });

  test('[U1-5] favourites are stored under a namespaced, versioned key', async ({ page }) => {
    await page.goto('/markets');
    await page.locator('[data-testid="mw-star-ETHUSDT"]').click();
    const keys = await page.evaluate(() => Object.keys(window.localStorage));
    expect(keys.some((k) => /^qt\.favorites\.v1:/.test(k))).toBe(true);
  });

  test('[U1-6] the empty favourites tab explains itself', async ({ page }) => {
    await page.goto('/markets');
    await page.locator('[data-testid="mw-tab-favorites"]').click();
    await expect(page.locator('.wstate')).toBeVisible();
  });
});

test.describe('[U2] trading workspace widgets', () => {
  test('[U2-1] the trade grid renders every mock widget with non-zero geometry', async ({ page }) => {
    await page.goto('/trade');
    await expect(page.locator('[data-testid="market-watch"]')).toBeVisible();
    await expect(page.locator('[data-testid="order-book"]')).toBeVisible();
    await expect(page.locator('[data-testid="recent-trades"]')).toBeVisible();
    await expect(page.locator('[data-testid="order-entry"]')).toBeVisible();
    await expect(page.locator('[data-testid="orders-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="assets-risk"]')).toBeVisible();

    const boxes = await page.locator('.panel').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { type: (e as HTMLElement).dataset.widgetType, w: Math.round(r.width), h: Math.round(r.height) };
      }),
    );
    expect(boxes.length).toBeGreaterThanOrEqual(6);
    for (const b of boxes) {
      expect(b.w, `panel ${b.type} width`).toBeGreaterThan(80);
      expect(b.h, `panel ${b.type} height`).toBeGreaterThan(60);
    }
  });

  test('[U2-2] order book shows depth, a mid row with last+spread, and a precision control', async ({ page }) => {
    await page.goto('/trade');
    await expect(page.locator('[data-testid="ob-mid"]')).toBeVisible();
    await expect(page.locator('[data-testid="ob-precision"]')).toBeVisible();
    const depths = await page.locator('.ob-row__depth').count();
    expect(depths).toBeGreaterThan(4);
    // regrouping keeps the book rendered
    await page.locator('[data-testid="ob-precision"]').selectOption({ index: 1 });
    await expect(page.locator('[data-testid="ob-mid"]')).toBeVisible();
  });

  test('[U2-3] clicking an order-book row prefills the order price', async ({ page }) => {
    await page.goto('/trade');
    const row = page.locator('.ob-row--bid').first();
    const shown = (await row.innerText()).split('\n')[0]!.replace(/[^\d.]/g, '');
    await row.click();
    const price = await page.locator('[data-testid="oe-price"]').inputValue();
    expect(Number(price)).toBeGreaterThan(0);
    expect(price.replace(/[^\d.]/g, '').slice(0, 4)).toBe(shown.slice(0, 4));
  });

  test('[U2-4] recent trades carry a time column', async ({ page }) => {
    await page.goto('/trade');
    const rows = page.locator('[data-testid="rt-row"]');
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    await expect(rows.first().locator('.rt-row__time')).not.toBeEmpty();
  });

  test('[U2-5] chart reports real bars via the v10 DataLoader and reloads on symbol/timeframe change', async ({
    page,
  }) => {
    await page.goto('/trade');
    const chart = page.locator('[data-chart-state]');
    await expect(chart).toHaveAttribute('data-chart-state', 'ready', { timeout: 15_000 });
    const bars = Number(await chart.getAttribute('data-bar-count'));
    const engine = Number(await chart.getAttribute('data-engine-bar-count'));
    expect(bars).toBeGreaterThan(0);
    expect(engine).toBeGreaterThan(0);
    const canvasBox = await page.locator('.chart-mount canvas').first().boundingBox();
    expect(canvasBox!.width).toBeGreaterThan(50);
    expect(canvasBox!.height).toBeGreaterThan(50);

    await page.locator('[data-testid="tf-1h"]').click();
    await expect(chart).toHaveAttribute('data-chart-state', 'ready', { timeout: 15_000 });
    expect(Number(await chart.getAttribute('data-engine-bar-count'))).toBeGreaterThan(0);
  });

  /*
     [U2-6] 삭제 — 헤더의 연결 클러스터(WS 상태 / 지연 ms / 데이터 신선도 / 데이터 모드 배지)를
     운영 요청으로 제거했다(ad1ec0d). 그 뒤로 이 테스트는 존재하지 않는 testid
     (conn-latency / conn-freshness / data-mode-badge)를 기다리다 실패만 하고 있었다.
     UI 를 되살릴 게 아니면 테스트도 남겨둘 이유가 없다. 신선도 값 자체는
     window.QTLive.getDataAgeMs() 로 여전히 얻을 수 있으니, 표시를 다시 넣을 때
     이 테스트도 함께 되살린다.
  */

  test('[U2-7] symbol header exposes v2 identity, price, 24h meta and funding countdown', async ({ page }) => {
    await page.goto('/trade');
    await expect(page.locator('[data-testid="symbol-price"]')).not.toBeEmpty();
    await expect(page.locator('[data-testid="symbol-change"]')).not.toBeEmpty();
    for (const id of ['meta-mark', 'meta-index', 'meta-high', 'meta-low', 'meta-vol', 'meta-funding']) {
      await expect(page.locator(`[data-testid="${id}"]`)).toBeVisible();
    }
    await expect(page.locator('[data-testid="symbol-max-leverage"]')).toContainText('×');
  });

  test('[U2-8] the symbol switcher in the header changes the market', async ({ page }) => {
    await page.goto('/trade');
    await page.locator('[data-testid="symbol-switch"]').click();
    await page.locator('[data-testid="symbol-switcher"] [data-testid="symbol-search-input"]').fill('eth');
    await page.locator('[data-testid="search-option-ETHUSDT"]').click();
    await expect(page.locator('[data-testid="symbol-header"]')).toContainText('ETH');
  });
});
