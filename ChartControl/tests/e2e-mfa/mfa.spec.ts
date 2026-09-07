import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
/* ★ 새 의존성을 넣지 않는다. 서버 테스트가 쓰는 것과 같은 구현을 쓴다 — 코드 생성
   방식이 서버와 다르면 이 테스트는 무엇도 증명하지 못한다. */
import { totpAt } from '@quantumtrade/mfa';

import { isolation } from './playwright.config';

/*
   2단계 인증(TOTP) — 현재 UI 기준.

   ★★ 이 파일은 통째로 다시 썼다. 이유를 남긴다.

     원래 스펙은 **존재하지 않는 앱**을 대상으로 하고 있었다. `data-testid="mfa-*"`
     65곳과 한국어 라벨('로그인', /보안 설정/)을 기대했는데, 그 testid 는 지금 코드에
     하나도 없고 한국어는 UI 에서 제거됐다. 게다가 설정 파일이 `@quantumtrade/web`
     개발 서버를 띄우려 했고 그 패키지는 없다 — 그래서 스위트가 **시작조차 못 했다.**

   ★★ 무엇을 여기서 검증하고 무엇을 하지 않는지 분명히 한다.

     MFA 의 보안 성질(잘못된 코드 거부, 코드 재사용 차단, 복구 코드 1회성, 무차별
     대입 잠금, CSRF 요구)은 **서버 API 테스트가 이미 검증한다** — mfa-api.test.ts 17개,
     mfa-lockout-contract.test.ts 19개, login-mfa-rate-limit.test.ts 30개. 실제로 51개가
     통과한다(10개는 조건부 skip).

     그것을 브라우저로 다시 흉내내면 느리고 깨지기 쉽다. 그래서 여기서는 **UI 가
     서버와 실제로 연결되어 있는지**만 본다: 화면에서 켤 수 있는가, 상태가 화면에
     반영되는가, 켠 뒤 로그인이 2단계를 요구하는가.

   ★ 라벨은 사전 값을 그대로 쓴다(영어 UI). 문구가 바뀌면 이 테스트가 깨지는 것이
     맞다 — 고객이 보는 문구가 바뀐 것이므로.
*/

const PW = 'MfaSuite12345';
const ORIGIN = isolation.API_URL;

const uniq = () => `mfa${Date.now()}${Math.floor(Math.random() * 1000)}@gmail.com`;

/** 계정을 API 로 만든다 — 가입 화면을 다시 검증하는 것은 이 파일의 주제가 아니다. */
async function register(ctx: APIRequestContext, email: string): Promise<void> {
  const csrf = await ctx.get('/api/auth/csrf');
  const token = ((await csrf.json()) as { csrfToken?: string }).csrfToken ?? '';
  const r = await ctx.post('/api/auth/register', {
    headers: { 'x-csrf-token': token, origin: ORIGIN },
    data: { email, password: PW, confirmPassword: PW, acceptTerms: true, acceptPrivacy: true, acceptRisk: true },
  });
  expect(r.status(), `register failed: ${await r.text()}`).toBe(201);
}

/** 화면으로 로그인한다. */
async function uiLogin(page: Page, email: string, password = PW): Promise<void> {
  await page.goto('/#/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  /*
     ★ 버튼 문구는 'Sign in →' 이다(화살표 포함). `/sign in/i` 로 잡으면 같은 문구의
       제목까지 걸려 첫 번째가 버튼이 아닐 수 있다 — 실측으로 겪었다: 로그인이 되지
       않은 채 다음 단계로 넘어가 "Security 버튼이 없다" 로 보였다.
     ★ role=button 으로 한정하고 문구를 정확히 맞춘다.
  */
  await page.getByRole('button', { name: /^Sign in\s*→?$/i }).click();
}

/**
 * 로그인이 **끝날 때까지** 기다린다.
 *
 * ★★ 누르고 바로 다음 화면으로 이동하면 세션이 없는 상태로 넘어간다. 그러면 로그인
 *   화면이 그대로 남아 "Security 버튼이 없다" 로 보인다 — 실측으로 겪었다(진단 로그가
 *   /#/settings 에서 'Sign in' 화면을 보여줬다).
 *
 * ★ 성공을 기다리는 것 자체가 검증이다. 여기서 실패하면 로그인이 깨진 것이다.
 */
async function waitSignedIn(page: Page): Promise<void> {
  await expect(page).toHaveURL(/#\/(trade|settings|portfolio)/, { timeout: 20_000 });
}

/** 설정 → 보안 탭. */
async function openSecurity(page: Page): Promise<void> {
  await page.goto('/#/settings');
  /*
     ★ 안내 대화창을 **여기서** 닫는다. 호출 전에 닫아 두는 것에 의존하면 안 된다 —
       페이지를 이동하면 다시 뜨고, 그 상태에서는 클릭이 가로막혀 "버튼이 없다" 로
       보인다(실측으로 확인했다: 대화창 1개가 남아 Security 버튼 클릭이 45초 타임아웃).
  */
  await dismissDialogs(page);
  await page.getByRole('button', { name: /Security/i }).first().click();
  await expect(page.getByText(/Two-factor authentication/i)).toBeVisible();
}

/** 첫 진입 안내창을 닫는다. 남아 있으면 클릭이 가로막힌다. */
async function dismissDialogs(page: Page): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    const btn = page.locator('[role=dialog] button.btn--primary');
    if ((await btn.count()) === 0) break;
    await btn.first().click().catch(() => {});
    await page.waitForTimeout(400);
  }
}

test.describe('MFA — 화면이 서버와 실제로 연결되어 있다', () => {
  test('[1] 켜지 않은 계정은 화면에 Off 로 보이고, 켜는 버튼이 있다', async ({ page, context }) => {
    /*
       ★ 상태를 화면이 잘못 말하면 이용자는 보호받는다고 믿으면서 보호받지 못한다.
         그 오해가 이 기능에서 가장 나쁜 결과다.
    */
    const email = uniq();
    await register(context.request, email);
    await uiLogin(page, email);
    await waitSignedIn(page);
    await openSecurity(page);

    await expect(page.getByText(/^Off —/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn on' })).toBeVisible();
  });

  test('[2] 켜기: 비밀번호 재확인 → 키 표시 → 코드 확인 → On', async ({ page, context }) => {
    /*
       ★★ 이것이 이 파일의 핵심이다. 화면의 각 단계가 서버의 실제 절차
         (setup → verify-enrollment)와 이어져 있는지 본다. 어느 한 단계라도 배선이
         끊기면 이용자는 2단계를 켤 수 없고, 화면만 보면 왜 안 되는지 알 수 없다.
    */
    const email = uniq();
    await register(context.request, email);
    await uiLogin(page, email);
    await waitSignedIn(page);
    await openSecurity(page);

    await page.getByRole('button', { name: 'Turn on' }).click();

    /* 1단계 — 비밀번호 재확인. 세션만으로 2단계를 켜지 못하게 막는 장치다. */
    await page.getByLabel('Password', { exact: true }).last().fill(PW);
    await page.getByRole('button', { name: /^Continue$|^Next$|^Turn on$/i }).last().click();

    /* 2단계 — 서버가 발급한 키가 화면에 나온다. */
    const key = page.getByText(/[A-Z2-7]{16,}/).first();
    await expect(key).toBeVisible({ timeout: 15_000 });
    const secret = (await key.innerText()).replace(/\s+/g, '');
    expect(secret.length, '서버가 준 키가 화면에 없다').toBeGreaterThanOrEqual(16);

    /* 3단계 — 그 키로 만든 코드가 받아들여진다. 즉 화면의 키가 서버의 키와 같다. */
    await page.getByLabel('6-digit code').fill(totpAt(secret, Date.now()));
    await page.getByRole('button', { name: 'Turn on' }).last().click();

    await expect(page.getByText(/Two-factor authentication is now on|^On$/).first())
      .toBeVisible({ timeout: 15_000 });
  });

  test('[3] 켠 뒤 로그인은 2단계를 요구한다 — 화면이 통과시키지 않는다', async ({ page, context }) => {
    /*
       ★★ 서버가 요구해도 **화면이 그것을 무시하고 들여보내면** 아무 의미가 없다.
         구글 로그인 경로에서 같은 우회가 가능했던 적이 있어(별도로 막았다) 이
         성질은 화면 수준에서 확인할 값이 있다.
    */
    const email = uniq();
    await register(context.request, email);

    /* 켜는 과정은 API 로 한다 — 이 테스트의 주제는 로그인이다. */
    const ctx = context.request;
    const csrf1 = await ctx.get('/api/auth/csrf');
    let token = ((await csrf1.json()) as { csrfToken?: string }).csrfToken ?? '';
    await ctx.post('/api/auth/login', { headers: { 'x-csrf-token': token, origin: ORIGIN }, data: { email, password: PW } });
    const csrf2 = await ctx.get('/api/auth/csrf');
    token = ((await csrf2.json()) as { csrfToken?: string }).csrfToken ?? '';
    const setup = await ctx.post('/api/auth/mfa/totp/setup', {
      headers: { 'x-csrf-token': token, origin: ORIGIN }, data: { password: PW },
    });
    expect(setup.status(), `setup failed: ${await setup.text()}`).toBe(200);
    const { secret } = (await setup.json()) as { secret: string };
    const verify = await ctx.post('/api/auth/mfa/totp/verify-enrollment', {
      headers: { 'x-csrf-token': token, origin: ORIGIN }, data: { code: totpAt(secret, Date.now()) },
    });
    expect(verify.status(), `verify failed: ${await verify.text()}`).toBe(200);
    await ctx.post('/api/auth/logout', { headers: { 'x-csrf-token': token, origin: ORIGIN }, data: {} });

    /* 이제 화면으로 로그인한다 — 거래 화면으로 바로 들어가면 안 된다. */
    await uiLogin(page, email);
    await page.waitForTimeout(4000);

    const url = page.url();
    expect(url, '2단계를 요구하지 않고 거래 화면으로 들어갔다').not.toMatch(/#\/trade/);
    /* 코드를 요구하는 흔적이 화면에 있어야 한다. */
    const asksForCode = await page.getByText(/code|verification|authenticator/i).count();
    expect(asksForCode, '2단계 코드를 요구하는 안내가 화면에 없다').toBeGreaterThan(0);
  });

  test('[4] 이 배포에서 SMS 는 제공하지 않는다고 화면이 말한다', async ({ page, context }) => {
    /*
       ★ 없는 수단을 있는 것처럼 보여주면 이용자는 그것을 기다린다. 죽은 버튼을
         만들지 않는다는 규칙이 여기에도 적용된다.
    */
    const email = uniq();
    await register(context.request, email);
    await uiLogin(page, email);
    await waitSignedIn(page);
    await openSecurity(page);

    await expect(page.getByText(/SMS verification is not available on this deployment/i)).toBeVisible();
  });
});
