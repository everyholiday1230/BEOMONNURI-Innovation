import { test, expect } from '@playwright/test';

/*
   인증 왕복 — 가입 → 로그인 → 세션 → 로그아웃.

   ★★ 역할·이름으로 찾는다(getByRole / getByLabel), 마크업 구조로 찾지 않는다.

     예전 스펙은 `.card button.btn--primary` 나 `getByTestId('signup-ok')` 로 찾았다.
     `data-testid` 는 이 앱에 **하나도 없고**, 클래스 구조는 화면을 손볼 때마다
     바뀐다. 그래서 스펙 전체가 통째로 죽어 있었다.

     역할·이름으로 찾으면 두 가지를 동시에 얻는다:
       · 화면을 다시 칠해도 테스트가 살아 있다
       · 접근성 이름이 없으면 테스트가 실패한다 — 즉 **테스트가 접근성을 지킨다.**
         실제로 이 방식으로 바꾸면서 입력칸 93개에 접근성 이름이 하나도 없던 것을
         발견했다.
*/

/** 가입에 필요한 최소 동작. 필수 동의 체크박스가 있어 버튼만 눌러서는 통과하지 않는다. */
async function signUp(page: import('@playwright/test').Page, email: string, password: string) {
  await page.goto('/#/signup');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm', { exact: true }).fill(password);
  /*
     ★ 필수 동의. 커스텀 체크박스라 input 이 가려져 있어 감싸는 label 을 누른다
       (.check() 는 "element is not visible" 로 실패한다).
  */
  for (const label of await page.locator('label.chk').all()) {
    await label.click();
  }
  await page.getByRole('button', { name: /create account/i }).click();
}

/*
   ★★ 가입·로그인 직후 면책 대화상자가 뜨고 **클릭을 가로챈다.**
     닫지 않으면 이후 모든 동작이 "element intercepts pointer events" 로 실패한다.
*/
async function dismissDisclaimer(page: import('@playwright/test').Page) {
  for (let i = 0; i < 3; i += 1) {
    const primary = page.locator('[role=dialog] button.btn--primary');
    if (await primary.count() === 0) return;
    await primary.first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
}

test('register → land signed in → logout → login again', async ({ page }) => {
  const email = `e2e_${Date.now()}@example.com`;
  /* ★ 최소 10자. 서버 정책과 같은 값을 쓴다 — 8자로 두면 폼은 통과하고 서버가 거부한다. */
  const password = 'e2e-password-123';

  await signUp(page, email, password);

  /*
     가입이 끝나면 거래 화면으로 들어간다(이메일 인증 단계 없음).
     ★ URL 로 확인한다 — 화면 문구는 번역·문안 변경에 따라 바뀐다.
  */
  await expect(page).toHaveURL(/#\/trade/, { timeout: 20_000 });
  await dismissDisclaimer(page);

  /*
     로그인 상태 확인: 계정 버튼의 접근성 이름에 이메일이 들어 있다
     ("Signed in as {email} — click to sign out").
     ★ 로그인 여부를 화면 어딘가의 글자가 아니라 **계정 컨트롤**로 판단한다.
  */
  const account = page.getByRole('button', { name: new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
  await expect(account).toBeVisible({ timeout: 15_000 });

  /*
     로그아웃은 계정 메뉴 안에 있다.

     ★ 그 항목은 role="menuitem" 이다. getByRole('button') 으로는 찾지 못한다 —
       역할 기반으로 찾을 때는 **화면이 선언한 역할**을 써야 한다.
  */
  await account.click();
  await page.getByRole('menuitem', { name: /sign out/i }).click();

  // 로그아웃하면 로그인 화면으로 돌아온다.
  await expect(page).toHaveURL(/#\/login/, { timeout: 15_000 });

  // 같은 자격으로 다시 로그인된다 — 가입이 실제로 저장됐다는 증거.
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  await expect(page).toHaveURL(/#\/trade/, { timeout: 20_000 });
  await dismissDisclaimer(page);
  await expect(page.getByRole('button', { name: new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }))
    .toBeVisible({ timeout: 15_000 });
});

test('signup refuses a password shorter than the server allows', async ({ page }) => {
  /*
     ★★ 화면과 서버의 최소 길이가 어긋나면 고객은 "형식이 맞다는데 왜 안 되나" 를
       겪는다. 실제로 화면은 8자, 서버는 10자였다. 9자가 폼에서 막히는지 확인한다.
  */
  await page.goto('/#/signup');
  await page.getByLabel('Email', { exact: true }).fill(`short_${Date.now()}@example.com`);
  await page.getByLabel('Password', { exact: true }).fill('Short9chr');
  await page.getByLabel('Confirm', { exact: true }).fill('Short9chr');
  for (const label of await page.locator('label.chk').all()) await label.click();

  /*
     ★★ 화면이 아예 제출을 막는다 — 버튼이 비활성화된다.

       처음에는 버튼을 눌러 보고 "그 자리에 머무는지" 확인하려 했는데, 클릭이
       30초 타임아웃으로 실패했다. 원인은 버그가 아니라 **더 나은 동작**이었다:
       규칙에 맞지 않으면 누를 수 없다. 눌러서 오류를 보여주는 것보다 낫다.
       그래서 "비활성화 상태" 자체를 검증한다.
  */
  const submit = page.getByRole('button', { name: /create account/i });
  await expect(submit).toBeDisabled();
  await expect(page).toHaveURL(/#\/signup/);
});
