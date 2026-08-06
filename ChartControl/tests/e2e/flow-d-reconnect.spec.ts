import { test, expect } from '@playwright/test';

// Flow D: market-data/BFF disconnect → error/stale status → reconnect → live.
// Forces the failure by aborting the /api/config request via route interception, then restores it.
test('connection indicator reflects disconnect → reconnect', async ({ page }) => {
  await page.goto('/status');
  await expect(page.getByText('BFF connection')).toBeVisible();

  // Force disconnect: abort the config request, reload → the status card shows the safe error state.
  await page.route('**/api/config', (route) => route.abort());
  await page.reload();
  await expect(
    page.getByText(/연결할 수 없습니다|RECONNECTING|OFFLINE|STALE/),
  ).toBeVisible({ timeout: 10_000 });

  // Restore upstream and reload → connection returns to LIVE (scoped to the status card row).
  await page.unroute('**/api/config');
  await page.reload();
  const statusCard = page.locator('.card').filter({ hasText: 'BFF connection' });
  await expect(statusCard.getByText('LIVE', { exact: true })).toBeVisible({ timeout: 10_000 });
});
