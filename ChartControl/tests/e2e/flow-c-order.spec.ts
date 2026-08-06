import { test, expect } from '@playwright/test';

// Flow C: approve signal → order draft → preview/risk → FINAL confirmation → simulated submit.
// Critically asserts that submit is impossible before the explicit confirmation checkbox.
test('order requires explicit final confirmation before simulated submit', async ({ page }) => {
  await page.goto('/trade/ai');
  const copilot = page.locator('[data-widget-type="aiCopilot"]').first();
  await copilot.locator('[data-testid="ai-composer"]').fill('추세 분석');
  await copilot.locator('[data-testid="ai-send"]').click();
  await expect(copilot.locator('[data-testid="signal-card"]')).toBeVisible({ timeout: 15_000 });

  await copilot.locator('[data-testid="ai-approve"]').click();
  await copilot.locator('[data-testid="ai-create-draft"]').click();
  await page.locator('[data-testid="oe-preview"]').click();

  // Submit button disabled until the final-confirmation checkbox is ticked.
  const submit = page.locator('[data-testid="oe-submit"]');
  await expect(submit).toBeDisabled();
  await page.locator('[data-testid="oe-final-confirm"]').check();
  await expect(submit).toBeEnabled();
  await submit.click();

  // Result strong is the only node containing "simulated=true" → unambiguous, simulated fill.
  await expect(page.locator('[data-testid="order-success"]')).toBeVisible();
});
