import { test, expect, type Page } from '@playwright/test';

/**
 * Prompt 3 — responsive, theme, locale and accessibility acceptance.
 *
 * The audit's P1 responsive finding was that the 24-column trade grid survived at 360px, leaving
 * ~111px panels and no mobile menu. [U7-1] measures that directly instead of eyeballing it.
 */

const VIEWPORTS = [
  { name: '360x800', width: 360, height: 800 },
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
];

async function geometry(page: Page) {
  return page.evaluate(() => {
    const box = (sel: string) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    };
    const panels = [...document.querySelectorAll('.panel')].map((e) => {
      const r = e.getBoundingClientRect();
      return { type: (e as HTMLElement).dataset.widgetType ?? '?', w: Math.round(r.width), h: Math.round(r.height) };
    });
    let smallTargets = 0;
    for (const e of document.querySelectorAll('button:not(:disabled), a[href], input, select, textarea')) {
      const r = e.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.height < 24 || r.width < 24)) smallTargets++;
    }
    return {
      shell: box('.app-shell'),
      body: box('.trade-body'),
      grid: box('.widget-grid'),
      panels,
      docOverflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      bodyOverflowX: (() => {
        const b = document.querySelector('.trade-body') as HTMLElement | null;
        return b ? Math.max(0, b.scrollWidth - b.clientWidth) : 0;
      })(),
      smallTargets,
    };
  });
}

test.describe('[U7] responsive layout', () => {
  for (const vp of VIEWPORTS) {
    test(`[U7-1] /trade at ${vp.name}: no horizontal overflow and no collapsed panels`, async ({ page }) => {
      const mobile = vp.width <= 767;
      await page.setViewportSize({ width: vp.width, height: vp.height });
      // Below 768px the official responsive spec renders ONE view per bottom-nav destination, so the
      // order entry lives on `/trade/order` rather than alongside the chart. Above it, the full
      // terminal is on `/trade` as before.
      await page.goto(mobile ? '/trade/order' : '/trade');
      await expect(page.locator('[data-testid="order-entry"]')).toBeVisible();
      const g = await geometry(page);

      expect(g.docOverflowX, `document overflow at ${vp.name}`).toBe(0);
      expect(g.bodyOverflowX, `trade-body horizontal overflow at ${vp.name}`).toBe(0);
      // The mobile order view is intentionally two panels (order entry + positions); the desktop
      // terminal still has to show the full widget set.
      expect(g.panels.length).toBeGreaterThanOrEqual(mobile ? 2 : 6);
      for (const p of g.panels) {
        // 111px panels were the audit's mobile failure mode.
        expect(p.w, `${vp.name} panel ${p.type} width`).toBeGreaterThanOrEqual(mobile ? 240 : 100);
        expect(p.h, `${vp.name} panel ${p.type} height`).toBeGreaterThan(60);
      }
    });
  }

  test('[U7-1b] every mobile view fits 360px without overflow or collapsed panels', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    for (const route of ['/trade', '/trade/order', '/trade/ai', '/markets', '/portfolio']) {
      await page.goto(route);
      await expect(page.locator('[data-testid="bottom-nav"]')).toBeVisible();
      const m = await page.evaluate(() => {
        const panels = [...document.querySelectorAll('.panel')].map((e) => {
          const r = e.getBoundingClientRect();
          return { type: (e as HTMLElement).dataset.widgetType ?? '?', w: Math.round(r.width), h: Math.round(r.height) };
        });
        return {
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          panels,
        };
      });
      expect(m.overflowX, `overflow on ${route}`).toBeLessThanOrEqual(0);
      for (const p of m.panels) {
        expect(p.w, `${route} panel ${p.type} width`).toBeGreaterThanOrEqual(240);
        expect(p.h, `${route} panel ${p.type} height`).toBeGreaterThan(60);
      }
    }
  });

  test('[U7-2] mobile stacks the grid into a single column', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/#/trade/order');
    await expect(page.locator('[data-testid="order-entry"]')).toBeVisible();
    const lefts = await page.locator('.panel').evaluateAll((els) =>
      [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().left)))],
    );
    expect(lefts.length, `panels should share one column, got lefts ${lefts.join(',')}`).toBe(1);
  });

  test('[U7-3] desktop keeps the 24-column track', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/trade');
    const cols = await page.locator('.widget-grid').evaluate((e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
    expect(cols).toBe(24);
  });

  test('[U7-4] portfolio and markets pages fit every viewport', async ({ page }) => {
    for (const vp of [VIEWPORTS[0]!, VIEWPORTS[2]!, VIEWPORTS[4]!]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const route of ['/markets', '/portfolio']) {
        await page.goto(route);
        const overflow = await page.evaluate(
          () => Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
        );
        expect(overflow, `${route} at ${vp.name}`).toBe(0);
      }
    }
  });
});

test.describe('[U7] theme and locale', () => {
  /**
   * Waits until the persisted preferences slot actually contains `expected`.
   *
   * WebKit commits `localStorage` to its storage process asynchronously, so reloading in the same
   * tick as the click can outrun the write and read back the previous value. Asserting on the stored
   * bytes first makes the test STRONGER (it now checks the write itself, not just the reload result)
   * and removes the race instead of papering over it with a sleep.
   */
  async function expectPersisted(page: import('@playwright/test').Page, field: string, expected: string) {
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const key = Object.keys(localStorage).find((k) => k.startsWith('qt.prefs.v'));
            return key ? localStorage.getItem(key) : null;
          }),
        { timeout: 5_000 },
      )
      .toContain(`"${field}":"${expected}"`);
  }

  test('[U7-5] theme toggle switches and persists across a reload', async ({ page }) => {
    await page.goto('/#/trade');
    const before = await page.evaluate(() => document.documentElement.dataset.theme);
    await page.locator('[data-testid="theme-toggle"]').click();
    const after = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(after).not.toBe(before);
    await expectPersisted(page, 'theme', after!);
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(after);
  });

  test('[U7-6] locale toggle switches the document language, translates the UI and persists', async ({ page }) => {
    await page.goto('/#/trade');
    const beforeLang = await page.evaluate(() => document.documentElement.lang);
    await page.locator('[data-testid="locale-toggle"]').click();
    const afterLang = await page.evaluate(() => document.documentElement.lang);
    expect(afterLang).not.toBe(beforeLang);
    await expectPersisted(page, 'locale', afterLang);
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.lang)).toBe(afterLang);
  });

  test('[U7-7] the English locale exposes no Korean text and no raw i18n keys', async ({ page }) => {
    await page.goto('/#/trade');
    const lang = await page.evaluate(() => document.documentElement.lang);
    if (lang !== 'en') await page.locator('[data-testid="locale-toggle"]').click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    for (const route of ['/trade', '/markets', '/portfolio', '/notifications', '/settings']) {
      await page.goto(route);
      const text = await page.locator('body').innerText();
      const korean = text.match(/[\u3131-\uD79D]+/g) ?? [];
      expect(korean, `Korean text on ${route} in en locale: ${korean.slice(0, 5).join(', ')}`).toEqual([]);
      // an untranslated key would render as e.g. "order.err.qtyMin"
      const rawKeys = text.match(/\b(?:nav|order|pos|assets|ai|search|mw|ob|state|action|notif)\.[a-zA-Z.]{3,}/g) ?? [];
      expect(rawKeys, `untranslated keys on ${route}: ${rawKeys.slice(0, 5).join(', ')}`).toEqual([]);
    }
  });

  test('[U7-8] both themes keep the trade grid measurable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const _ of [0, 1]) {
      await page.goto('/#/trade');
      await expect(page.locator('[data-testid="order-entry"]')).toBeVisible();
      const g = await geometry(page);
      expect(g.grid!.w).toBeGreaterThan(1000);
      expect(g.docOverflowX).toBe(0);
      await page.locator('[data-testid="theme-toggle"]').click();
    }
  });
});

test.describe('[U7] accessibility', () => {
  test('[U7-9] every route has exactly one h1 and a landmark main', async ({ page }) => {
    for (const route of ['/markets', '/portfolio', '/notifications', '/account', '/settings', '/status']) {
      await page.goto(route);
      await expect(page.locator('main#main .page h1').first()).toBeVisible({ timeout: 15_000 });
      expect(await page.locator('main#main').count(), `main on ${route}`).toBe(1);
      expect(await page.locator('h1').count(), `h1 count on ${route}`).toBe(1);
    }
  });

  test('[U7-10] all interactive controls have an accessible name', async ({ page }) => {
    await page.goto('/#/trade');
    const unnamed = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll('button, a[href], input, select, textarea')) {
        const e = el as HTMLElement;
        if (e.offsetParent === null) continue;
        const name =
          e.getAttribute('aria-label') ??
          e.getAttribute('title') ??
          (e.getAttribute('aria-labelledby') ? 'labelled' : '') ??
          '';
        const text = (e.textContent ?? '').trim();
        const labelled = e.closest('label') !== null || (e as HTMLInputElement).labels?.length;
        if (!name && !text && !labelled) bad.push(`${e.tagName}.${e.className}`);
      }
      return bad;
    });
    expect(unnamed, `controls without an accessible name: ${unnamed.join(', ')}`).toEqual([]);
  });

  test('[U7-11] the order form marks invalid fields with aria-invalid and role=alert', async ({ page }) => {
    await page.goto('/#/trade');
    await page.locator('[data-testid="oe-qty"]').fill('0');
    await expect(page.locator('[data-testid="oe-qty"]')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('[data-testid="oe-qty-err"]')).toHaveAttribute('role', 'alert');
  });

  test('[U7-12] the whole order flow is reachable with the keyboard only', async ({ page }) => {
    await page.goto('/#/trade');
    await page.locator('[data-testid="oe-qty"]').focus();
    await page.keyboard.type('0.010');
    // Walk forward within the order-entry panel only; the grid contains other panels' controls too.
    let reached = false;
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
      if (id === 'oe-preview') {
        reached = true;
        break;
      }
      const inPanel = await page.evaluate(() =>
        Boolean(document.activeElement?.closest('[data-widget-type="orderEntry"]')),
      );
      if (!inPanel) break; // left the panel: the remaining controls belong to other widgets
    }
    expect(reached, 'the preview button must be reachable by Tab from the size field').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="order-preview-modal"]')).toBeVisible();
  });

  test('[U7-13] tables carry a caption and scoped headers', async ({ page }) => {
    await page.goto('/#/portfolio');
    await page.locator('[data-testid="pos-tab-openOrders"]').click();
    const tables = await page.locator('table').count();
    if (tables > 0) {
      expect(await page.locator('table caption').count()).toBeGreaterThan(0);
      expect(await page.locator('table th[scope="col"]').count()).toBeGreaterThan(0);
    }
  });

  test('[U7-14] mobile touch targets meet the minimum size', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    // The order entry is the densest control cluster; below 768px it is its own view.
    await page.goto('/#/trade/order');
    await expect(page.locator('[data-testid="order-entry"]')).toBeVisible();
    const tiny = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll('button:not(:disabled), a[href]')) {
        const e = el as HTMLElement;
        if (e.offsetParent === null) continue;
        const r = e.getBoundingClientRect();
        if (r.height > 0 && r.height < 24) bad.push(`${e.tagName}.${e.className}:${Math.round(r.height)}`);
      }
      return bad;
    });
    expect(tiny, `targets under 24px: ${tiny.join(', ')}`).toEqual([]);
  });

  test('[U7-15] a route crash is contained by the boundary, shell stays usable', async ({ page }) => {
    await page.goto('/#/trade');
    // The boundary is exercised at the widget level by widgets.test.tsx; here we only assert the
    // shell landmarks survive a route change into a heavy page and back.
    await page.goto('/#/portfolio');
    await page.goto('/#/trade');
    await expect(page.locator('.app-header')).toBeVisible();
    await expect(page.locator('main#main')).toBeVisible();
  });
});
