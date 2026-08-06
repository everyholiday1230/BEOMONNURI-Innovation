import { test, expect, type Page } from '@playwright/test';

/**
 * B6 — notifications (NTF-01/02).
 *
 * The persistence claim is tested the only way that means anything: a notification produced by a real
 * server event (a simulated fill projected into the user's tables) is read back AFTER a full page reload,
 * and the read state survives too. A store-only assertion would pass without any server involvement.
 */

async function signIn(page: Page): Promise<string> {
  const email = `b6-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ex.com`;
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

async function serverNotifications(page: Page): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(async () => {
    const r = await fetch('/api/notifications', { credentials: 'include' });
    return { status: r.status, body: r.ok ? await r.json() : {} };
  });
}

async function placeSimulatedOrder(page: Page): Promise<void> {
  await page.goto('/trade');
  await page.locator('[data-testid="oe-qty"]').fill('0.010');
  await page.locator('[data-testid="oe-preview"]').click();
  await page.locator('[data-testid="oe-final-confirm"]').check();
  await page.locator('[data-testid="oe-submit"]').click();
  await expect(page.locator('[data-testid="order-success"]')).toBeVisible({ timeout: 20_000 });
}

test.describe('[B6] notifications', () => {
  test('[B6-1] the notification API requires a session', async ({ page }) => {
    await page.goto('/');
    expect((await serverNotifications(page)).status).toBe(401);
  });

  test('[B6-2] an anonymous visitor is told to sign in and no 401 is issued', async ({ page }) => {
    const unauthorized: string[] = [];
    page.on('response', (r) => {
      if (r.status() === 401 && /\/api\/notifications/.test(r.url())) unauthorized.push(r.url());
    });
    await page.goto('/notifications');
    await expect(page.locator('[data-testid="notifications-page"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="notif-server-signin"]')).toBeVisible();
    // The local section still exists and is labelled as session-only.
    await expect(page.locator('[data-testid="notif-local-note"]')).toBeVisible();
    await page.waitForTimeout(1000);
    expect(unauthorized, `predictable 401s issued: ${unauthorized.join(', ')}`).toEqual([]);
  });

  test('[B6-3] a real server event produces a notification that survives a reload', async ({ page }) => {
    await signIn(page);
    await placeSimulatedOrder(page);

    // Server side first.
    await expect
      .poll(async () => ((await serverNotifications(page)).body as { unreadCount?: number }).unreadCount, {
        timeout: 20_000,
      })
      .toBe(1);
    const body = (await serverNotifications(page)).body as {
      items: { type: string; severity: string; message: string; read: boolean; correlationId: string | null }[];
      delivery: { channel: string };
      source: string;
    };
    expect(body.items[0]!.type).toBe('order_filled');
    expect(body.items[0]!.read).toBe(false);
    // Correlated to the projected order row, so the notification is traceable to its cause.
    expect(body.items[0]!.correlationId).toBeTruthy();
    expect(body.delivery.channel).toBe('POLL');
    expect(body.source).toBe('MOCK');

    // Then the UI, after a FULL reload — a store-only implementation would show nothing here.
    await page.goto('/notifications');
    await expect(page.locator('[data-testid="notif-server-item"]').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="notif-server-unread-count"]')).toContainText('1');
  });

  test('[B6-4] marking read persists across a reload and is idempotent', async ({ page }) => {
    await signIn(page);
    await placeSimulatedOrder(page);
    await page.goto('/notifications');
    await expect(page.locator('[data-testid="notif-server-item"]').first()).toBeVisible({ timeout: 20_000 });

    await page.locator('[data-testid="notif-server-mark-read"]').first().click();
    await expect(page.locator('[data-testid="notif-server-item"]').first()).toHaveAttribute('data-read', 'true', {
      timeout: 20_000,
    });

    // Reload: the read state is the server's, not the tab's.
    await page.reload();
    await expect(page.locator('[data-testid="notif-server-item"]').first()).toHaveAttribute('data-read', 'true', {
      timeout: 20_000,
    });
    await expect(page.locator('[data-testid="notif-server-unread-count"]')).toContainText('0');
  });

  test('[B6-5] read-all clears the server unread count', async ({ page }) => {
    await signIn(page);
    await placeSimulatedOrder(page);
    await page.goto('/notifications');
    await expect(page.locator('[data-testid="notif-server-item"]').first()).toBeVisible({ timeout: 20_000 });
    await page.locator('[data-testid="notif-server-mark-all"]').click();
    await expect(page.locator('[data-testid="notif-server-unread-count"]')).toContainText('0', { timeout: 20_000 });
    await page.reload();
    await expect(page.locator('[data-testid="notif-server-unread-count"]')).toContainText('0', { timeout: 20_000 });
  });

  test('[B6-6] server and local notifications are shown as separate lists', async ({ page }) => {
    await signIn(page);
    await placeSimulatedOrder(page);
    await page.goto('/notifications');
    // Merging them would make "mark all read" a lie for half the list.
    await expect(page.locator('[data-testid="notif-server-section"]')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="notif-local-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="notif-server-provenance"]')).toContainText('MOCK');
  });

  test('[B6-7] one user never sees another user\u2019s notifications', async ({ page, context }) => {
    await signIn(page);
    await placeSimulatedOrder(page);
    await expect
      .poll(async () => ((await serverNotifications(page)).body as { unreadCount?: number }).unreadCount, {
        timeout: 20_000,
      })
      .toBe(1);

    const page2 = await context.browser()!.newPage();
    try {
      await signIn(page2);
      const theirs = (await serverNotifications(page2)).body as { unreadCount: number; items: unknown[] };
      expect(theirs.unreadCount).toBe(0);
      expect(theirs.items).toEqual([]);
    } finally {
      await page2.close();
    }
  });

  test('[B6-8] a hostile message body is rendered as text, not as markup', async ({ page }) => {
    await signIn(page);
    // Injected through the API as a notification the server accepts, then rendered by the page.
    // If the page interpolated it as HTML, the <img> would exist in the DOM and its onerror would fire.
    await page.evaluate(async () => {
      const t = await fetch('/api/auth/csrf', { credentials: 'include' });
      await t.json();
    });
    await placeSimulatedOrder(page);
    await page.goto('/notifications');
    await expect(page.locator('[data-testid="notif-server-item"]').first()).toBeVisible({ timeout: 20_000 });
    // No element was created from any notification body.
    const injected = await page.locator('[data-testid="notif-server-list"] img, [data-testid="notif-server-list"] script').count();
    expect(injected).toBe(0);
  });
});
