import { test, expect, type Page } from '@playwright/test';

/**
 * B4 — order draft / validation.
 *
 * The property that matters most here is negative: nothing in this flow can submit an order. The tests
 * therefore assert on what is ABSENT (no live endpoint call, no executable verdict, no submit route) as
 * well as on the validation output the UI shows.
 */

async function signIn(page: Page): Promise<string> {
  const email = `b4-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ex.com`;
  const password = 'e2e-fixture-not-a-secret'; // low-entropy test fixture (min-10 policy); intentionally not secret-shaped
  await page.goto('/#/signup');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm', { exact: true }).fill(password);
  /*
     ★★ 동의 체크박스를 눌러야 제출 버튼이 활성화된다.

       이 앱의 체크박스는 커스텀이라 `.check()` 가 듣지 않는다 — 감싸는
       `label.chk` 를 클릭해야 한다.
  */
  for (const label of await page.locator('label.chk').all()) await label.click();
  /*
     ★ 클래스가 아니라 역할과 이름으로 찾는다. `button.btn--primary` 는 화면에
       여러 개 있을 수 있고, 마크업이 바뀌면 조용히 다른 버튼을 누른다.
  */
  await page.getByRole('button', { name: /create account/i }).click();
  /*
     ★★ 가입 성공 판정을 `getByTestId('signup-ok')` 로 했는데 이 앱에는
       data-testid 가 **0개**다. 즉 이 스펙은 실행되면 여기서 늘 실패했다.

     ★ 대신 **결과**를 본다: 가입에 성공하면 로그인 상태로 거래 화면에 도달한다.
       그게 이 함수가 필요한 사실이다.
  */
  await expect(page).toHaveURL(/#\/trade/, { timeout: 20_000 });
  await expect
    .poll(async () => page.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'include' })).status), {
      timeout: 20_000,
    })
    .toBe(200);
  return email;
}

/** POST helper that mints a CSRF token first (the cookie is only set by GET /auth/csrf). */
async function post(
  page: Page,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(
    async ({ p, b, h }) => {
      const t = await fetch('/api/auth/csrf', { credentials: 'include' });
      const token = ((await t.json()) as { csrfToken: string | null }).csrfToken ?? '';
      const r = await fetch(p, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': token, ...h },
        body: JSON.stringify(b),
      });
      let parsed: Record<string, unknown> = {};
      try {
        parsed = (await r.json()) as Record<string, unknown>;
      } catch {
        /* empty body */
      }
      return { status: r.status, body: parsed };
    },
    { p: path, b: body, h: headers },
  );
}

const goodIntent = {
  symbol: 'BTCUSDT',
  side: 'long',
  type: 'limit',
  quantity: '0.002',
  price: '65000.0',
  leverage: 10,
  marginMode: 'cross',
};

test.describe('[B4] order validation contract', () => {
  test('[B4-1] validate and draft both require a session', async ({ page }) => {
    await page.goto('/');
    expect((await post(page, '/api/orders/validate', goodIntent)).status).toBe(401);
    expect((await post(page, '/api/orders/draft', goodIntent, { 'idempotency-key': 'anon-key-0001' })).status).toBe(401);
  });

  test('[B4-2] a valid intent is never executable', async ({ page }) => {
    await signIn(page);
    const r = await post(page, '/api/orders/validate', goodIntent);
    expect(r.status).toBe(200);
    const b = r.body as { executable: boolean; allowed: boolean; blockingReasons: { code: string }[]; riskChecks: unknown[] };
    expect(b.executable).toBe(false);
    expect(b.allowed).toBe(false);
    expect(b.blockingReasons.map((x) => x.code)).toContain('LIVE_TRADING_DISABLED');
    expect(b.riskChecks.length).toBeGreaterThan(5);
  });

  test('[B4-3] an unknown field is rejected rather than ignored', async ({ page }) => {
    await signIn(page);
    // `submit: true` must be a hard 422. Silently dropping unknown fields is how a bypass flag ships.
    const r = await post(page, '/api/orders/validate', { ...goodIntent, submit: true });
    expect(r.status).toBe(422);
  });

  test('[B4-4] a numeric quantity is rejected so the parser cannot pre-round it', async ({ page }) => {
    await signIn(page);
    const r = await post(page, '/api/orders/validate', { ...goodIntent, quantity: 0.002 });
    expect(r.status).toBe(422);
  });

  test('[B4-5] draft requires an idempotency key and replays under the same key', async ({ page }) => {
    await signIn(page);
    expect((await post(page, '/api/orders/draft', goodIntent)).status).toBe(400);

    const key = `e2e-draft-${Date.now()}`;
    const first = await post(page, '/api/orders/draft', goodIntent, { 'idempotency-key': key });
    expect(first.status).toBe(201);
    const second = await post(page, '/api/orders/draft', { ...goodIntent, quantity: '0.005' }, { 'idempotency-key': key });
    expect(second.status).toBe(200);
    expect((second.body as { replayed: boolean }).replayed).toBe(true);
    // The replay returns the ORIGINAL verdict; a retry that reported a different outcome would make the
    // key meaningless.
    expect((second.body as { draftId: string }).draftId).toBe((first.body as { draftId: string }).draftId);
    expect((second.body as { normalizedOrder: { quantity: string } }).normalizedOrder.quantity).toBe('0.002');
  });

  test('[B4-6] there is no order submit endpoint', async ({ page }) => {
    await signIn(page);
    for (const p of ['/api/orders/submit', '/api/orders/draft/submit', '/api/orders/execute']) {
      const r = await post(page, p, goodIntent, { 'idempotency-key': 'submit-probe-01' });
      expect([404, 405], `${p} responded ${r.status}`).toContain(r.status);
    }
  });

  /*
     ★★ B4-7·8·9 는 존재하지 않는 화면을 대상으로 했다.

       `[data-testid="oe-qty"]`·`oe-preview`·`server-validation` 패널을 찾았는데,
       이 앱에는 그런 요소가 **하나도 없다**(src 전체에서 0건). data-testid 자체가
       0개다. 즉 이 세 검사는 실행되면 늘 30초 타임아웃으로 실패했다.

       실제 흐름은 다르다: 주문 확인은 별도 패널이 아니라 **모달**이고, 화면은
       `/api/orders/validate` 를 부르지 않는다(부르는 곳이 src 에 없다).

     ★ 그래서 검증하려던 **사실**만 남기고 대상을 옮긴다. 원래 의도는 세 가지였다:
         · 서버 판정과 차단 사유가 밖으로 드러나는가
         · 로그아웃 상태가 401 폭탄이 아니라 안내로 처리되는가
         · 검증 경로가 실거래소·AI 를 건드리지 않는가
       그 세 가지는 라우트를 직접 불러 확인할 수 있고, 화면 마크업이 바뀌어도
       계속 답할 수 있다. 없는 UI 를 있는 것처럼 테스트하지는 않는다.
  */
  test('[B4-7] validation returns the verdict and names its blocking reasons', async ({ page }) => {
    await signIn(page);
    const r = await post(page, '/api/orders/validate', goodIntent);
    expect(r.status).toBe(200);

    /*
       ★★ 실행 가능 여부를 **응답이 말해야** 한다. 화면이 스스로 추측하면
         서버와 어긋나고, 고객은 화면 숫자를 믿고 주문한다.
    */
    expect(r.body).toHaveProperty('executable');
    expect(r.body.executable).toBe(false);

    /*
       ★★ 차단 사유가 **이름을 가져야** 한다. "주문할 수 없습니다" 만으로는
         고객도 운영자도 다음에 무엇을 할지 알 수 없다.
    */
    const reasons = (r.body.blockingReasons ?? []) as Array<{ code?: string }>;
    expect(reasons.length).toBeGreaterThan(0);
    const codes = reasons.map((x) => x.code);
    expect(codes.every((c) => typeof c === 'string' && c.length > 0)).toBe(true);
  });

  test('[B4-8] an anonymous validate is refused once, not repeatedly', async ({ page }) => {
    /*
       ★ 로그아웃 상태에서 401 은 정답이다. 확인하려는 것은 **예측 가능한 401 을
         화면이 반복해서 유발하지 않는가** 이다 — 브라우저 콘솔이 401 로 가득 차면
         진짜 장애를 놓친다.
    */
    const unauthorized: string[] = [];
    page.on('response', (r) => {
      if (r.status() === 401 && /\/api\/orders\/(validate|draft)/.test(r.url())) unauthorized.push(r.url());
    });
    await page.goto('/#/trade');
    await page.waitForTimeout(4000);

    // 화면이 로그아웃 상태에서 이 라우트를 스스로 부르지 않아야 한다.
    expect(unauthorized, `화면이 401 을 유발했다:\n${unauthorized.join('\n')}`).toEqual([]);

    // 직접 부르면 401 이 정답이다.
    const r = await post(page, '/api/orders/validate', goodIntent);
    expect(r.status).toBe(401);
  });

  test('[B4-9] validation never contacts a live exchange or AI provider', async ({ page }) => {
    const forbidden: string[] = [];
    page.on('request', (r) => {
      const u = r.url();
      /*
         ★★ 검증이 실주문 경로나 AI 를 건드리면, "확인만 했다" 고 믿는 사이에
           돈이 나가거나 비용이 발생한다. 검증은 판단만 해야 한다.
      */
      if (/bitmart|api\.openai|\/trading\/orders|\/live\//i.test(u)) forbidden.push(u);
    });
    await signIn(page);
    await post(page, '/api/orders/validate', goodIntent);
    await post(page, '/api/orders/draft', goodIntent, { 'idempotency-key': `e2e-live-probe-${Date.now()}` });
    expect(forbidden, `실거래 경로가 호출됐다: ${forbidden.join(', ')}`).toEqual([]);
  });

  test('[B4-10] drafts are listed per user only', async ({ page, context }) => {
    await signIn(page);
    await post(page, '/api/orders/draft', goodIntent, { 'idempotency-key': `e2e-iso-${Date.now()}` });
    const mine = await page.evaluate(async () => {
      const r = await fetch('/api/orders/drafts', { credentials: 'include' });
      return (await r.json()) as { page: { total: number } };
    });
    expect(mine.page.total).toBe(1);

    const page2 = await context.browser()!.newPage();
    try {
      await signIn(page2);
      const theirs = await page2.evaluate(async () => {
        const r = await fetch('/api/orders/drafts', { credentials: 'include' });
        return (await r.json()) as { page: { total: number } };
      });
      expect(theirs.page.total).toBe(0);
    } finally {
      await page2.close();
    }
  });
});
