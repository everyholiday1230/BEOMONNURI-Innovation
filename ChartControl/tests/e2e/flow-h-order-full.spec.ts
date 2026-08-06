import { test, expect } from '@playwright/test';

// Closure §2C/§3: approve → create draft → preview → Risk Check (ALL CLEAR) → final confirm →
// simulated submit → success toast → mock position reflected in the Positions widget.
test('signal→order: risk clear, submit, toast, position reflected', async ({ page }) => {
  await page.goto('/trade/ai');
  const copilot = page.locator('[data-widget-type="aiCopilot"]').first();
  await copilot.locator('[data-testid="ai-composer"]').fill('추세 분석');
  await copilot.locator('[data-testid="ai-send"]').click();
  await expect(copilot.locator('[data-testid="signal-card"]')).toBeVisible({ timeout: 15_000 });

  await copilot.locator('[data-testid="ai-approve"]').click();
  await copilot.locator('[data-testid="ai-create-draft"]').click();
  await page.locator('[data-testid="oe-preview"]').click();

  // Risk checklist present; no FAIL gates for the valid mock signal (submission allowed).
  const risk = page.locator('[data-testid="risk-checklist"]');
  await expect(risk).toBeVisible();
  await expect(risk).toHaveAttribute('data-risk-pass', 'true');

  const submit = page.locator('[data-testid="oe-submit"]');
  await expect(submit).toBeDisabled();
  await page.locator('[data-testid="oe-final-confirm"]').check();
  await expect(submit).toBeEnabled();
  await submit.click();

  // Success toast + simulated fill result.
  await expect(page.locator('[data-testid="toast"][data-kind="success"]')).toBeVisible();
  await expect(page.locator('[data-testid="order-success"]')).toBeVisible();

  // Positions widget reflects the simulated order.
  // Selector migration (Prompt 3 / U4): the Phase-1 positions widget rendered flat `sim-position`
  // rows; it is now the full positions TABLE (`positions-table` / `position-row`) required by the
  // mock. The assertion is unchanged in strength — the simulated fill must surface as a position row.
  const positions = page.locator('[data-testid="positions-table"]');
  await expect(positions).toBeVisible({ timeout: 8000 });
  await expect(page.locator('[data-testid="position-row"]').first()).toBeVisible({ timeout: 8000 });
});
