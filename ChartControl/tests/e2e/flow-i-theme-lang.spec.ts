import { test, expect } from '@playwright/test';

// Closure §6.13/§6.14 + §6.2: theme switch, language switch, symbol + timeframe change.
test('theme + language switch and symbol/timeframe change', async ({ page }) => {
  await page.goto('/trade');
  const html = page.locator('html');

  // Theme toggle flips data-theme.
  const themeBefore = await html.getAttribute('data-theme');
  await page.getByRole('button', { name: 'toggle theme' }).click();
  await expect(html).not.toHaveAttribute('data-theme', themeBefore ?? 'dark');

  // Language toggle: nav label switches KO → EN (i18n), html lang updates.
  await expect(page.getByRole('link', { name: '트레이드' })).toBeVisible();
  await page.getByRole('button', { name: 'toggle language' }).click();
  await expect(page.getByRole('link', { name: 'Trade' })).toBeVisible();
  await expect(html).toHaveAttribute('lang', 'en');

  // Symbol change via Market Watch.
  await page.locator('[data-widget-type="marketWatch"]').first().getByRole('button', { name: /ETH\/USDT/ }).click();
  await expect(page.locator('.symbol-name')).toHaveText('ETH/USDT');

  // Timeframe change.
  await page.getByRole('button', { name: '1h', exact: true }).click();
  await expect(page.getByRole('button', { name: '1h', exact: true })).toHaveClass(/btn--primary/);
});
