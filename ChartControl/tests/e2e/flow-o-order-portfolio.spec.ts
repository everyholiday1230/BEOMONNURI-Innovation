import { test, expect, type Page } from '@playwright/test';

/*
   Flow O — 주문 입력·포지션·자산 화면.

   ★★ 원본 스펙(441줄·32개)은 존재하지 않는 UI 를 대상으로 했다.

     `[data-testid="oe-preview"]`·`oe-submit`·`oe-qty`·`oe-available-unavailable`
     같은 선택자를 144번 썼는데, 이 앱에는 **data-testid 가 0개**다. 실행하면
     32개 전부 30초 타임아웃으로 실패한다. 즉 이 파일은 오래 아무것도 지키지
     않고 있었다.

     원본이 전제한 화면도 실제와 다르다. 별도의 '미리보기 → 서버 검증 패널 →
     최종 확인 체크박스 → 제출' 단계가 없고, 주문 확인은 모달이다. 화면은
     `/api/orders/validate` 를 부르지 않는다(부르는 곳이 src 에 없다).

   ★★ 그래서 **지킬 가치가 있는 의도만** 남기고 실제 화면으로 옮긴다.

     원본에서 살린 것:
       · 잘못된 수량·가격은 제출 전에 막고 이유를 말한다
       · 잔고를 모를 때 0 으로 꾸미지 않는다
       · 킬스위치는 숨겨지지 않는다
       · 주문 입력이 실거래 경로를 건드리지 않는다
       · 목록은 행이 없을 때 이유를 말한다(빈 표는 고장으로 읽힌다)
       · 할 수 없는 동작은 비활성 + 이유

     원본에서 뺀 것과 이유:
       · AI 관련 6개 — AI 응답은 유료이고 비결정적이다. 서버 테스트가 덮는다.
       · '최종 확인 체크박스 → 모의 체결' 계열 — 그 UI 가 없다. 실주문에는
         거래소 키가 필요해 e2e 로 만들 수 없다(apps/api 의 trading-routes
         테스트가 확인 토큰·멱등키·게이트를 덮는다).
       · '모의 주문이 포지션·이력에 나타난다' — 모의 체결 경로가 없다.

     없는 UI 를 있는 것처럼 테스트하지 않는다. 그게 이 파일이 오래 거짓으로
     통과하지도, 실패하지도 않은 채 방치된 이유였다.
*/

async function dismissDisclaimer(page: Page) {
  for (let i = 0; i < 3; i += 1) {
    const primary = page.locator('[role=dialog] button.btn--primary');
    if (await primary.count() === 0) return;
    await primary.first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

/*
   ★ 주문 폼은 로그인 상태에서만 쓸 수 있다. 로그아웃 상태로 열면 입력칸을
     채울 수 없다(실측으로 확인했다 — fill 이 타임아웃된다).
*/
async function signInFresh(page: Page): Promise<string> {
  const email = `u3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'e2e-order-form-pass-1';
  await page.goto('/#/signup');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm', { exact: true }).fill(password);
  for (const label of await page.locator('label.chk').all()) await label.click();
  await page.getByRole('button', { name: /create account/i }).click();
  await expect(page).toHaveURL(/#\/trade/, { timeout: 20_000 });
  await dismissDisclaimer(page);
  return email;
}

/** 주문 폼의 경고 목록. 화면이 실제로 쓰는 컨테이너다. */
const warnings = (page: Page) => page.locator('.oe-warn');
const warningTexts = async (page: Page) =>
  (await warnings(page).allTextContents()).map((t) => t.replace(/\s+/g, ' ').trim());

test.describe('[U3] 주문 입력', () => {
  test('[U3-1] 주문 조건 입력칸이 접근성 이름으로 찾힌다', async ({ page }) => {
    await signInFresh(page);
    /*
       ★★ 역할·라벨로 찾는다. 클래스로 찾으면 마크업이 바뀔 때 조용히 다른 것을
         집고, 무엇보다 **스크린리더 사용자가 쓸 수 없는 폼을 통과시킨다.**
    */
    for (const name of [/^Leverage/i, /^Price$/i, /^Size$/i]) {
      await expect(page.getByLabel(name).first()).toBeVisible({ timeout: 15_000 });
    }
    // 주문 유형과 방향은 실제 버튼이어야 한다.
    for (const label of [/^Limit$/, /^Market$/]) {
      await expect(page.getByRole('button', { name: label }).first()).toBeVisible();
    }
    await expect(page.getByRole('button', { name: /Buy/i }).first()).toBeVisible();
  });

  test('[U3-4] 최소수량 미달은 제출 전에 막고 숫자를 말한다', async ({ page }) => {
    await signInFresh(page);
    const size = page.getByLabel(/^Size$/i).first();
    await size.fill('0.0001'); // BTCUSDT 최소 0.001, 단위 0.001
    await page.waitForTimeout(1200);

    const texts = await warningTexts(page);
    /*
       ★★ 이 검사가 지키는 실서비스 사고: 08-30 09:44, 고객이 XRPUSDT 에 0.1
         (최소 10), DOGEUSDT 에 0.1(최소 100)을 넣어 주문이 차단됐다. 폼은 그
         최소값을 **받고 있었는데도** 아무 경고를 못 했다 — live-market 이
         stepSize·minQty 를 market 객체에 복사하지 않아서였다.

       ★ 숫자를 말해야 한다. "잘못된 수량" 만으로는 얼마를 넣어야 할지 모른다.
    */
    const hit = texts.find((t) => /steps of|Minimum order size/i.test(t));
    expect(hit, `수량 경고가 없다. 표시된 경고:\n${texts.join('\n')}`).toBeTruthy();
    expect(hit).toMatch(/0\.001/);
  });

  test('[U3-4b] 유효한 수량에서는 그 경고가 사라진다', async ({ page }) => {
    await signInFresh(page);
    const size = page.getByLabel(/^Size$/i).first();
    await size.fill('0.0001');
    await page.waitForTimeout(1000);
    expect((await warningTexts(page)).some((t) => /steps of|Minimum order size/i.test(t))).toBe(true);

    await size.fill('0.05');
    await page.waitForTimeout(1000);
    /*
       ★ 경고가 남아 있으면 고객은 고쳤는데도 막힌 줄 안다. 사라지는 것까지가
         한 쌍이다 — 켜지는 것만 확인하면 "항상 켜져 있는" 경고를 놓친다.
    */
    expect((await warningTexts(page)).some((t) => /steps of|Minimum order size/i.test(t))).toBe(false);
  });

  test('[U3-6] 키가 없으면 잔고를 0 으로 꾸미지 않고 연결하라고 말한다', async ({ page }) => {
    await signInFresh(page);
    /*
       ★★ 원본 의도를 그대로 지킨다: 잔고를 모를 때 0 을 보여주면 고객은 돈이
         없다고 읽는다. 조회 실패·미연결·실제 0 은 서로 다른 사실이다.

       ★ 이 앱은 미연결을 명시적으로 말한다(그 문구를 이번에 확인했다).
    */
    await expect(page.locator('body')).toContainText(/Connect your exchange account first/i, { timeout: 20_000 });
    await expect(page.getByRole('link', { name: /connect a key/i }).first()).toBeVisible();
  });

  test('[U3-14] 주문 입력 화면이 실거래 경로를 건드리지 않는다', async ({ page }) => {
    const forbidden: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      /*
         ★★ 화면을 열고 값을 넣는 것만으로 실주문 경로가 호출되면, 고객은
           "아직 안 눌렀다" 고 믿는 사이에 돈이 움직인다.
      */
      if (/\/api\/trading\/orders(\/|$)/.test(u.pathname) && !/validate/.test(u.pathname)) {
        forbidden.push(`${r.method()} ${u.pathname}`);
      }
      if (/bitmart|api\.openai/i.test(u.hostname)) forbidden.push(u.hostname);
    });

    await signInFresh(page);
    await page.getByLabel(/^Size$/i).first().fill('0.05');
    await page.getByLabel(/^Price$/i).first().fill('60000');
    await page.waitForTimeout(2000);

    expect(forbidden, `실거래 경로가 호출됐다:\n${forbidden.join('\n')}`).toEqual([]);
  });

  test('[U3-7b] 킬스위치 상태는 서버가 밝히고 숨기지 않는다', async ({ page }) => {
    await signInFresh(page);
    /*
       ★★ 원본 의도: 켜진 킬스위치가 화면에서 숨겨지면, 운영자는 거래를 멈췄다고
         믿고 고객은 왜 막혔는지 모른다.

       ★ 실제로 이 프로젝트에 그 사고가 있었다 — 'bitmart_live_trading' 스코프는
         시드만 되고 **아무도 검사하지 않아서**, 관리자 화면에서 켤 수 있는데도
         주문이 그대로 나갔다.

       ★ 화면 배지는 배포마다 다를 수 있으므로, 상태를 **응답이 말하는지**로
         확인한다. 그게 화면이 읽는 원본이다.
    */
    const r = await page.evaluate(async () => {
      const csrf = await fetch('/api/auth/csrf').then((x) => x.json()).then((j) => j.csrfToken || '');
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
    expect(r.status).toBe(200);
    const gate = r.body?.liveGate as { allowed?: boolean; reasons?: string[] } | undefined;
    expect(gate, '실거래 게이트 상태가 응답에 없다').toBeTruthy();
    // 허용 여부와 그 근거가 함께 있어야 한다 — 결론만 있으면 확인할 수 없다.
    expect(typeof gate!.allowed).toBe('boolean');
    expect(Array.isArray(gate!.reasons)).toBe(true);
  });
});

test.describe('[U4] 포지션·주문 목록', () => {
  test('[U4-2] 행이 없을 때 빈 표가 아니라 이유를 보여준다', async ({ page }) => {
    await signInFresh(page);
    /*
       ★★ 원본 의도를 그대로 지킨다. 이 프로젝트에서 반복된 실패 방식이 바로
         "조회 실패를 빈 목록으로 렌더" 였다 — 고객은 데이터가 없다고 읽고,
         운영자는 정상이라고 읽는다.

       ★ 키가 없는 계정에서는 "연결하면 보인다" 가 정답이다. 표본 행으로 채우지
         않는다는 사실까지 문구에 있다.
    */
    await expect(page.locator('body')).toContainText(
      /Connect an exchange API key to see this|Nothing is shown until then/i,
      { timeout: 20_000 },
    );
  });

  test('[U4-4] 할 수 없는 동작은 비활성 상태로 둔다', async ({ page }) => {
    await signInFresh(page);
    /*
       ★★ 원본 의도: 눌러도 아무 일이 없는 버튼을 두면 고객은 고장으로 읽고
         반복해서 누른다. 할 수 없으면 비활성 + 이유여야 한다.

       ★ 이 화면에서 실제로 확인할 수 있는 것: 잔고가 없으면 % 크기 버튼이
         비활성이다(availBal > 0 조건).
    */
    const disabled = await page.locator('button[disabled]').count();
    expect(disabled, '비활성 버튼이 하나도 없다 — 죽은 버튼이 남아 있을 수 있다').toBeGreaterThan(0);

    /*
       ★ 비활성인 것만으로는 부족하다. 이유가 붙어 있어야 한다(title 또는
         aria-label). 이유 없는 비활성은 고객에게 "왜?" 만 남긴다.
    */
    const withReason = await page.locator('button[disabled][title], button[disabled][aria-label]').count();
    expect(withReason, '이유가 붙은 비활성 버튼이 없다').toBeGreaterThan(0);
  });
});

test.describe('[U5] 자산', () => {
  test('[U5-1] 자산을 모를 때 0 으로 꾸미지 않는다', async ({ page }) => {
    await signInFresh(page);
    await page.goto('/#/wallet');
    await page.waitForTimeout(3000);
    await dismissDisclaimer(page);
    /*
       ★★ 원본 의도 그대로. 조회하지 못한 잔고를 0 으로 표시하면 고객은 자산을
         잃은 줄 안다 — 이 프로젝트는 자산 이력에서 같은 실수를 한 적이 있어
         (실패 시 0 기록) 그 뒤로 조회 성공 지점에서만 기록한다.
    */
    const body = page.locator('body');
    await expect(body).toContainText(/Connect|Add Exchange|not connected/i, { timeout: 20_000 });
  });
});
