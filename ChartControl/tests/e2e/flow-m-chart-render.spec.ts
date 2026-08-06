import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * Flow M — Chart DATA + RENDER.
 *
 * Phase 6's chart coverage asserted that the mount element and a canvas existed. Both were true
 * while the chart was completely blank: the klinecharts façade called the v9 `applyNewData` through
 * optional chaining, klinecharts 10 removed it, and the call silently no-oped. The BFF returned 300
 * valid candles that never reached the engine.
 *
 * This spec asserts the data actually arrived (adapter-reported bar count + timestamp range) AND
 * that pixels were drawn (canvas sampling finds candle colours over the panel background).
 */

const CHART = '[data-testid="chart-mount"]';

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    // Same exclusion as flow-n-user-shell: the browser logs "Failed to load resource … 401" for the
    // ANONYMOUS session probe (`/api/auth/me`), which every screen now performs so it can decide whether
    // to load server-side favourites. That 401 is the expected answer for a signed-out visitor, not a
    // fault. Application-level console errors and page errors are still asserted to be zero, and the
    // chart-specific `is not a function` check below is unaffected.
    if (/Failed to load resource/.test(text) && /401/.test(text)) return;
    errors.push(text);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function waitForChartReady(page: Page): Promise<void> {
  await expect(page.locator(CHART)).toHaveAttribute('data-chart-state', 'ready');
}

async function chartStatus(page: Page) {
  return page.locator(CHART).evaluate((el) => ({
    state: el.getAttribute('data-chart-state'),
    barCount: Number(el.getAttribute('data-bar-count')),
    engineBarCount: Number(el.getAttribute('data-engine-bar-count')),
    rejected: Number(el.getAttribute('data-rejected-count')),
    duplicates: Number(el.getAttribute('data-duplicate-count')),
    first: Number(el.getAttribute('data-first-timestamp')),
    last: Number(el.getAttribute('data-last-timestamp')),
    symbol: el.getAttribute('data-symbol'),
    period: el.getAttribute('data-period'),
  }));
}

/**
 * Count distinct colours drawn on the largest chart canvas. A canvas that only holds the panel
 * background (or nothing at all) yields very few distinct colours; real candles + axis + volume
 * bars yield many. Reads pixels from the live canvas — no snapshot baseline needed, so this is
 * stable across browsers and font stacks.
 */
async function canvasInk(page: Page): Promise<{ distinctColors: number; nonBackgroundRatio: number }> {
  return page.evaluate((sel) => {
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>(`${sel} canvas`)];
    if (canvases.length === 0) return { distinctColors: 0, nonBackgroundRatio: 0 };
    const canvas = canvases.reduce((a, b) => (a.width * a.height >= b.width * b.height ? a : b));
    const ctx = canvas.getContext('2d');
    if (!ctx) return { distinctColors: 0, nonBackgroundRatio: 0 };
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    const counts = new Map<string, number>();
    let sampled = 0;
    // Sample on a coarse grid: enough coverage to find candles, cheap enough for every browser.
    for (let y = 0; y < height; y += 3) {
      for (let x = 0; x < width; x += 3) {
        const i = (y * width + x) * 4;
        const key = `${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        sampled += 1;
      }
    }
    let dominant = 0;
    for (const c of counts.values()) dominant = Math.max(dominant, c);
    return {
      distinctColors: counts.size,
      nonBackgroundRatio: sampled === 0 ? 0 : (sampled - dominant) / sampled,
    };
  }, CHART);
}

test('chart loads real mock-replay candles and reports them', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  const candleResponses: number[] = [];
  page.on('response', (r) => {
    if (r.url().includes('/api/market/candles')) candleResponses.push(r.status());
  });

  await page.goto('/trade');
  await waitForChartReady(page);

  // The data request actually happened and succeeded.
  expect(candleResponses.length).toBeGreaterThan(0);
  expect(candleResponses.every((s) => s === 200)).toBe(true);

  const s = await chartStatus(page);
  expect(s.barCount).toBeGreaterThan(0);
  // The BFF is asked for 300 bars; anything in the tens+ proves a real history, not a single tick.
  expect(s.barCount).toBeGreaterThan(50);
  // The bars must be INSIDE the engine, not merely received by the adapter. This is the assertion
  // that fails if the chart façade accepts data and drops it (the Phase 6 silent no-op).
  expect(s.engineBarCount).toBeGreaterThan(50);
  expect(s.engineBarCount).toBe(s.barCount);
  expect(s.symbol).toBe('BTCUSDT');
  expect(s.period).toBe('15m');
  expect(Number.isFinite(s.first)).toBe(true);
  expect(Number.isFinite(s.last)).toBe(true);
  expect(s.first).toBeGreaterThan(0);
  expect(s.last).toBeGreaterThanOrEqual(s.first);
  // Feed sanity: timestamps are plausible epoch-millis, not seconds or indexes.
  expect(s.first).toBeGreaterThan(1_000_000_000_000);
  // No malformed or duplicate bars are expected from the deterministic mock feed.
  expect(s.rejected).toBe(0);
  expect(s.duplicates).toBe(0);

  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  // The exact symptom of the v9→v10 breaking change must never reappear.
  expect(errors.join(' ')).not.toContain('is not a function');
});

test('chart canvas contains actual rendered candles, not just a background', async ({ page }) => {
  await page.goto('/trade');
  await waitForChartReady(page);

  const canvas = page.locator(`${CHART} canvas`).first();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(200);
  expect(box!.height).toBeGreaterThan(100);

  const ink = await canvasInk(page);
  // A blank/background-only canvas has a handful of colours; a drawn chart has many.
  expect(ink.distinctColors).toBeGreaterThan(20);
  expect(ink.nonBackgroundRatio).toBeGreaterThan(0.02);
});

test('changing the symbol reloads the chart data', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/trade');
  await waitForChartReady(page);
  const before = await chartStatus(page);

  await page
    .locator('[data-widget-type="marketWatch"]')
    .first()
    .getByRole('button', { name: /ETH\/USDT/ })
    .click();

  await expect(page.locator(CHART)).toHaveAttribute('data-symbol', 'ETHUSDT');
  await waitForChartReady(page);
  const after = await chartStatus(page);
  expect(after.barCount).toBeGreaterThan(50);
  expect(after.engineBarCount).toBe(after.barCount);
  expect(after.symbol).toBe('ETHUSDT');
  expect(before.symbol).toBe('BTCUSDT');
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('changing the timeframe reloads the chart data', async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto('/trade');
  await waitForChartReady(page);
  const before = await chartStatus(page);

  await page.getByRole('button', { name: '1h', exact: true }).click();
  await expect(page.locator(CHART)).toHaveAttribute('data-period', '1h');
  await waitForChartReady(page);

  const after = await chartStatus(page);
  expect(after.barCount).toBeGreaterThan(50);
  expect(after.engineBarCount).toBe(after.barCount);
  expect(after.period).toBe('1h');
  // A 1h history spans more wall-clock time than a 15m history of comparable length.
  expect(after.last - after.first).toBeGreaterThan(before.last - before.first);
  expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
});

test('empty feed renders the chart empty state instead of a blank canvas', async ({ page }) => {
  // Intercept the candle feed and return a valid-but-empty payload.
  await page.route('**/api/market/candles**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ symbol: 'BTCUSDT', timeframe: '15m', candles: [], source: 'mock_replay' }),
    });
  });

  await page.goto('/trade');
  await expect(page.locator(CHART)).toHaveAttribute('data-chart-state', 'empty');
  await expect(page.locator(CHART)).toHaveAttribute('data-bar-count', '0');
  await expect(page.locator(CHART)).toHaveAttribute('data-engine-bar-count', '0');
  await expect(page.getByTestId('chart-state')).toBeVisible();
  await expect(page.getByTestId('chart-state')).toContainText('NO DATA');
});

test('failing feed renders the chart error state', async ({ page }) => {
  await page.route('**/api/market/candles**', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"upstream down"}' }),
  );

  await page.goto('/trade');
  await expect(page.locator(CHART)).toHaveAttribute('data-chart-state', 'error');
  await expect(page.getByTestId('chart-state')).toBeVisible();
  await expect(page.getByTestId('chart-state')).toContainText('불러오지 못했습니다');
});

test('impossible OHLC on the wire is rejected by the schema, surfacing the error state', async ({ page }) => {
  // Defence layer 1: `CandleSchema` refines OHLC sanity, so a payload containing an impossible
  // envelope fails validation as a whole and never reaches the chart adapter.
  await page.route('**/api/market/candles**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        symbol: 'BTCUSDT',
        timeframe: '15m',
        source: 'mock_replay',
        candles: [
          { time: 1_700_000_000_000, open: '100', high: '105', low: '95', close: '100', volume: '1.2', closed: true },
          // high below low — impossible envelope
          { time: 1_700_000_900_000, open: '100', high: '1', low: '999', close: '100', volume: '1.2', closed: true },
        ],
      }),
    });
  });

  await page.goto('/trade');
  await expect(page.locator(CHART)).toHaveAttribute('data-chart-state', 'error');
  await expect(page.locator(CHART)).toHaveAttribute('data-bar-count', '0');
  await expect(page.getByTestId('chart-state')).toBeVisible();
});

test('out-of-order and duplicate candles are sorted and de-duplicated before rendering', async ({ page }) => {
  // Defence layer 2: timestamp ordering/uniqueness is NOT part of the wire schema, so the adapter
  // must normalize it. Every bar below is individually schema-valid.
  const good = (time: number, close: number) => ({
    time,
    open: String(close),
    high: String(close + 5),
    low: String(close - 5),
    close: String(close),
    volume: '1.2',
    closed: true,
  });
  await page.route('**/api/market/candles**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        symbol: 'BTCUSDT',
        timeframe: '15m',
        source: 'mock_replay',
        candles: [
          good(1_700_001_800_000, 102),
          good(1_700_000_000_000, 100),
          // duplicate timestamp — later occurrence is the fresher snapshot and must win
          good(1_700_001_800_000, 103),
        ],
      }),
    });
  });

  await page.goto('/trade');
  await waitForChartReady(page);
  const s = await chartStatus(page);
  expect(s.barCount).toBe(2);
  expect(s.engineBarCount).toBe(2);
  expect(s.rejected).toBe(0);
  expect(s.duplicates).toBe(1);
  expect(s.first).toBe(1_700_000_000_000);
  expect(s.last).toBe(1_700_001_800_000);
});
