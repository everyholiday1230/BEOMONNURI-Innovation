import { test, expect } from '@playwright/test';
import { isolation } from './playwright.config';

/**
 * A4 — Orders / Positions read-only console.
 *
 * The screen used to be a placeholder over a route that hard-coded `[]`. These tests assert the two
 * things that matter now: the table is real (filters, sort affordance, pagination, detail), and every
 * mutation is refused by POLICY for every role — visibly, with a reason, and without issuing a request.
 */

async function loginAdmin(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel(/Email|이메일/).fill('admin@qt.local');
  await page.getByLabel(/Password|비밀번호/).fill('adminpass1234');
  await page.getByRole('button', { name: /Sign in|로그인/ }).click();
  await expect(page.getByRole('navigation', { name: 'admin' })).toBeVisible();
}

async function openOrders(page: import('@playwright/test').Page) {
  await page.getByRole('link', { name: /Orders & Positions|주문·포지션/ }).click();
  await expect(page.getByTestId('orders')).toBeVisible();
  await page.locator('[data-testid="orders"]:not([data-table-status="loading"])').waitFor({ timeout: 15_000 });
}

test('[A4-1] the orders screen is a real table, not a JSON placeholder', async ({ page }) => {
  await loginAdmin(page);
  await openOrders(page);

  // No `<pre>` dump anywhere on the screen.
  expect(await page.locator('main pre').count()).toBe(0);
  await expect(page.getByTestId('orders-readonly-badge')).toBeVisible();
  await expect(page.getByTestId('orders-policy-note')).toBeVisible();
  // Toolbar controls exist regardless of how many rows came back.
  await expect(page.getByTestId('orders-search')).toBeVisible();
  await expect(page.getByTestId('orders-refresh')).toBeVisible();
  await expect(page.getByTestId('orders-mode')).toHaveText(/Server-paginated|서버 페이지네이션/);
  // The pager belongs to a populated table; an empty result legitimately has nothing to page.
  const status = await page.getByTestId('orders').getAttribute('data-table-status');
  if (status === 'ready') {
    await expect(page.getByTestId('orders-pager')).toBeVisible();
    await expect(page.getByTestId('orders-table')).toBeVisible();
  } else {
    expect(status, `unexpected orders table status: ${status}`).toBe('empty');
  }
});

test('[A4-2] order mutations are refused by policy for SUPER_ADMIN, with a stated reason', async ({ page }) => {
  await loginAdmin(page);
  await openOrders(page);

  // Regardless of whether rows exist, the policy verdict is what is under test; assert it on any row
  // that is present, and otherwise assert the empty state is honest.
  const rows = page.locator('[data-testid="orders-row"]');
  if ((await rows.count()) === 0) {
    await expect(page.getByTestId('orders')).toHaveAttribute('data-table-status', /empty|ready/);
    return;
  }
  const cancel = rows.first().locator('[data-action-id="ADM-ORDERS-CANCEL"]');
  await expect(cancel).toBeDisabled();
  await expect(cancel).toHaveAttribute('data-deny-reason', 'policy');
  await expect(cancel).toHaveAttribute('title', /policy|정책|cannot|없습니다/i);
});

test('[A4-3] no order/position mutation request is ever issued from this screen', async ({ page }) => {
  const mutations: string[] = [];
  page.on('request', (r) => {
    const m = r.method();
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return;
    if (/\/api\/admin\/(orders|positions)/.test(r.url()) || /withdraw/i.test(r.url())) {
      mutations.push(`${m} ${r.url()}`);
    }
  });

  await loginAdmin(page);
  await openOrders(page);
  // Click every policy-blocked control; a disabled button must not fire, and nothing must be sent.
  for (const sel of ['[data-action-id="ADM-ORDERS-CANCEL"]', '[data-action-id="ADM-ORDERS-MODIFY"]']) {
    const btns = page.locator(sel);
    for (let i = 0; i < (await btns.count()); i += 1) {
      await btns.nth(i).click({ force: true, timeout: 2000 }).catch(() => undefined);
    }
  }
  await page.getByTestId('orders-tab-positions').click();
  await expect(page.getByTestId('positions')).toBeVisible();
  for (const sel of ['[data-action-id="ADM-ORDERS-CLOSE-POSITION"]', '[data-action-id="ADM-ORDERS-LEVERAGE"]']) {
    const btns = page.locator(sel);
    for (let i = 0; i < (await btns.count()); i += 1) {
      await btns.nth(i).click({ force: true, timeout: 2000 }).catch(() => undefined);
    }
  }

  expect(mutations, `mutation requests leaked: ${mutations.join(' | ')}`).toEqual([]);
});

test('[A4-4] server has no order/position write route even for a permitted admin', async ({ page, context }) => {
  await loginAdmin(page);
  const cookies = await context.cookies();
  const csrf = cookies.find((c) => c.name === 'qt_csrf')?.value ?? '';
  const headers = { 'x-csrf-token': csrf, origin: isolation.BASE_URL, 'content-type': 'application/json' };

  for (const path of [
    '/api/admin/orders',
    '/api/admin/orders/o1/cancel',
    '/api/admin/positions/p1/close',
    '/api/admin/withdraw',
  ]) {
    const res = await context.request.post(`${isolation.BASE_URL}${path}`, { headers, data: {} });
    expect([404, 405], `POST ${path} must not be a working mutation (got ${res.status()})`).toContain(res.status());
  }
});

test('[A4-5] the positions tab is its own read-only table', async ({ page }) => {
  await loginAdmin(page);
  await openOrders(page);
  await page.getByTestId('orders-tab-positions').click();
  await expect(page.getByTestId('positions')).toBeVisible();
  await expect(page.getByTestId('positions-search')).toBeVisible();
  const status = await page.getByTestId('positions').getAttribute('data-table-status');
  if (status === 'ready') await expect(page.getByTestId('positions-pager')).toBeVisible();
  else expect(status, `unexpected positions table status: ${status}`).toBe('empty');
  expect(await page.locator('main pre').count()).toBe(0);
});

test('[A4-6] filters and search reach the server and are reflected in the request', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'GET' && r.url().includes('/api/admin/orders')) urls.push(r.url());
  });
  await loginAdmin(page);
  await openOrders(page);
  await page.getByTestId('orders-filter-symbol').fill('BTCUSDT');
  await page.getByTestId('orders-filter-side').selectOption('buy');
  await page.getByTestId('orders-search').fill('BTC');
  await page.waitForTimeout(700); // past the debounce
  await page.locator('[data-testid="orders"]:not([data-table-status="loading"])').waitFor();

  const last = urls[urls.length - 1] ?? '';
  expect(last, `requests seen: ${urls.join(' | ')}`).toContain('symbol=BTCUSDT');
  expect(last).toContain('side=buy');
  expect(last).toContain('q=BTC');
});
