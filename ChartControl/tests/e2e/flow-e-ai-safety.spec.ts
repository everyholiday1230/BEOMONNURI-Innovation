/*
   ★★ 이 스펙은 **더 이상 유효하지 않다** (2026-09-08).

     대상 엔드포인트 `/api/ai/analyze` 가 제거됐다 — 인증된 고객 누구에게나 "항상 롱"
     대본 신호를 내보내던 경로였다(커밋 eb6b634).

   ★ 지우지 않고 남긴다. 조용히 삭제하면 다음 사람이 "AI 안전 검사 e2e 가 원래 없었나"
     로 오해한다. 대체 검증은 다음에 있다:
       · apps/api/src/__tests__/ai-unsafe-output.test.ts (거부된 출력 회수 + 위반 탐지)
       · packages/ai 의 safety/orchestrator 단위 테스트

   ★ 신호 기능이 "고객이 만들고 AI 가 검증" 으로 재설계되면(STABILIZATION-SIGNAL-
     REDESIGN.md) 그 흐름에 맞춰 새로 쓴다.
*/
import { test, expect } from '@playwright/test';

// Flow E: invalid AI output → client Zod rejection → contained error UI → chart stays functional.
// Deterministically forced by intercepting the SSE analyze stream and returning a malformed signal
// frame. The client re-validates every signal with Zod (defense in depth) and must reject it.
test.skip('invalid AI output is rejected and the chart keeps working', async ({ page }) => {
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

  await page.goto('/#/trade/ai');
  const copilot = page.locator('[data-widget-type="aiCopilot"]').first();
  await copilot.locator('[data-testid="ai-composer"]').fill('추세 분석');
  await copilot.locator('[data-testid="ai-send"]').click();

  // Contained error alert appears; no signal card is rendered.
  await expect(copilot.getByRole('alert')).toBeVisible({ timeout: 15_000 });
  await expect(copilot.locator('.signal-card')).toHaveCount(0);

  // Chart widget stays mounted and functional (AI failure is isolated).
  await expect(page.locator('[data-testid="chart-mount"]').first()).toBeVisible();
});
