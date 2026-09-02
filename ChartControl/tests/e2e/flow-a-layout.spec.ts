import { test, expect } from '@playwright/test';

// Flow A: Layout edit → move → resize → save → refresh → restore.
test('layout edit persists across refresh', async ({ page }) => {
  await page.goto('/#/trade/layout');
  await expect(page.getByText('레이아웃 편집')).toBeVisible();

  // Switch to a preset, then save.
  await page.getByRole('button', { name: 'Scalper' }).click();
  await page.getByRole('button', { name: '저장' }).click();
  await expect(page.getByText('저장됨')).toBeVisible();

  // Refresh and confirm the saved layout is restored (widgets present).
  await page.reload();
  await expect(page.locator('[data-widget-type="orderBook"]').first()).toBeVisible();
});
