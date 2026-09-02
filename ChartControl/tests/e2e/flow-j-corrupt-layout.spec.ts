import { test, expect } from '@playwright/test';

// Closure §6.12: corrupted layout storage recovers safely (loadLayoutSafe → preset), no crash.
test('corrupted layout in localStorage recovers without crashing', async ({ page }) => {
  await page.goto('/#/trade');
  // Seed corrupted layout data, then reload.
  await page.evaluate(() => {
    localStorage.setItem('qt.layout.v1', '{ this is not valid json ]]');
  });
  await page.reload();

  // App shell + a chart widget still render (fallback/preset applied, no crash).
  await expect(page.locator('.symbol-name')).toBeVisible();
  await expect(page.locator('[data-widget-type="chart"]').first()).toBeVisible({ timeout: 10_000 });
});
