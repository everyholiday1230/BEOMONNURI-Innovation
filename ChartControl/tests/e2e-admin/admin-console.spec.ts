import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Admin console-hygiene + layout spec (Phase 6 UI/Chart hotfix closure).
 *
 * The admin Overview and AI Operations screens rendered `<>` fragments inside `.map()` with the
 * `key` placed on the inner `<dt>` instead of the fragment, so React emitted "Each child in a list
 * should have a unique key" on every render. No existing spec looked at the console, so the warning
 * shipped unnoticed. This spec walks every admin screen and fails on ANY React warning/error.
 *
 * Allowed-noise policy: only messages that are provably outside application control are ignored,
 * and each exception carries its reason inline. Nothing React-related is ever ignored.
 */

/**
 * Console noise that is NOT an application defect:
 * - `Failed to load resource: ... 401` — the shell probes `/api/admin/overview` BEFORE login to
 *   decide between the login form and the dashboard. The 401 is the expected, designed answer, and
 *   the browser logs it as a console error independently of our code (it cannot be suppressed
 *   without hiding real network errors).
 * - `net::ERR_ABORTED` / `NS_BINDING_ABORTED` — request cancellation on navigation (browser-level).
 */
const ALLOWED = [
  /Failed to load resource.*(401|403)/i,
  /the server responded with a status of (401|403)/i,
  /ERR_ABORTED|NS_BINDING_ABORTED/i,
];

interface Captured {
  errors: string[];
  warnings: string[];
}

function capture(page: Page): Captured {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    const text = m.text();
    if (ALLOWED.some((re) => re.test(text))) return;
    if (m.type() === 'error') errors.push(text);
    if (m.type() === 'warning') warnings.push(text);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { errors, warnings };
}

const SCREENS = [
  '#/overview',
  '#/users',
  '#/exchange',
  '#/orders',
  '#/ai',
  '#/audit',
  '#/incidents',
  '#/flags',
  '#/kill',
  '#/gates',
];

test('[31] every admin screen renders without React key warnings or console errors', async ({ page }) => {
  const seen = capture(page);

  await page.goto('/');
  await page.getByLabel(/Email|이메일/).fill('admin@qt.local');
  await page.getByLabel(/Password|비밀번호/).fill('adminpass1234');
  await page.getByRole('button', { name: /Sign in|로그인/ }).click();
  await expect(page.getByRole('navigation', { name: 'admin' })).toBeVisible();

  for (const hash of SCREENS) {
    await page.goto(`/${hash}`);
    // Each screen is a lazy chunk; wait for the heading to prove it mounted before judging.
    await expect(page.locator('main h2')).toBeVisible();
    await page.waitForTimeout(150);
  }

  const keyWarnings = [...seen.warnings, ...seen.errors].filter((t) => /unique "?key"?/i.test(t));
  expect(keyWarnings, `React key warnings: ${keyWarnings.join(' | ')}`).toEqual([]);
  expect(seen.errors, `console errors: ${seen.errors.join(' | ')}`).toEqual([]);
  expect(seen.warnings, `console warnings: ${seen.warnings.join(' | ')}`).toEqual([]);
});

test('[32] Overview and AI Operations definition lists have unique, stable keys', async ({ page }) => {
  const seen = capture(page);

  await page.goto('/');
  await page.getByLabel(/Email|이메일/).fill('admin@qt.local');
  await page.getByLabel(/Password|비밀번호/).fill('adminpass1234');
  await page.getByRole('button', { name: /Sign in|로그인/ }).click();
  await expect(page.getByRole('navigation', { name: 'admin' })).toBeVisible();

  // Overview renders four <dl> cards; every <dt> label inside a card must be unique.
  await page.goto('/#/overview');
  await expect(page.locator('main h2')).toBeVisible();
  const cards = await page.locator('main section').all();
  expect(cards.length).toBeGreaterThan(0);
  for (const card of cards) {
    const labels = await card.locator('dt').allInnerTexts();
    expect(new Set(labels).size, `duplicate <dt> labels in card: ${labels.join(',')}`).toBe(labels.length);
    // dt/dd must stay paired — a broken fragment would desynchronize them.
    expect(await card.locator('dd').count()).toBe(labels.length);
  }

  await page.goto('/#/ai');
  await expect(page.locator('main h2')).toBeVisible();
  const aiLabels = await page.locator('main dl dt').allInnerTexts();
  expect(new Set(aiLabels).size).toBe(aiLabels.length);
  expect(await page.locator('main dl dd').count()).toBe(aiLabels.length);

  // Re-navigating must not accumulate warnings either (keys stable across remounts).
  await page.goto('/#/overview');
  await page.goto('/#/ai');
  await expect(page.locator('main h2')).toBeVisible();
  expect(seen.errors, `console errors: ${seen.errors.join(' | ')}`).toEqual([]);
  expect(seen.warnings, `console warnings: ${seen.warnings.join(' | ')}`).toEqual([]);
});

test('[33] admin shell geometry: sidebar and main content do not overlap or collapse', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel(/Email|이메일/).fill('admin@qt.local');
  await page.getByLabel(/Password|비밀번호/).fill('adminpass1234');
  await page.getByRole('button', { name: /Sign in|로그인/ }).click();
  await expect(page.getByRole('navigation', { name: 'admin' })).toBeVisible();

  for (const vp of [
    { width: 1366, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(vp);
    await page.waitForTimeout(200);

    const aside = await page.locator('aside').first().boundingBox();
    const main = await page.locator('main').first().boundingBox();
    expect(aside, 'admin sidebar must have a box').not.toBeNull();
    expect(main, 'admin main must have a box').not.toBeNull();

    expect(aside!.width).toBeGreaterThan(120);
    expect(aside!.height).toBeGreaterThan(vp.height * 0.8);
    expect(main!.width).toBeGreaterThan(vp.width * 0.6);
    expect(main!.height).toBeGreaterThan(200);

    // Side-by-side, not stacked on top of each other.
    expect(main!.x).toBeGreaterThanOrEqual(aside!.x + aside!.width - 1);

    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowX, `horizontal overflow at ${vp.width}x${vp.height}`).toBeLessThanOrEqual(1);
  }
});
