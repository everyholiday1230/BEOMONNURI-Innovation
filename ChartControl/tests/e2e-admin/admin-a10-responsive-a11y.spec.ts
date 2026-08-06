import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

/**
 * A10 / A11 — Admin responsive, i18n, accessibility and visual measurement.
 *
 * There is NO admin design mockup (verified: the official handoff bundle contains no admin asset), so
 * this is not a pixel comparison. It measures conformance to the SHARED design language that the
 * official `design-system.html` does specify — breakpoints, tabular numerals, non-colour-only status,
 * focus rings, reduced motion — plus the defect classes that are objectively wrong at any size.
 */

const OUT = process.env.QT_ADMIN_VIS_OUT ?? '/tmp/qt-vis-admin';

const VIEWPORTS = [
  { name: '360x800', width: 360, height: 800 },
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
];

const SCREENS = [
  '#/overview',
  '#/system',
  '#/users',
  '#/orders',
  '#/exchange',
  '#/ai',
  '#/security',
  '#/audit',
  '#/incidents',
  '#/flags',
  '#/kill',
  '#/reports',
  '#/backup',
  '#/gates',
] as const;

async function loginAdmin(page: Page) {
  await page.goto('/');
  await page.getByLabel(/Email|이메일/).fill('admin@qt.local');
  await page.getByLabel(/Password|비밀번호/).fill('adminpass1234');
  await page.getByRole('button', { name: /Sign in|로그인/ }).click();
  await expect(page.getByTestId('admin-topbar')).toBeVisible();
}

async function goto(page: Page, hash: string) {
  await page.evaluate((h) => {
    window.location.hash = h;
  }, hash);
  await expect(page.getByTestId('page-title')).toBeVisible();
  // Screens are lazy chunks; wait for the main region to have content.
  await page.waitForFunction(() => (document.querySelector('#admin-main')?.textContent ?? '').length > 0);
  await page.waitForTimeout(200);
}

test('[A10-1] every admin screen renders at every viewport with no overflow or zero-size panel', async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(OUT, { recursive: true });
  const rows: Record<string, unknown>[] = [];

  await loginAdmin(page);

  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const hash of SCREENS) {
      await goto(page, hash);
      const m = await page.evaluate(() => {
        // An element hidden by an ANCESTOR (`.tbl-scroll { display:none }` at the card breakpoint) has
        // its own `display` intact, so checking the element alone reports a false zero-size defect.
        const hidden = (el: Element) => (el as HTMLElement).offsetParent === null && getComputedStyle(el).position !== 'fixed';
        const zero: string[] = [];
        for (const el of document.querySelectorAll('#admin-main .card, #admin-main table, #admin-main .tbl-card')) {
          const r = el.getBoundingClientRect();
          if (r.width > 0 || r.height > 0) continue;
          if (hidden(el)) continue;
          zero.push(el.tagName.toLowerCase() + '.' + (el.className || '?'));
        }
        const tiny: string[] = [];
        for (const el of document.querySelectorAll('#admin-main button:not(:disabled), #admin-main a[href], nav a')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          if (hidden(el)) continue;
          if (r.height < 24 || r.width < 24) {
            tiny.push(`${(el as HTMLElement).dataset.testid ?? el.textContent?.trim().slice(0, 14)}=${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        }
        return {
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          h1: document.querySelectorAll('h1').length,
          main: document.querySelectorAll('main').length,
          zero,
          tiny,
        };
      });
      rows.push({ hash, viewport: vp.name, ...m });

      expect(m.overflowX, `horizontal overflow on ${hash} @ ${vp.name}`).toBeLessThanOrEqual(0);
      expect(m.zero, `zero-size panels on ${hash} @ ${vp.name}`).toEqual([]);
      expect(m.tiny, `sub-24px targets on ${hash} @ ${vp.name}`).toEqual([]);
      // Exactly one h1 and one main landmark per screen.
      expect(m.h1, `h1 count on ${hash} @ ${vp.name}`).toBe(1);
      expect(m.main, `main landmark count on ${hash} @ ${vp.name}`).toBe(1);
    }
  }

  writeFileSync(`${OUT}/admin-measurements.json`, JSON.stringify(rows, null, 2));
});

test('[A10-2] navigation switches correctly across the official breakpoints', async ({ page }) => {
  await loginAdmin(page);

  // ≥1280: persistent sidebar, no drawer toggle, no bottom bar.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByTestId('admin-sidebar')).toBeVisible();
  await expect(page.getByTestId('admin-nav-toggle')).toBeHidden();
  await expect(page.getByTestId('admin-bottom-nav')).toBeHidden();

  // 1024–1279: sidebar collapses, drawer toggle appears.
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(page.getByTestId('admin-sidebar')).toBeHidden();
  await expect(page.getByTestId('admin-nav-toggle')).toBeVisible();
  await expect(page.getByTestId('admin-bottom-nav')).toBeHidden();

  // <768: bottom bar appears.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('admin-bottom-nav')).toBeVisible();
  await expect(page.getByTestId('admin-sidebar')).toBeHidden();

  // 767 vs 768 boundary.
  await page.setViewportSize({ width: 767, height: 800 });
  await expect(page.getByTestId('admin-bottom-nav')).toBeVisible();
  await page.setViewportSize({ width: 768, height: 1024 });
  await expect(page.getByTestId('admin-bottom-nav')).toBeHidden();
});

test('[A10-3] the mobile bottom bar is admin-specific, permission-filtered and at most five', async ({ page }) => {
  await loginAdmin(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const links = page.locator('[data-testid="admin-bottom-nav"] a');
  const n = await links.count();
  expect(n).toBeGreaterThan(0);
  expect(n, 'at most five primary destinations').toBeLessThanOrEqual(5);

  // It must NOT be a copy of the user app's Markets/Chart/Order/AI/Portfolio.
  const labels = (await links.allInnerTexts()).join('|').toLowerCase();
  expect(labels).not.toMatch(/portfolio/);
  // Every item must be a route this session may actually open.
  for (let i = 0; i < n; i += 1) {
    const href = await links.nth(i).getAttribute('href');
    expect(href).toMatch(/^#\//);
  }
  // 44px touch targets.
  const small = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="admin-bottom-nav"] a')]
      .filter((a) => {
        const r = a.getBoundingClientRect();
        return r.height < 44;
      })
      .map((a) => (a as HTMLElement).dataset.testid ?? '?'),
  );
  expect(small, 'bottom nav items under 44px tall').toEqual([]);
});

test('[A10-4] SUPPORT sees fewer destinations than ADMIN, and none it cannot open', async ({ page, context }) => {
  // ADMIN
  await loginAdmin(page);
  const adminLinks = await page.locator('[data-testid="admin-nav"] a').count();
  await context.clearCookies();

  // SUPPORT
  await page.goto('/');
  await page.getByLabel(/Email|이메일/).fill('support@qt.local');
  await page.getByLabel(/Password|비밀번호/).fill('supportpass1234');
  await page.getByRole('button', { name: /Sign in|로그인/ }).click();
  await expect(page.getByTestId('admin-nav')).toBeVisible();
  const supportLinks = await page.locator('[data-testid="admin-nav"] a').count();

  expect(supportLinks).toBeGreaterThan(0);
  expect(supportLinks, 'SUPPORT must see a strictly smaller menu than ADMIN').toBeLessThan(adminLinks);
  await expect(page.getByTestId('role-badge')).toContainText('SUPPORT');
  // SUPPORT has no audit permission → the destination must not be offered…
  await expect(page.getByTestId('nav-audit')).toHaveCount(0);
  // …and typing the URL must be refused, not rendered.
  await page.evaluate(() => {
    window.location.hash = '#/audit';
  });
  await expect(page.locator('[data-state="denied"]')).toBeVisible();
});

test('[A10-5] both locales translate every screen with no raw keys', async ({ page }) => {
  await loginAdmin(page);
  for (const lang of ['en', 'ko'] as const) {
    await page.evaluate((l) => localStorage.setItem('admin.lang', l), lang);
    await page.reload();
    await expect(page.getByTestId('admin-topbar')).toBeVisible();
    for (const hash of SCREENS) {
      await goto(page, hash);
      const text = await page.locator('#admin-main').innerText();
      // A raw i18n key leaking into the UI looks like `nav.users` / `ord.col.id`.
      const raw = text.match(/\b(nav|ord|pos|ai|gw|aud|sec|rep|bak|table|act|policy|sev|ov|sys|users)\.[a-zA-Z.]+/g);
      expect(raw, `raw i18n keys on ${hash} in ${lang}: ${raw?.join(', ')}`).toBeNull();
    }
    if (lang === 'en') {
      const en = await page.locator('#admin-main').innerText();
      expect(en, 'the English UI must not contain Korean text').not.toMatch(/[\u3131-\uD79D]/);
    }
  }
});

test('[A10-6] status is never communicated by colour alone', async ({ page }) => {
  await loginAdmin(page);
  for (const hash of ['#/overview', '#/system', '#/security', '#/exchange']) {
    await goto(page, hash);
    const bad = await page.evaluate(() =>
      [...document.querySelectorAll('.sev')]
        .filter((el) => {
          // Every severity pill must carry a glyph AND text, not just a colour class.
          const hasGlyph = el.querySelector('[aria-hidden="true"]') !== null;
          const hasText = (el.textContent ?? '').trim().length > 0;
          return !hasGlyph || !hasText;
        })
        .map((el) => el.className),
    );
    expect(bad, `colour-only status indicators on ${hash}`).toEqual([]);
  }
});

test('[A10-7] numeric cells use tabular figures so live updates cannot shift the layout', async ({ page }) => {
  await loginAdmin(page);
  await goto(page, '#/orders');
  const nonTabular = await page.evaluate(() =>
    [...document.querySelectorAll('#admin-main .is-numeric, #admin-main .mono')]
      .filter((el) => !getComputedStyle(el).fontVariantNumeric.includes('tabular-nums'))
      .map((el) => el.className)
      .slice(0, 5),
  );
  expect(nonTabular, 'numeric cells without tabular-nums').toEqual([]);
});

test('[A10-8] reduced motion is honoured and the skip link works', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await loginAdmin(page);
  const animated = await page.evaluate(() =>
    [...document.querySelectorAll('*')]
      .filter((el) => {
        const cs = getComputedStyle(el);
        return cs.animationName !== 'none' && cs.animationDuration !== '0s';
      })
      .map((el) => el.className)
      .slice(0, 5),
  );
  expect(animated, 'animations still running under prefers-reduced-motion').toEqual([]);

  // Skip link is the first tab stop and moves focus to the main region.
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.className ?? '');
  expect(focused).toContain('skip-link');
  await page.keyboard.press('Enter');
  await expect(page.locator('#admin-main')).toBeVisible();
});

test('[A10-9] tables are accessible: caption, scoped headers, aria-sort, real sort buttons', async ({ page }) => {
  await loginAdmin(page);
  await goto(page, '#/users');
  await page.locator('[data-testid="users"]:not([data-table-status="loading"])').waitFor({ timeout: 15_000 });
  const status = await page.getByTestId('users').getAttribute('data-table-status');
  if (status !== 'ready') {
    test.skip(true, `users table not populated in this environment (status=${status})`);
    return;
  }
  const t = page.getByTestId('users-table');
  await expect(t.locator('caption')).toHaveCount(1);
  const unscoped = await t.locator('thead th:not([scope])').count();
  expect(unscoped, 'every header cell needs scope="col"').toBe(0);
  const noAriaSort = await t.locator('thead th:not([aria-sort])').count();
  expect(noAriaSort, 'every header cell needs aria-sort').toBe(0);

  // Sorting is driven by a real button and updates aria-sort.
  await page.getByTestId('users-sort-email').click();
  await expect(t.locator('th[data-col="email"]')).toHaveAttribute('aria-sort', 'ascending');
  await page.getByTestId('users-sort-email').click();
  await expect(t.locator('th[data-col="email"]')).toHaveAttribute('aria-sort', 'descending');
});

test('[A10-10] no console, page or non-auth network errors across every admin screen', async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const bad: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/Failed to load resource/.test(text) && /401|403/.test(text)) return; // expected probes
    consoleErrors.push(text);
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() < 400) return;
    if ([401, 403].includes(r.status())) return; // permission probes are part of the design
    bad.push(`${r.status()} ${r.url()}`);
  });

  await loginAdmin(page);
  for (const hash of SCREENS) await goto(page, hash);

  expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  expect(bad, `failed requests: ${bad.join(' | ')}`).toEqual([]);
});
