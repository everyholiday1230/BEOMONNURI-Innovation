import { test, expect } from '@playwright/test';

// Flow E: invalid AI output → client Zod rejection → contained error UI → chart stays functional.
// Deterministically forced by intercepting the SSE analyze stream and returning a malformed signal
// frame. The client re-validates every signal with Zod (defense in depth) and must reject it.
test('invalid AI output is rejected and the chart keeps working', async ({ page }) => {
  // Malformed SSE stream: a token then a signal that fails SignalObjectSchema.
  const badStream =
    'event: token\ndata: {"text":"분석 중…"}\n\n' +
    'event: signal\ndata: {"signal":{"totally":"invalid"}}\n\n';
  await page.route('**/api/ai/analyze', (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: badStream,
    }),
  );

  await page.goto('/trade/ai');
  const copilot = page.locator('[data-widget-type="aiCopilot"]').first();
  await copilot.locator('[data-testid="ai-composer"]').fill('추세 분석');
  await copilot.locator('[data-testid="ai-send"]').click();

  // Contained error alert appears; no signal card is rendered.
  await expect(copilot.getByRole('alert')).toBeVisible({ timeout: 15_000 });
  await expect(copilot.locator('.signal-card')).toHaveCount(0);

  // Chart widget stays mounted and functional (AI failure is isolated).
  await expect(page.locator('[data-testid="chart-mount"]').first()).toBeVisible();
});
