import { test, expect } from '@playwright/test';

// Phase 2: full auth round-trip through the real BFF (SQLite :memory:, insecure cookies for http).
// Login is OPTIONAL — /trade stays public — so this is additive to the Phase 1 e2e suite.
test('register → login → session → logout', async ({ page }) => {
  const email = `e2e_${Date.now()}@ex.com`;
  const password = 'e2e-password-123';

  await page.goto('/#/signup');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm', { exact: true }).fill(password);
  await page.locator('.card button.btn--primary').click();
  await expect(page.getByTestId('signup-ok')).toBeVisible();

  await page.goto('/#/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.locator('.card button.btn--primary').click();

  const loggedIn = page.getByTestId('auth-logged-in');
  await expect(loggedIn).toBeVisible();
  await expect(loggedIn).toContainText(email);

  await page.locator('[data-testid="auth-logged-in"] button.btn').click();
  await expect(page.locator('.card button.btn--primary')).toBeVisible();
});
