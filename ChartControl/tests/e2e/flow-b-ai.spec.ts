import { test, expect } from '@playwright/test';

// Flow B: AI prompt → streaming → chart overlay commands → signal proposal.
test('AI copilot streams a validated signal', async ({ page }) => {
  await page.goto('/trade/ai');
  const copilot = page.locator('[data-widget-type="aiCopilot"]').first();
  await expect(copilot).toBeVisible();

  await copilot.locator('[data-testid="ai-composer"]').fill('추세 분석');
  await copilot.locator('[data-testid="ai-send"]').click();

  // streamed narrative + allowlisted commands + a signal card appear
  await expect(copilot.locator('[data-testid="ai-commands"]')).toBeVisible({ timeout: 15_000 });
  await expect(copilot.locator('[data-testid="signal-card"]')).toBeVisible();
  await expect(copilot.locator('[data-testid="conf-ring"]')).toBeVisible();

  // Design contract C6: the invalidation banner is always present in the signal card.
  await expect(copilot.locator('.invalidation-banner')).toBeVisible();
});
