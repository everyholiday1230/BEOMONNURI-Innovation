import { test, expect, type Page } from '@playwright/test';

/**
 * Flow L — Layout GEOMETRY.
 *
 * Phase 6's layout E2E (flow-a) only asserted that widget elements exist and are "visible". The
 * shell was in fact collapsed into a phantom 56px column with the widget grid squeezed into a
 * single 1/24 cell (panels 18–66px wide) — every existence/visibility assertion still passed. This
 * spec asserts the RENDERED BOX of each shell region instead.
 *
 * Thresholds are derived from the viewport (fractions), not pinned to one screen size, so the spec
 * cannot be satisfied by tuning CSS to a single test resolution.
 */

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  const el = page.locator(selector).first();
  await expect(el, `${selector} must be present`).toBeAttached();
  const box = await el.boundingBox();
  expect(box, `${selector} must have a layout box (not display:none)`).not.toBeNull();
  return box!;
}

/** Overlap area of two boxes. Adjacent regions may touch (0) but must not intersect. */
function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

const VIEWPORTS = [
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
];

async function assertShellGeometry(page: Page, vw: number, vh: number): Promise<void> {
  const shell = await boxOf(page, '.app-shell');
  const header = await boxOf(page, '.app-header');
  const symbolHeader = await boxOf(page, '.symbol-header');
  const tradeBody = await boxOf(page, '.trade-body');
  const grid = await boxOf(page, '.widget-grid');

  // Absolute floors from the hotfix acceptance criteria (all test viewports are ≥1366x768).
  expect(shell.width).toBeGreaterThan(1000);
  expect(shell.height).toBeGreaterThan(600);
  expect(tradeBody.width).toBeGreaterThan(800);
  expect(tradeBody.height).toBeGreaterThan(400);

  // Viewport-relative floors: the shell fills the screen, no phantom column steals width.
  expect(shell.width).toBeGreaterThanOrEqual(vw * 0.98);
  expect(shell.height).toBeGreaterThanOrEqual(vh * 0.95);
  expect(shell.x).toBeLessThanOrEqual(2);
  expect(tradeBody.width).toBeGreaterThanOrEqual(vw * 0.95);
  expect(grid.width).toBeGreaterThanOrEqual(vw * 0.9);

  // Bands must stack, never overlap.
  expect(overlapArea(header, symbolHeader)).toBe(0);
  expect(overlapArea(header, tradeBody)).toBe(0);
  expect(overlapArea(symbolHeader, tradeBody)).toBe(0);
  expect(symbolHeader.y).toBeGreaterThanOrEqual(header.y + header.height - 1);
  expect(tradeBody.y).toBeGreaterThanOrEqual(symbolHeader.y + symbolHeader.height - 1);

  // Nothing is pushed outside the viewport horizontally.
  const overflowX = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflowX).toBeLessThanOrEqual(1);

  // Every rendered panel has a real box, and the widest is a meaningful share of the screen.
  const panels = await page.locator('.widget-grid > *').all();
  expect(panels.length).toBeGreaterThan(0);
  const widths: number[] = [];
  for (const panel of panels) {
    const b = await panel.boundingBox();
    expect(b, 'a grid child must not be display:none').not.toBeNull();
    expect(b!.width).toBeGreaterThan(60);
    expect(b!.height).toBeGreaterThan(30);
    widths.push(b!.width);
  }
  expect(Math.max(...widths)).toBeGreaterThanOrEqual(vw * 0.25);

  // The chart panel specifically must be large enough to draw in.
  const chart = await boxOf(page, '[data-testid="chart-mount"]');
  expect(chart.width).toBeGreaterThan(500);
  expect(chart.height).toBeGreaterThan(300);
  const chartCanvas = await boxOf(page, '[data-testid="chart-mount"] canvas');
  expect(chartCanvas.width).toBeGreaterThan(200);
  expect(chartCanvas.height).toBeGreaterThan(100);
}

for (const vp of VIEWPORTS) {
  test(`trading layout geometry is sound at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/trade');
    await expect(page.locator('[data-testid="chart-mount"]')).toHaveAttribute('data-chart-state', 'ready');
    await assertShellGeometry(page, vp.width, vp.height);
  });
}

test('layout survives a runtime resize', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/trade');
  await expect(page.locator('[data-testid="chart-mount"]')).toHaveAttribute('data-chart-state', 'ready');
  await assertShellGeometry(page, 1920, 1080);

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(400);
  await assertShellGeometry(page, 1366, 768);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(400);
  await assertShellGeometry(page, 1920, 1080);
});

test('layout geometry holds in both themes', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/trade');
  await expect(page.locator('[data-testid="chart-mount"]')).toHaveAttribute('data-chart-state', 'ready');

  for (const expected of ['light', 'dark']) {
    await page.getByRole('button', { name: 'toggle theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', expected);
    await assertShellGeometry(page, 1366, 768);
  }
});

test('layout geometry holds in both locales', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/trade');
  await expect(page.locator('[data-testid="chart-mount"]')).toHaveAttribute('data-chart-state', 'ready');

  await page.getByRole('button', { name: 'toggle language' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await assertShellGeometry(page, 1366, 768);

  await page.getByRole('button', { name: 'toggle language' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ko');
  await assertShellGeometry(page, 1366, 768);
});

test('layout geometry holds with reduced motion', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.goto('/trade');
  await expect(page.locator('[data-testid="chart-mount"]')).toHaveAttribute('data-chart-state', 'ready');
  await assertShellGeometry(page, 1366, 768);
  await context.close();
});

test('layout edit mode keeps the grid and its widgets measurable', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/trade/layout');
  await expect(page.locator('.widget-grid')).toBeVisible();

  const grid = await boxOf(page, '.widget-grid');
  expect(grid.width).toBeGreaterThanOrEqual(1366 * 0.9);
  const tradeBody = await boxOf(page, '.trade-body');
  expect(tradeBody.width).toBeGreaterThan(800);
  expect(tradeBody.height).toBeGreaterThan(400);

  for (const panel of await page.locator('.widget-grid > *').all()) {
    const b = await panel.boundingBox();
    expect(b).not.toBeNull();
    expect(b!.width).toBeGreaterThan(60);
    expect(b!.height).toBeGreaterThan(30);
  }
});

test('non-grid routes still fill the shell', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  for (const route of ['/settings', '/status', '/design-system']) {
    await page.goto(route);
    const shell = await boxOf(page, '.app-shell');
    expect(shell.width, `${route} shell width`).toBeGreaterThanOrEqual(1366 * 0.98);
    expect(shell.height, `${route} shell height`).toBeGreaterThanOrEqual(768 * 0.95);
    const pageBox = await boxOf(page, '.page');
    expect(pageBox.width, `${route} page width`).toBeGreaterThan(800);
    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflowX, `${route} horizontal overflow`).toBeLessThanOrEqual(1);
  }
});
