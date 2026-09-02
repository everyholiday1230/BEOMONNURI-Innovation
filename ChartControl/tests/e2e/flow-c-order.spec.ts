import { test, expect, type Page } from '@playwright/test';

/*
   Flow C — 주문 제출 경로의 잠금.

   ★★ 원본 스펙이 검증하려던 것: **명시적 최종 확인 없이는 주문이 나갈 수 없다.**
     그 의도는 지킬 가치가 있다. 다만 원본은 존재하지 않는 UI 를 대상으로 했다
     (`data-testid="oe-submit"` 등 — 이 앱에 data-testid 는 0개다).

   ★★ 실제 경로를 측정해서 알게 된 것: **거래소 API 키가 없으면 주문이 시작조차
     되지 않는다.** 화면이 이렇게 말한다:

       "Connect your exchange account first — orders run on your own exchange,
        so we need your API keys before you can trade."

     이것은 결함이 아니라 이 제품의 구조다(비수탁 — 고객 자기 거래소 계정에서
     주문이 실행된다). 그래서 이 스펙은 **키 없는 계정이 주문을 낼 수 없다**는
     것을 첫 번째 잠금으로 검증한다. 그게 실제 첫 관문이다.

   ★ 키가 있는 상태의 확인 절차(최종 확인 체크박스 → 제출)는 이 환경에서 만들 수
     없다. 거래소 키를 심어야 하고, 그건 e2e 가 다룰 범위를 넘는다(실 거래소
     자격증명). 그 경로는 서버 단위 테스트가 덮는다:
       apps/api/src/__tests__/trading-routes.test.ts — 확인 토큰·멱등키·리스크 게이트
       packages/exchange-bitmart/src/__tests__/mode-neutral.test.ts — 실주문 게이트
     여기서 없는 것을 있는 척 테스트하지 않는다.
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
  const email = `order_${Date.now()}@example.com`;
  const password = 'e2e-order-pass-1';
  await page.goto('/#/signup');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm', { exact: true }).fill(password);
  for (const label of await page.locator('label.chk').all()) await label.click();
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/#\/trade/, { timeout: 20_000 });
  await dismissDisclaimer(page);
}

test('an account with no exchange key cannot place an order, and is told why', async ({ page }) => {
  await signInFresh(page);

  /*
     ★★ 주문 시도가 조용히 아무 일도 하지 않아서는 안 된다. 눌러도 아무 반응이
       없으면 고객은 "버튼이 고장났다" 고 생각하고 다시 누른다. 무엇이 필요한지
       말해야 한다.
  */
  const body = page.locator('body');
  await expect(body).toContainText(/Connect your exchange account first/i, { timeout: 20_000 });
  await expect(body).toContainText(/before you can trade/i);

  // 안내가 실제로 갈 곳을 준다 — 막다른 안내가 아니어야 한다.
  await expect(page.getByRole('link', { name: /connect a key/i }).first()).toBeVisible();
});

test('the buy control does not submit an order without a key', async ({ page }) => {
  await signInFresh(page);

  const submitted: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (r.method() !== 'POST') return;
    if (/\/api\/(trading\/orders|orders)(\/|$)/.test(u.pathname) && !/validate/.test(u.pathname)) {
      submitted.push(`${r.method()} ${u.pathname}`);
    }
  });

  const buy = page.getByRole('button', { name: /buy/i }).first();
  if (await buy.count() > 0) {
    await buy.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }

  /*
     ★★ 실제 주문 요청이 **한 건도** 나가지 않아야 한다. 화면 문구만 확인하면
       "안내는 뜨는데 주문은 나가는" 상태를 놓친다 — 그게 최악이다.
  */
  expect(submitted, `키 없이 주문이 전송됐다:\n${submitted.join('\n')}`).toEqual([]);
});

test('the order form still lets you set up an order before connecting', async ({ page }) => {
  await signInFresh(page);

  /*
     ★ 키가 없어도 주문 조건은 입력할 수 있어야 한다. 연결 전에 무엇을 할 수 있는지
       보이지 않으면 고객은 이 화면이 무엇인지 모른다. 입력칸이 접근성 이름으로
       찾히는지도 함께 확인한다(스크린리더 사용자가 쓸 수 있어야 한다).
  */
  for (const name of [/^Leverage/i, /^Price$/i, /^Size$/i]) {
    await expect(page.getByLabel(name).first()).toBeVisible({ timeout: 15_000 });
  }

  // 주문 유형 전환이 동작한다.
  const limit = page.getByRole('button', { name: /^Limit$/ }).first();
  if (await limit.count() > 0) {
    await limit.click({ timeout: 5000 });
    await expect(page.getByLabel(/^Price$/i).first()).toBeEnabled();
  }
});
