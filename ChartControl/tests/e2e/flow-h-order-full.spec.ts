import { test, expect, type Page } from '@playwright/test';

/*
   Flow H — 주문 전 위험 점검이 화면에 실제로 드러나는가.

   ★★ 원본 스펙은 AI 신호 승인 → 주문 초안 → 미리보기 → 리스크 통과 → 최종 확인 →
     모의 체결 → 포지션 반영까지를 한 번에 검증했다. 그 전 과정을 e2e 로 되살릴 수는
     없다:

       · `data-testid="oe-submit"` 등 이 앱에 **없는** 선택자를 쓴다(data-testid 0개)
       · 주문 제출에는 거래소 API 키가 필요하다(비수탁 — 고객 자기 계정에서 실행된다).
         e2e 에 실 거래소 자격증명을 심을 수는 없다.
       · AI 응답은 유료 호출이고 비결정적이라 검증에 부적합하다.

   ★★ 그래서 **키 없이도 확인할 수 있는 것**으로 좁힌다: 주문 검증 결과(리스크 게이트)가
     서버에서 계산되고 그 판단 근거가 응답에 드러나는가. 이것이 이 흐름의 핵심이다 —
     "왜 주문이 막혔는가" 를 고객과 운영자가 알 수 있어야 한다.

     실제로 이 프로젝트에서 게이트가 **막지도 못하면서 통과로 표시**된 적이 있다
     (일일 손실 한도는 하드코딩된 '0' 과 비교해 영원히 통과했고, 킬스위치 하나는
     아무도 검사하지 않았다). 그래서 "게이트가 응답에 있고 근거를 밝히는가" 를 본다.

   ★ 체결까지의 경로는 서버 테스트가 덮는다:
       apps/api/src/__tests__/trading-routes.test.ts   확인 토큰·멱등키·게이트 판정
       apps/api/src/__tests__/policy-unlimited.test.ts 상한 0 = 제한 없음
       apps/api/src/__tests__/oauth-scope.test.ts      키 발급 권한 범위
*/

async function dismissDisclaimer(page: Page) {
  for (let i = 0; i < 3; i += 1) {
    const primary = page.locator('[role=dialog] button.btn--primary');
    if (await primary.count() === 0) return;
    await primary.first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

async function signInFresh(page: Page) {
  const email = `risk_${Date.now()}@example.com`;
  const password = 'e2e-risk-pass-1';
  await page.goto('/#/signup');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm', { exact: true }).fill(password);
  for (const label of await page.locator('label.chk').all()) await label.click();
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/#\/trade/, { timeout: 20_000 });
  await dismissDisclaimer(page);
}

/** 로그인한 페이지에서 주문 검증을 호출한다(브라우저 세션·CSRF 를 그대로 쓴다). */
async function validateOrder(page: Page) {
  return page.evaluate(async () => {
    const csrf = await fetch('/api/auth/csrf').then((r) => r.json()).then((j) => j.csrfToken || '');
    const res = await fetch('/api/trading/orders/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({
        market: 'futures', symbol: 'BTCUSDT', side: 'long',
        orderType: 'limit', price: '60000', quantity: '0.01', leverage: 5,
      }),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  });
}

test('order validation returns the full gate list with its reasoning', async ({ page }) => {
  await signInFresh(page);
  const { status, body } = await validateOrder(page);
  expect(status).toBe(200);

  const gates = (body?.gates ?? []) as Array<{ id: string; status: string; detail: string }>;
  /*
     ★★ 게이트가 **여러 개** 와야 한다. 예전에는 제출 경로가 전체 목록을 돌려주지
       않아, 무엇을 근거로 통과/거부했는지 밖에서 알 수 없었다.
  */
  expect(gates.length).toBeGreaterThan(5);

  // 돈에 직접 영향을 주는 게이트가 목록에 있어야 한다.
  const ids = gates.map((g) => g.id);
  for (const required of [
    'policy.leverage', 'policy.notional', 'policy.dailyLoss', 'policy.openPositions',
    /*
       ★★ 잔고 게이트. 예전에는 목록에 **아예 없었다** — "이 주문을 낼 돈이
         있는가" 라는 가장 기본적인 질문이 빠져 있었고, 그래서 고객이 거래소까지
         갔다 와서 'Balance insufficient!' 를 받았다(실서비스 09-01 14:54).
    */
    'funds.available',
  ]) {
    expect(ids, `${required} 게이트가 응답에 없다`).toContain(required);
  }

  /*
     ★★ 키가 없는 계정은 잔고를 읽을 수 없다. 그때 'ok' 나 'fail' 이 아니라
       **'warn'(모른다)** 이어야 한다. 모르는 것을 ok 로 적으면 검사한 것처럼
       보이고, fail 로 적으면 우리가 고객 돈을 막는다.
  */
  const fundsGate = gates.find((g) => g.id === 'funds.available')!;
  expect(fundsGate.status).toBe('warn');
  expect(fundsGate.detail).toMatch(/exchange will decide|not checked/i);

  /*
     ★★ 모든 게이트가 **판단 근거(detail)** 를 갖는다. 근거 없는 'ok' 는
       "통과했다고 말하지만 무엇을 봤는지 모르는" 상태다 — 이 프로젝트에서
       실제로 그 상태가 사고를 만들었다.
  */
  for (const g of gates) {
    expect(String(g.detail || '').trim(), `${g.id} 에 근거가 없다`).not.toBe('');
  }
});

test('an account with no key is refused, and the reasons say which requirement failed', async ({ page }) => {
  await signInFresh(page);
  const { body } = await validateOrder(page);

  const live = body?.liveGate as { allowed: boolean; reasons?: string[] } | undefined;
  expect(live).toBeTruthy();

  // 키가 없으므로 실주문은 허용되지 않는다.
  expect(live!.allowed).toBe(false);

  /*
     ★★ 거부 사유가 **무엇이 빠졌는지** 말해야 한다. "주문할 수 없습니다" 만으로는
       고객이 다음에 무엇을 할지 알 수 없다.
  */
  const reasons = (live!.reasons ?? []).join(' | ');
  expect(reasons).toMatch(/credential/i);
});

test('unmeasurable risk inputs are reported, never silently treated as safe', async ({ page }) => {
  await signInFresh(page);
  const { body } = await validateOrder(page);

  /*
     ★★ 측정하지 못한 입력은 unknownInputs 로 드러나야 한다.

       이 프로젝트에서 dailyLossSoFar 가 하드코딩된 '0' 이었고, 한도를 걸어도
       `0 <= 한도` 가 항상 참이라 게이트가 영원히 통과했다. 운영자는 보호받는다고
       믿었다. 측정 불가를 조용히 '안전' 으로 취급하면 그런 상태가 다시 생긴다.

     ★ 이 검사는 목록이 **비어 있어도** 통과한다(전부 측정됐다는 뜻이므로 좋다).
       요구하는 것은 "그 필드가 응답에 존재한다" = 모른다는 사실을 숨기지 않는다.
  */
  expect(body).toHaveProperty('unknownInputs');
  expect(Array.isArray(body.unknownInputs)).toBe(true);
});
