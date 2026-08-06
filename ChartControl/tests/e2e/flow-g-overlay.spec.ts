import { test, expect } from '@playwright/test';

// Closure §2A/2B: AI overlays render in the Signal Layers panel and support real interactions;
// editing an overlay price marks it user-edited (synced into the Signal Card panel).
test('AI overlays: create, edit (user-edited), lock, hide, delete', async ({ page }) => {
  await page.goto('/trade/ai');
  const copilot = page.locator('[data-widget-type="aiCopilot"]').first();
  await copilot.locator('[data-testid="ai-composer"]').fill('추세 분석');
  await copilot.locator('[data-testid="ai-send"]').click();

  const panel = copilot.locator('[data-testid="overlay-panel"]');
  await expect(panel).toBeVisible({ timeout: 15_000 });
  // Entry zone, SL, TPs, invalidation, marker => several overlay rows.
  const rows = panel.locator('[data-testid^="overlay-"]');
  expect(await rows.count()).toBeGreaterThanOrEqual(5);

  // Edit the stop-loss price → user-edited badge appears (synced to signal card panel).
  const sl = panel.locator('[data-testid="overlay-ov-sl"]');
  await sl.getByLabel('price ov-sl').fill('67123.4');
  await sl.getByLabel('price ov-sl').blur();
  await expect(sl).toHaveAttribute('data-edited', 'true');
  await expect(panel.locator('[data-testid="layers-edited"]')).toBeVisible();

  // Lock TP1 → locked; hide it; delete the marker.
  await panel.locator('[data-testid="lock-ov-tp1"]').click();
  await expect(panel.locator('[data-testid="overlay-ov-tp1"]')).toHaveAttribute('data-locked', 'true');
  await panel.locator('[data-testid="hide-ov-tp1"]').click();
  await expect(panel.locator('[data-testid="overlay-ov-tp1"]')).toHaveAttribute('data-hidden', 'true');
  const before = await rows.count();
  await panel.locator('[data-testid="del-ov-marker"]').click();
  expect(await rows.count()).toBe(before - 1);
});
