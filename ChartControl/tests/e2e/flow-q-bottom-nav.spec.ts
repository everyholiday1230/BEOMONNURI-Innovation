import { test, expect, type Page } from '@playwright/test';

/**
 * Mobile bottom navigation — browser acceptance.
 *
 * The official `design-system.html` Responsive Breakpoints table requires, for `< 768px`:
 * "Bottom nav 5개 · 차트/주문/AI 개별 화면". The app previously shipped a left drawer, so these tests
 * pin the corrected behaviour: the bar exists only below 768px, has exactly five destinations, each
 * destination is a real URL that survives reload and back/forward, and each mobile view actually
 * renders its widget (a chart view with a 0×0 canvas is not a chart view).
 */

const MOBILE = { width: 360, height: 800 };
const MOBILE_TALL = { width: 390, height: 844 };
const BAR = '[data-testid="bottom-nav"]';

const ITEMS = ['markets', 'chart', 'order', 'ai', 'portfolio'] as const;

/** Console/page/network errors collected for the whole navigation exercise. */
function watch(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failed: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // Same exclusion as flow-n-user-shell: the browser logs "Failed to load resource … 401" for the
    // ANONYMOUS session probes (`/api/auth/me`, `/api/account/mfa/status`), which render an explicit
    // unauthenticated state. Every other console error is still asserted to be zero.
    if (/Failed to load resource/.test(text) && /401/.test(text)) return;
    consoleErrors.push(text);
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() < 400) return;
    if (r.url().includes('/api/auth/me') || r.url().includes('/api/account/mfa/status')) return;
    failed.push(`${r.status()} ${r.url()}`);
  });
  return { consoleErrors, pageErrors, failed };
}

test.describe('[U7-BN] mobile bottom navigation', () => {
  test('[U7-BN-1] visible at 360x800, 390x844 and 767px; absent at 768px', async ({ page }) => {
    for (const vp of [MOBILE, MOBILE_TALL, { width: 767, height: 800 }]) {
      await page.setViewportSize(vp);
      await page.goto('/trade');
      await expect(page.locator(BAR), `bar at ${vp.width}px`).toBeVisible();
    }
    // 768px is the tablet breakpoint: the bar must be gone, not merely off-screen.
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/trade');
    await expect(page.locator(BAR)).toBeHidden();
  });

  test('[U7-BN-2] exactly five primary destinations, each with an accessible name', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/trade');
    const links = page.locator(`${BAR} a`);
    await expect(links).toHaveCount(5);
    for (const id of ITEMS) {
      const link = page.locator(`[data-testid="bnav-${id}"]`);
      await expect(link).toBeVisible();
      const name = (await link.getAttribute('aria-label')) ?? (await link.innerText());
      expect(name.trim().length, `bnav-${id} needs a name`).toBeGreaterThan(0);
    }
  });

  test('[U7-BN-3] anchored to the bottom edge, no horizontal overflow, content not covered', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/trade');
    const m = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="bottom-nav"]') as HTMLElement | null;
      const route = document.querySelector('.app-route') as HTMLElement | null;
      const r = bar?.getBoundingClientRect();
      return {
        bar: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) } : null,
        position: bar ? getComputedStyle(bar).position : null,
        innerH: window.innerHeight,
        docScrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        routePadBottom: route ? parseFloat(getComputedStyle(route).paddingBottom) : 0,
      };
    });
    expect(m.position).toBe('fixed');
    expect(m.bar).not.toBeNull();
    // Bottom edge of the bar sits on the bottom edge of the viewport (±1px rounding).
    expect(Math.abs(m.bar!.bottom - m.innerH)).toBeLessThanOrEqual(1);
    expect(m.docScrollW - m.clientW).toBeLessThanOrEqual(0);
    // Space is reserved for the bar so the last row of content is reachable.
    expect(m.routePadBottom).toBeGreaterThanOrEqual(m.bar!.h);
  });

  test('[U7-BN-4] every target meets 44x44', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/trade');
    const small = await page.evaluate(() => {
      const out: string[] = [];
      for (const a of document.querySelectorAll('[data-testid="bottom-nav"] a')) {
        const r = a.getBoundingClientRect();
        if (r.width < 44 || r.height < 44) {
          out.push(`${(a as HTMLElement).dataset.testid}=${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return out;
    });
    expect(small, 'bottom nav targets under 44x44').toEqual([]);
  });

  test('[U7-BN-5] each destination navigates, sets aria-current and renders its own view', async ({ page }) => {
    const w = watch(page);
    await page.setViewportSize(MOBILE);
    await page.goto('/trade');

    const expectations: Record<(typeof ITEMS)[number], { url: RegExp; probe: string }> = {
      markets: { url: /\/markets$/, probe: '[data-testid="markets-page"]' },
      chart: { url: /\/trade$/, probe: '[data-testid="chart-mount"]' },
      order: { url: /\/trade\/order$/, probe: '[data-testid="oe-percent"], [data-testid="oe-blocked"]' },
      ai: { url: /\/trade\/ai$/, probe: '[data-testid="ai-copilot"]' },
      portfolio: { url: /\/portfolio$/, probe: '[data-testid="assets-risk"], [data-testid="open-orders-table"], table' },
    };

    for (const id of ITEMS) {
      await page.locator(`[data-testid="bnav-${id}"]`).click();
      await expect(page).toHaveURL(expectations[id].url);
      await expect(page.locator(`[data-testid="bnav-${id}"]`)).toHaveAttribute('aria-current', 'page');
      // Exactly one item may be current at a time.
      await expect(page.locator(`${BAR} a[aria-current="page"]`)).toHaveCount(1);
      await expect(page.locator(expectations[id].probe).first()).toBeVisible({ timeout: 15_000 });
    }

    expect(w.pageErrors, `page errors: ${w.pageErrors.join(' | ')}`).toEqual([]);
    expect(w.consoleErrors, `console errors: ${w.consoleErrors.join(' | ')}`).toEqual([]);
    expect(w.failed, `failed requests: ${w.failed.join(' | ')}`).toEqual([]);
  });

  test('[U7-BN-6] the chart view renders a real, non-zero chart with real bars', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/trade');
    const mount = page.locator('[data-testid="chart-mount"]');
    await expect(mount).toBeVisible();
    await expect(mount).toHaveAttribute('data-chart-state', 'ready', { timeout: 20_000 });
    const s = await mount.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const canvas = el.querySelector('canvas');
      const cr = canvas?.getBoundingClientRect();
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        canvasW: cr ? Math.round(cr.width) : 0,
        canvasH: cr ? Math.round(cr.height) : 0,
        bars: Number(el.getAttribute('data-bar-count')),
        engineBars: Number(el.getAttribute('data-engine-bar-count')),
      };
    });
    expect(s.w).toBeGreaterThan(0);
    expect(s.h).toBeGreaterThan(0);
    expect(s.canvasW).toBeGreaterThan(0);
    expect(s.canvasH).toBeGreaterThan(0);
    expect(s.bars).toBeGreaterThan(50);
    expect(s.engineBars).toBe(s.bars);
  });

  test('[U7-BN-7] the selected view survives a reload and browser back/forward', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/trade');
    await page.locator('[data-testid="bnav-order"]').click();
    await expect(page).toHaveURL(/\/trade\/order$/);

    await page.reload();
    await expect(page).toHaveURL(/\/trade\/order$/);
    await expect(page.locator('[data-testid="bnav-order"]')).toHaveAttribute('aria-current', 'page');

    await page.locator('[data-testid="bnav-ai"]').click();
    await expect(page).toHaveURL(/\/trade\/ai$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/trade\/order$/);
    await expect(page.locator('[data-testid="bnav-order"]')).toHaveAttribute('aria-current', 'page');
    await page.goForward();
    await expect(page).toHaveURL(/\/trade\/ai$/);
    await expect(page.locator('[data-testid="bnav-ai"]')).toHaveAttribute('aria-current', 'page');
  });

  test('[U7-BN-8] keyboard reaches the bar and focus is visible', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/trade');
    const first = page.locator('[data-testid="bnav-markets"]');
    await first.focus();
    await expect(first).toBeFocused();
    const ring = await first.evaluate((el) => {
      const cs = getComputedStyle(el, ':focus-visible');
      return { outline: cs.outlineStyle, width: cs.outlineWidth };
    });
    // A focus ring must be declared; browsers differ on how they report the pseudo-element, so the
    // assertion is that SOMETHING is declared rather than an exact value.
    expect(ring.outline === 'none' && ring.width === '0px').toBe(false);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/markets$/);
  });

  test('[U7-BN-9] works in both themes and both locales', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    for (const theme of ['dark', 'light'] as const) {
      for (const locale of ['ko', 'en'] as const) {
        // Seed the persisted preference BEFORE first paint. Doing it with goto-then-reload needs two
        // full navigations per combination, and eight chart-bearing loads exceeded the test budget in
        // WebKit — this asserts the same thing with half the navigations and no reload race.
        await page.addInitScript(
          ([t, l]) => {
            const key =
              Object.keys(localStorage).find((k) => k.startsWith('qt.prefs.v')) ?? 'qt.prefs.v1:anon';
            localStorage.setItem(key, JSON.stringify({ theme: t, locale: l }));
          },
          [theme, locale],
        );
        await page.goto('/trade');
        await expect(page.locator(BAR)).toBeVisible();
        await expect(page.locator(`${BAR} a`)).toHaveCount(5);
        // The seeded preference must actually be the one in effect.
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        const labels = await page.locator(`${BAR} .bottom-nav__label`).allInnerTexts();
        expect(labels).toHaveLength(5);
        for (const l of labels) {
          expect(l.trim().length, `${theme}/${locale} label empty`).toBeGreaterThan(0);
          expect(l, `${theme}/${locale} raw i18n key leaked`).not.toMatch(/^nav\./);
        }
      }
    }
  });

  test('[U7-BN-10] desktop is unaffected: no bottom bar, 24-column grid intact', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/trade');
    await expect(page.locator(BAR)).toBeHidden();
    const cols = await page
      .locator('.widget-grid')
      .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(/\s+/).length);
    expect(cols).toBe(24);
    // The desktop terminal still shows multiple widgets at once (not the one-per-view mobile stack).
    expect(await page.locator('.panel').count()).toBeGreaterThan(2);
    await expect(page.locator('[data-testid="trade-mobile"]')).toHaveCount(0);
  });

  test('[U7-BN-11] resizing across the boundary leaves exactly one navigation live', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/trade');
    await expect(page.locator(BAR)).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.locator(BAR)).toBeHidden();
    // Focus must not be stranded on a now-hidden control.
    const stranded = await page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null;
      if (!a || a === document.body) return false;
      return a.closest('[data-testid="bottom-nav"]') !== null && getComputedStyle(a).display === 'none';
    });
    expect(stranded).toBe(false);
    await page.setViewportSize(MOBILE);
    await expect(page.locator(BAR)).toBeVisible();
  });
});
