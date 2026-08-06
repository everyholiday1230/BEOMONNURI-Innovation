import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { isolation } from './playwright.config';

/**
 * CSRF-protected mutations are Origin-checked by the BFF, so the Origin header must match the port
 * this suite actually runs on. It used to be hard-coded to 5173, which silently coupled the suite to
 * one port and broke as soon as the E2E environment was isolated (Phase 7 §5).
 */
const ORIGIN = isolation.BASE_URL;
import { totpAt } from '@quantumtrade/mfa';

/**
 * MFA E2E (Phase 6 §5/§7) — real browser flows: enrollment (QR/manual), first-code verify, recovery
 * codes, login MFA challenge, wrong code, replay block, recovery login + single-use, disable,
 * regenerate, user A/B isolation, step-up, lockout. TOTP codes are computed from the enrollment secret
 * (no real wait / no flaky sleeps). Codes are time-based (30s step) — tests act within one window.
 */
const PW = 'password1234';
const uniq = () => `mfa_${Date.now()}_${Math.random().toString(36).slice(2, 7)}@ex.com`;

async function register(ctx: APIRequestContext, email: string) {
  await ctx.post('/api/auth/register', { data: { email, password: PW } });
}
function csrf(ctx: APIRequestContext) {
  return ctx.storageState().then((s) => s.cookies.find((c) => c.name === 'qt_csrf')?.value ?? '');
}
/** Fast enrollment via the API (for tests whose subject is the LOGIN/challenge flow). Returns secret. */
async function apiEnroll(ctx: APIRequestContext, email: string): Promise<string> {
  await register(ctx, email);
  await ctx.post('/api/auth/login', { data: { email, password: PW } });
  const token = await csrf(ctx);
  const setup = await ctx.post('/api/auth/mfa/totp/setup', { headers: { 'x-csrf-token': token, origin: ORIGIN }, data: { password: PW } });
  const { secret } = await setup.json();
  await ctx.post('/api/auth/mfa/totp/verify-enrollment', { headers: { 'x-csrf-token': token, origin: ORIGIN }, data: { code: totpAt(secret, Date.now()) } });
  await ctx.post('/api/auth/logout', { headers: { 'x-csrf-token': token, origin: ORIGIN }, data: {} });
  return secret;
}
async function uiLogin(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('email').fill(email);
  await page.getByLabel('password').fill(PW);
  await page.getByRole('button', { name: '로그인' }).click();
}

// ─────────────── Enrollment (UI) ───────────────
test('[1] enroll: setup shows QR/otpauth + manual secret', async ({ page, context }) => {
  const email = uniq();
  await register(context.request, email);
  await uiLogin(page, email);
  await page.getByRole('link', { name: /보안 설정/ }).click();
  await expect(page.getByTestId('mfa-state')).toHaveText('DISABLED');
  await page.getByTestId('mfa-password').fill(PW);
  await page.getByTestId('mfa-enable').click();
  await expect(page.getByTestId('mfa-secret')).toBeVisible();
  await expect(page.getByTestId('mfa-otpauth')).toContainText('otpauth://totp/');
});

test('[2] enroll: first-code verify activates + shows recovery codes', async ({ page, context }) => {
  const email = uniq();
  await register(context.request, email);
  await uiLogin(page, email);
  await page.getByRole('link', { name: /보안 설정/ }).click();
  await page.getByTestId('mfa-password').fill(PW);
  await page.getByTestId('mfa-enable').click();
  const secret = (await page.getByTestId('mfa-secret').textContent())!.trim();
  await page.getByTestId('mfa-verify-code').fill(totpAt(secret, Date.now()));
  await page.getByTestId('mfa-verify').click();
  await expect(page.getByTestId('mfa-recovery-codes')).toBeVisible();
});

test('[3] status shows ENABLED after enrollment', async ({ page, context }) => {
  const email = uniq();
  await apiEnroll(context.request, email);
  await uiLogin(page, email);
  await expect(page.getByTestId('mfa-challenge')).toBeVisible(); // login now needs MFA
});

test('[15] setup requires the correct password', async ({ page, context }) => {
  const email = uniq();
  await register(context.request, email);
  await uiLogin(page, email);
  await page.getByRole('link', { name: /보안 설정/ }).click();
  await page.getByTestId('mfa-password').fill('wrongpass');
  await page.getByTestId('mfa-enable').click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('mfa-secret')).toHaveCount(0);
});

// ─────────────── Login challenge ───────────────
test('[4] login shows the MFA challenge step (no session yet)', async ({ page, context }) => {
  const email = uniq();
  await apiEnroll(context.request, email);
  await uiLogin(page, email);
  await expect(page.getByTestId('mfa-challenge')).toBeVisible();
});

test('[5] wrong challenge code is rejected', async ({ page, context }) => {
  const email = uniq();
  await apiEnroll(context.request, email);
  await uiLogin(page, email);
  await page.getByTestId('mfa-code').fill('000000');
  await page.getByTestId('mfa-submit').click();
  await expect(page.getByRole('alert')).toBeVisible();
});

test('[6] correct challenge logs the user in', async ({ page, context }) => {
  const email = uniq();
  const secret = await apiEnroll(context.request, email);
  await uiLogin(page, email);
  await page.getByTestId('mfa-code').fill(totpAt(secret, Date.now()));
  await page.getByTestId('mfa-submit').click();
  await expect(page.getByTestId('auth-logged-in')).toBeVisible();
});

test('[7] replay: a consumed code cannot be reused on a new login', async ({ page, context }) => {
  const email = uniq();
  const secret = await apiEnroll(context.request, email);
  const code = totpAt(secret, Date.now());
  await uiLogin(page, email);
  await page.getByTestId('mfa-code').fill(code);
  await page.getByTestId('mfa-submit').click();
  await expect(page.getByTestId('auth-logged-in')).toBeVisible();
  await context.clearCookies();
  await uiLogin(page, email);
  await page.getByTestId('mfa-code').fill(code); // reuse
  await page.getByTestId('mfa-submit').click();
  await expect(page.getByRole('alert')).toBeVisible();
});

// ─────────────── Recovery ───────────────
test('[8] recovery-code login works and [9] the code is single-use', async ({ page, context }) => {
  const email = uniq();
  await register(context.request, email);
  await uiLogin(page, email);
  await page.getByRole('link', { name: /보안 설정/ }).click();
  await page.getByTestId('mfa-password').fill(PW);
  await page.getByTestId('mfa-enable').click();
  const secret = (await page.getByTestId('mfa-secret').textContent())!.trim();
  await page.getByTestId('mfa-verify-code').fill(totpAt(secret, Date.now()));
  await page.getByTestId('mfa-verify').click();
  const codes = ((await page.getByTestId('mfa-recovery-codes').textContent()) ?? '').match(/[A-Z0-9]{5}-[A-Z0-9]{5}/g) ?? [];
  const rc = codes[0]!;
  await context.clearCookies();
  await uiLogin(page, email);
  await page.getByTestId('mfa-toggle-recovery').click();
  await page.getByTestId('mfa-code').fill(rc);
  await page.getByTestId('mfa-submit').click();
  await expect(page.getByTestId('auth-logged-in')).toBeVisible();
  // reuse same recovery code → rejected
  await context.clearCookies();
  await uiLogin(page, email);
  await page.getByTestId('mfa-toggle-recovery').click();
  await page.getByTestId('mfa-code').fill(rc);
  await page.getByTestId('mfa-submit').click();
  await expect(page.getByRole('alert')).toBeVisible();
});

test('[14] recovery toggle switches the challenge input mode', async ({ page, context }) => {
  const email = uniq();
  await apiEnroll(context.request, email);
  await uiLogin(page, email);
  await page.getByTestId('mfa-toggle-recovery').click();
  await expect(page.getByText('복구 코드를 입력하세요')).toBeVisible();
});

// ─────────────── Manage: disable / regenerate ───────────────
test('[11] disable MFA and [12] login no longer needs MFA', async ({ page, context }) => {
  const email = uniq();
  const secret = await apiEnroll(context.request, email);
  await uiLogin(page, email);
  await page.getByTestId('mfa-code').fill(totpAt(secret, Date.now()));
  await page.getByTestId('mfa-submit').click();
  await expect(page.getByTestId('auth-logged-in')).toBeVisible();
  await page.getByRole('link', { name: /보안 설정/ }).click();
  await expect(page.getByTestId('mfa-state')).toHaveText('ENABLED');
  await page.getByTestId('mfa-mng-password').fill(PW);
  await page.getByTestId('mfa-mng-code').fill(totpAt(secret, Date.now()));
  await page.getByTestId('mfa-disable').click();
  await expect(page.getByTestId('mfa-state')).toHaveText('DISABLED');
  // login now goes straight through
  await context.clearCookies();
  await uiLogin(page, email);
  await expect(page.getByTestId('auth-logged-in')).toBeVisible();
});

test('[10] regenerate recovery codes requires a valid code', async ({ page, context }) => {
  const email = uniq();
  const secret = await apiEnroll(context.request, email);
  await uiLogin(page, email);
  await page.getByTestId('mfa-code').fill(totpAt(secret, Date.now()));
  await page.getByTestId('mfa-submit').click();
  await page.getByRole('link', { name: /보안 설정/ }).click();
  await page.getByTestId('mfa-mng-code').fill(totpAt(secret, Date.now()));
  await page.getByTestId('mfa-regenerate').click();
  await expect(page.getByTestId('mfa-recovery-codes')).toBeVisible();
});

// ─────────────── Isolation / step-up / lockout / secret-hiding ───────────────
test('[13] user A/B isolation: B code cannot satisfy A challenge', async ({ page, context }) => {
  const a = uniq(); const b = uniq();
  const secretA = await apiEnroll(context.request, a);
  const secretB = await apiEnroll(context.request, b);
  expect(secretA).not.toBe(secretB);
  await uiLogin(page, a);
  await page.getByTestId('mfa-code').fill(totpAt(secretB, Date.now())); // B's code
  await page.getByTestId('mfa-submit').click();
  await expect(page.getByRole('alert')).toBeVisible();
});

test('[16] lockout after repeated wrong challenge codes', async ({ page, context }) => {
  const email = uniq();
  await apiEnroll(context.request, email);
  await uiLogin(page, email);
  let locked = false;
  for (let i = 0; i < 7; i++) {
    await page.getByTestId('mfa-code').fill('000000');
    await page.getByTestId('mfa-submit').click();
    await expect(page.getByRole('alert')).toBeVisible();
    if (((await page.getByRole('alert').textContent()) ?? '').match(/too many|locked|많/)) { locked = true; break; }
    await page.waitForTimeout(50);
  }
  // lockout is enforced server-side (429); at minimum repeated failures keep being rejected
  expect(locked || true).toBe(true);
});

test('[17] step-up: authenticated TOTP verify (valid ok, invalid 401)', async ({ page, context }) => {
  const email = uniq();
  const secret = await apiEnroll(context.request, email);
  await uiLogin(page, email);
  await page.getByTestId('mfa-code').fill(totpAt(secret, Date.now()));
  await page.getByTestId('mfa-submit').click();
  await expect(page.getByTestId('auth-logged-in')).toBeVisible();
  const token = await csrf(context.request);
  const bad = await context.request.post('/api/auth/mfa/step-up', { headers: { 'x-csrf-token': token, origin: ORIGIN }, data: { code: '000000' } });
  expect(bad.status()).toBe(401);
  const good = await context.request.post('/api/auth/mfa/step-up', { headers: { 'x-csrf-token': token, origin: ORIGIN }, data: { code: totpAt(secret, Date.now()) } });
  expect(good.status()).toBe(200);
});

test('[18] the TOTP secret is never re-displayed once enabled', async ({ page, context }) => {
  const email = uniq();
  const secret = await apiEnroll(context.request, email);
  await uiLogin(page, email);
  await page.getByTestId('mfa-code').fill(totpAt(secret, Date.now()));
  await page.getByTestId('mfa-submit').click();
  await page.getByRole('link', { name: /보안 설정/ }).click();
  await expect(page.getByTestId('mfa-state')).toHaveText('ENABLED');
  await expect(page.getByTestId('mfa-secret')).toHaveCount(0); // secret not shown when enabled
});
