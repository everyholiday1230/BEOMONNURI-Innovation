import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { isolation } from './playwright.config';

/**
 * Admin App E2E (Chromium — real browser). Runs against the SEPARATE admin app (port 5174) wired to
 * the BFF (port 8788) with a dev-only seed (ADMIN_SEED, NODE_ENV!=production):
 *   admin@qt.local     SUPER_ADMIN  adminpass1234
 *   support@qt.local   SUPPORT      supportpass1234
 *   analyst@qt.local   ANALYST      analystpass1234
 *   user@qt.local      USER         userpass1234
 *   disable-me@qt.local USER        disablepass1234   (disposable — disable/enable scenario)
 *   role-me@qt.local    USER         rolepass1234      (disposable — role-change scenario)
 *
 * The 30 scenarios below map 1:1 to the closure checklist. NO scenario enables live trading. Server
 * RBAC/CSRF/state-machine/optimistic-lock/no-fake-pass invariants are exercised end-to-end.
 * Firefox/WebKit are Not Executed here (opt-in via PW_ALL_BROWSERS=1; documented in PHASE5-15).
 */

async function login(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByLabel(/Email|이메일/).fill(email);
  await page.getByLabel(/Password|비밀번호/).fill(password);
  await page.getByRole('button', { name: /Sign in|로그인/ }).click();
}

async function loginAdmin(page: Page) {
  await login(page, 'admin@qt.local', 'adminpass1234');
  await expect(page.getByRole('navigation', { name: 'admin' })).toBeVisible();
}

async function nav(page: Page, name: string | RegExp) {
  await page.getByRole('link', { name }).click();
}

/**
 * Search the user table.
 *
 * The search box is debounced (A8 requirement) and has no submit button, so the helper types the term
 * and then waits for the table to settle rather than clicking a magnifier. Called with no term it just
 * re-waits, which is what the "refresh after a mutation" steps need.
 */
async function searchUsers(page: Page, term?: string) {
  // The screen is a lazily-imported chunk: wait for it before typing into it.
  await expect(page.getByLabel('Search email')).toBeVisible({ timeout: 15_000 });
  if (term !== undefined) await page.getByLabel('Search email').fill(term);
  // Past the 250ms debounce, then wait for the table to SETTLE. Any status other than `loading`
  // counts — `offline`, `expired` and `rateLimited` are settled outcomes the scenarios assert on, so
  // requiring ready/empty here would make those cases unreachable.
  await page.waitForTimeout(400);
  await page
    .locator('[data-testid="users"]:not([data-table-status="loading"])')
    .waitFor({ timeout: 15_000 });
}

/** A data row (excludes the thead header row) that contains the given text. */
function bodyRow(page: Page, text: string) {
  return page.locator('tbody tr').filter({ hasText: text });
}

/**
 * Confirm a dangerous action: fill the reason and satisfy step-up when the dialog asks for it.
 *
 * Step-up is not a per-call choice for the test to make — the dialog declares it (every user mutation
 * now requires it), so the helper ticks the box whenever one is present. Passing `reauth` explicitly is
 * still honoured for the cases that want to assert the un-acknowledged state.
 */
async function confirmDialog(page: Page, reason: string, reauth = true) {
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel(/Reason|변경 사유/).fill(reason);
  if (reauth) {
    // A9 dialog exposes a testid; screens not yet migrated still use a bare checkbox.
    const stepUp = dlg.getByTestId('danger-stepup');
    if (await stepUp.count()) await stepUp.check();
    else if (await dlg.getByRole('checkbox').count()) await dlg.getByRole('checkbox').first().check();
  }
  const confirm = dlg.getByRole('button', { name: /Confirm|확인/ });
  await expect(confirm).toBeEnabled();
  await confirm.click();
}

/** Double-submit CSRF headers for page.request mutations (mirrors the browser: header == qt_csrf cookie). */
async function csrfHeaders(context: BrowserContext): Promise<Record<string, string>> {
  const cookies = await context.cookies();
  const csrf = cookies.find((c) => c.name === 'qt_csrf')?.value ?? '';
  // Origin comes from the config that actually launched this run. A literal `http://localhost:5174`
  // here silently pointed at nothing whenever the suite ran on an isolated port, which is what made
  // scenarios [16]/[20]/[27] fail on every browser.
  return { 'x-csrf-token': csrf, origin: isolation.BASE_URL, 'content-type': 'application/json' };
}

// ─────────────────────────── A. Auth / access control ───────────────────────────

test('[1] SUPER_ADMIN can sign in and sees the admin nav + overview', async ({ page }) => {
  await loginAdmin(page);
  await expect(page.getByRole('link', { name: /Overview|개요/ })).toBeVisible();
  await expect(page.getByText(/Unmeasured values|Unavailable|Not Connected/).first()).toBeVisible();
});

test('[2] normal USER is denied admin access (access-denied state, not the dashboard)', async ({ page }) => {
  await login(page, 'user@qt.local', 'userpass1234');
  await expect(page.getByRole('status').filter({ hasText: /Permission Denied|권한 없음/ })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'admin' })).toHaveCount(0);
});

test('[3] SUPPORT is limited: role change is gated in the UI AND refused by the server (403)', async ({ page, context }) => {
  await login(page, 'support@qt.local', 'supportpass1234');
  await expect(page.getByRole('navigation', { name: 'admin' })).toBeVisible();
  await nav(page, 'Users');
  await searchUsers(page, 'user@qt.local');
  const row = bodyRow(page, 'user@qt.local');

  // (a) the affordance: the control is present but disabled, and states WHY — not silently hidden.
  const btn = row.getByRole('button', { name: /Change role/ });
  await expect(btn).toBeDisabled();
  await expect(btn).toHaveAttribute('data-deny-reason', 'permission');

  // (b) the actual control: the server refuses the same mutation regardless of the UI. Hiding a
  // button is never accepted as the protection (Prompt 4 §1.8).
  const users = await context.request.get(`${isolation.BASE_URL}/api/admin/users?q=user@qt.local`);
  const id = ((await users.json()) as { users: { id: string }[] }).users[0]!.id;
  const res = await context.request.patch(`${isolation.BASE_URL}/api/admin/users/${id}/role`, {
    headers: await csrfHeaders(context),
    data: { newRole: 'ANALYST', reason: 'support attempts role change' },
  });
  expect(res.status()).toBe(403);
  expect(JSON.stringify(await res.json())).toMatch(/admin\.role\.write|FORBIDDEN/);
});

test('[4] ANALYST is read-only: disable is gated in the UI AND refused by the server (403)', async ({ page, context }) => {
  await login(page, 'analyst@qt.local', 'analystpass1234');
  await expect(page.getByRole('navigation', { name: 'admin' })).toBeVisible();
  await nav(page, 'Users');
  await searchUsers(page, 'user@qt.local');
  const row = bodyRow(page, 'user@qt.local');

  const btn = row.getByRole('button', { name: 'Disable', exact: true });
  await expect(btn).toBeDisabled();
  await expect(btn).toHaveAttribute('data-deny-reason', 'permission');

  const users = await context.request.get(`${isolation.BASE_URL}/api/admin/users?q=user@qt.local`);
  const id = ((await users.json()) as { users: { id: string }[] }).users[0]!.id;
  const res = await context.request.post(`${isolation.BASE_URL}/api/admin/users/${id}/disable`, {
    headers: await csrfHeaders(context),
    data: { reason: 'analyst attempts disable' },
  });
  expect(res.status()).toBe(403);
});

// ─────────────────────────── C. User management ───────────────────────────

test('[5] user search filters by email', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, 'Users');
  await searchUsers(page, 'analyst@qt.local');
  await expect(bodyRow(page, 'analyst@qt.local')).toBeVisible();
  await expect(bodyRow(page, 'admin@qt.local')).toHaveCount(0);
});

test('[6] user detail opens with named fields and never shows secrets', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, 'Users');
  await searchUsers(page, 'user@qt.local');
  await bodyRow(page, 'user@qt.local').getByTestId('users-open-detail').click();
  const dlg = page.getByTestId('user-detail');
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText('User detail');
  await expect(page.getByTestId('user-detail-redaction')).toBeVisible();
  // Named fields, not a JSON dump.
  await expect(dlg.locator('[data-field="email"]')).toContainText('user@qt.local');
  await expect(dlg.locator('[data-field="role"]')).toBeVisible();
  // Redaction tripwire: no credential-shaped key or value anywhere in the drawer's DOM. The redaction
  // NOTICE is excluded — it exists to say "no password hash is shown", so scanning it is self-defeating.
  const html = (await dlg.innerHTML()).toLowerCase();
  const notice = (await page.getByTestId('user-detail-redaction').innerHTML()).toLowerCase();
  const scanned = html.replace(notice, '');
  for (const bad of ['password', 'hash', 'csrf', 'recovery', 'salt', 'qt_session', 'secret']) {
    expect(scanned, `"${bad}" must not appear in the user detail DOM`).not.toContain(bad);
  }
  await page.getByTestId('user-detail-close').click();
  await expect(dlg).toHaveCount(0);
});

test('[7] account disable requires confirmation + reason (and enable restores)', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, 'Users');
  await searchUsers(page, 'disable-me@qt.local');
  let row = bodyRow(page, 'disable-me@qt.local');
  // If a prior run left it disabled, re-enable first so the scenario is deterministic.
  if (await row.getByRole('button', { name: 'Enable', exact: true }).count()) {
    await row.getByRole('button', { name: 'Enable', exact: true }).click();
    await confirmDialog(page, 'reset to active for test');
    row = bodyRow(page, 'disable-me@qt.local');
  }
  await row.getByRole('button', { name: 'Disable', exact: true }).click();
  await confirmDialog(page, 'e2e disable confirmation', true);
  row = bodyRow(page, 'disable-me@qt.local');
  await expect(row.getByRole('button', { name: 'Enable', exact: true })).toBeVisible();
  // cleanup / covers re-activation
  await row.getByRole('button', { name: 'Enable', exact: true }).click();
  await confirmDialog(page, 'e2e re-enable cleanup');
  await expect(bodyRow(page, 'disable-me@qt.local').getByRole('button', { name: 'Disable', exact: true })).toBeVisible();
});

test('[8] revoke-all-sessions succeeds for SUPER_ADMIN', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, 'Users');
  await searchUsers(page, 'user@qt.local');
  await bodyRow(page, 'user@qt.local').getByRole('button', { name: 'Revoke sessions' }).click();
  await confirmDialog(page, 'revoke sessions e2e');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('[9] role change succeeds (role-me → ANALYST)', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, 'Users');
  await searchUsers(page, 'role-me@qt.local');
  await bodyRow(page, 'role-me@qt.local').getByRole('button', { name: /Change role/ }).click();
  await confirmDialog(page, 'promote to analyst e2e', true);
  await expect(bodyRow(page, 'role-me@qt.local')).toContainText('ANALYST');
});

test('[10] self role change is blocked (server invariant)', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, 'Users');
  await searchUsers(page, 'admin@qt.local');
  await bodyRow(page, 'admin@qt.local').getByRole('button', { name: /Change role/ }).click();
  await confirmDialog(page, 'attempt self role change', true);
  await expect(page.getByRole('alert')).toBeVisible();
});

test('[11] disabling the last SUPER_ADMIN is blocked (server invariant)', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, 'Users');
  await searchUsers(page, 'admin@qt.local');
  await bodyRow(page, 'admin@qt.local').getByRole('button', { name: 'Disable', exact: true }).click();
  await confirmDialog(page, 'attempt disable last super admin', true);
  await expect(page.getByRole('alert')).toBeVisible();
});

// ─────────────────────────── D/E. Exchange & trading (read-only) ───────────────────────────

test('[12] exchange connections are masked / secrets never shown', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, 'Exchange');
  await expect(page.getByText(/Access keys are masked/)).toBeVisible();
  await expect(page.getByText(/Not Connected/).first()).toBeVisible();
});

test('[13] Orders & Positions is read-only (no submit/cancel controls)', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, /Orders/);
  await expect(page.getByText(/Read-only|읽기 전용/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: /submit|cancel|제출|취소/i })).toHaveCount(0);
});

// ─────────────────────────── F. AI operations ───────────────────────────

test('[14] AI Operations shows Not Connected / Not Executed (never fake numbers)', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, /AI Operations/);
  await expect(page.getByText(/Not Executed|Not Connected/).first()).toBeVisible();
});

// ─────────────────────────── G. Audit ───────────────────────────

test('[15] audit explorer lists a recorded admin action (search by action)', async ({ page }) => {
  await loginAdmin(page);
  // Perform an auditable action via the UI to guarantee an entry.
  await nav(page, 'Users');
  await searchUsers(page, 'user@qt.local');
  await bodyRow(page, 'user@qt.local').getByRole('button', { name: 'Revoke sessions' }).click();
  await confirmDialog(page, 'seed audit entry');
  await expect(page.getByRole('dialog')).toHaveCount(0); // revoke committed before we read the audit log
  await nav(page, 'Audit');
  // Unfiltered explorer lists the just-recorded action (most-recent-first).
  await expect(page.getByText('user.revoke_sessions').first()).toBeVisible();
  // Search/filter by action narrows the explorer.
  await page.getByLabel('Search action').fill('user.revoke_sessions');
  // The Audit screen still submits its own form (it is migrated to the shared table in A6), so this
  // is an Enter on that field — not the debounced Users search.
  await page.getByLabel('Search action').press('Enter');
  await expect(page.getByText('user.revoke_sessions').first()).toBeVisible();
});

test('[16] audit export (CSV + JSON) is available and CSV is formula-injection-safe', async ({ page, context }) => {
  await loginAdmin(page);
  const csv = await context.request.get(`${isolation.BASE_URL}/api/admin/audit/export?format=csv`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-type']).toContain('text/csv');
  const body = await csv.text();
  expect(body.split('\n')[0]).toContain('actor_user_id');
  // No unescaped formula-trigger at the start of any cell (csvSafe prefixes with a quote).
  for (const line of body.split('\n').slice(1)) {
    for (const cell of line.split(',')) expect(/^[=+\-@]/.test(cell)).toBeFalsy();
  }
  const json = await context.request.get(`${isolation.BASE_URL}/api/admin/audit/export?format=json`);
  expect(json.status()).toBe(200);
});

// ─────────────────────────── H. Incidents ───────────────────────────

test('[17] incident create + legal status transition', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, 'Incidents');
  const title = `e2e-incident-${Date.now()}`;
  await page.getByLabel('title').fill(title);
  await page.getByRole('button', { name: '+ Incident' }).click();
  const combo = () => bodyRow(page, title).getByRole('combobox');
  await expect(combo()).toHaveValue('OPEN');
  await combo().selectOption('INVESTIGATING');
  await expect(combo()).toHaveValue('INVESTIGATING');
});

test('[18] illegal incident transition is blocked (server 409 + UI)', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, 'Incidents');
  const title = `e2e-illegal-${Date.now()}`;
  await page.getByLabel('title').fill(title);
  await page.getByRole('button', { name: '+ Incident' }).click();
  const combo = () => bodyRow(page, title).getByRole('combobox');
  // OPEN → CLOSED is legal; CLOSED is terminal so CLOSED → INVESTIGATING is illegal.
  await combo().selectOption('CLOSED');
  await expect(combo()).toHaveValue('CLOSED');
  await combo().selectOption('INVESTIGATING');
  await expect(page.getByRole('alert')).toContainText(/Illegal state transition|blocked/);
});

// ─────────────────────────── I. Feature flags ───────────────────────────

test('[19] feature flag change with reason (optimistic version increments)', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, 'Feature Flags');
  const row = bodyRow(page, 'e2e_seed');
  const badgeBefore = await row.locator('.badge').first().textContent();
  await row.getByRole('button', { name: /Enable|Disable/ }).click();
  await confirmDialog(page, 'toggle e2e_seed flag');
  await expect(bodyRow(page, 'e2e_seed').locator('.badge').first()).not.toHaveText(badgeBefore ?? '');
});

test('[20] feature flag concurrent edit → 409 conflict surfaced in UI', async ({ page, context }) => {
  await loginAdmin(page);
  await nav(page, 'Feature Flags');
  await expect(bodyRow(page, 'ai_enabled')).toBeVisible();
  // Read the current flag id+version, then perform a concurrent edit out-of-band (bumps the version).
  const list = await context.request.get(`${isolation.BASE_URL}/api/admin/feature-flags`);
  const flags = (await list.json()).flags as Array<{ id: string; key: string; enabled: number; version: number }>;
  const flag = flags.find((f) => f.key === 'ai_enabled')!;
  const bump = await context.request.patch(`${isolation.BASE_URL}/api/admin/feature-flags/${flag.id}`, {
    headers: await csrfHeaders(context),
    data: { enabled: !flag.enabled, reason: 'concurrent edit', version: flag.version },
  });
  expect(bump.ok()).toBeTruthy();
  // The UI still holds the stale version → its toggle must conflict.
  await bodyRow(page, 'ai_enabled').getByRole('button', { name: /Enable|Disable/ }).click();
  await confirmDialog(page, 'stale version toggle');
  await expect(page.getByRole('alert')).toContainText(/409|conflict/i);
});

// ─────────────────────────── J. Kill switches ───────────────────────────

test('[21] kill switch change (non-live scope) with step-up reauth succeeds', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, 'Kill Switches');
  const row = bodyRow(page, 'ai_order_draft');
  const before = await row.locator('.badge').first().textContent();
  await row.getByRole('button', { name: 'Toggle' }).click();
  await confirmDialog(page, 'toggle ai_order_draft kill switch', true);
  await expect(bodyRow(page, 'ai_order_draft').locator('.badge').first()).not.toHaveText(before ?? '');
});

test('[22] kill switch toggle WITHOUT reauth is refused (STEP_UP_REQUIRED)', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, 'Kill Switches');
  await bodyRow(page, 'ai_provider').getByRole('button', { name: 'Toggle' }).click();
  await confirmDialog(page, 'toggle without reauth', false);
  await expect(page.getByRole('alert')).toContainText(/Step-up/i);
});

test('[21b] live-trading kill switch shows the server-blocked warning', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, 'Kill Switches');
  await expect(page.getByText(/blocked server-side|차단/)).toBeVisible();
});

// ─────────────────────────── K. Release gates ───────────────────────────

test('[23] release gate PASSED without evidence is blocked (no fake pass)', async ({ page }) => {
  await loginAdmin(page);
  await nav(page, 'Release Gates');
  await expect(page.getByText('NOT_EXECUTED').first()).toBeVisible();
  await page.getByRole('button', { name: 'Try PASS' }).first().click();
  await expect(page.getByRole('status')).toContainText(/without evidence|blocked/i);
  await expect(page.getByText('NOT_EXECUTED').first()).toBeVisible();
});

// ─────────────────────────── Design system ───────────────────────────

test('[24] i18n ko/en toggle changes UI language', async ({ page }) => {
  await loginAdmin(page);
  await page.getByRole('button', { name: 'toggle language' }).click();
  await expect(page.getByRole('link', { name: '사용자' })).toBeVisible();
});

test('[25] dark/light theme toggle updates the document theme', async ({ page }) => {
  await loginAdmin(page);
  const before = await page.evaluate(() => document.documentElement.dataset.theme);
  await page.getByRole('button', { name: 'toggle theme' }).click();
  const after = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(before).not.toBe(after);
});

// ─────────────────────────── Common states / resilience ───────────────────────────

test('[26] session expiry (401) renders the Session-expired state', async ({ page }) => {
  await loginAdmin(page);
  await page.route('**/api/admin/users**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'expired' } }) }));
  await nav(page, 'Users');
  await expect(page.getByText(/Session expired|세션 만료/)).toBeVisible();
});

test('[27] CSRF-less mutation is rejected (403)', async ({ page, context }) => {
  await loginAdmin(page);
  const users = await context.request.get(`${isolation.BASE_URL}/api/admin/users?q=user@qt.local`);
  const id = ((await users.json()).users as Array<{ id: string; email: string }>).find((u) => u.email === 'user@qt.local')!.id;
  // No x-csrf-token header → server must reject the mutation.
  const res = await context.request.post(`${isolation.BASE_URL}/api/admin/users/${id}/revoke-sessions`, {
    headers: { origin: isolation.BASE_URL, 'content-type': 'application/json' },
    data: {},
  });
  expect(res.status()).toBe(403);
});

test('[28] offline → resume: offline state then recovers on retry', async ({ page, context }) => {
  await loginAdmin(page);
  await nav(page, 'Users');
  // Wait until the Users screen is fully interactive BEFORE cutting the network. Each screen is a
  // lazily-imported chunk; going offline while that chunk is still in flight leaves the search input
  // unrendered (observed on Firefox), which is a test-sequencing artefact, not the behaviour under
  // test. The subject here is the offline state on a SEARCH request.
  await expect(page.getByLabel('Search email')).toBeVisible();
  await context.setOffline(true);
  await searchUsers(page, 'user');
  await expect(page.getByText(/Offline|오프라인/)).toBeVisible();
  await context.setOffline(false);
  await page.getByRole('button', { name: /Confirm|확인/ }).click();
  await expect(page.getByText(/Offline|오프라인/)).toHaveCount(0);
});

test('[29] API 500 renders a page-level error state', async ({ page }) => {
  await loginAdmin(page);
  await page.route('**/api/admin/users**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'boom' } }) }));
  await nav(page, 'Users');
  await expect(page.getByText(/An error occurred|오류가 발생/)).toBeVisible();
});

test('[30] API 429 renders the rate-limited state', async ({ page }) => {
  await loginAdmin(page);
  await page.route('**/api/admin/users**', (r) => r.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: { message: 'slow down' } }) }));
  await nav(page, 'Users');
  await expect(page.getByText(/Rate limited|too many|너무 많/i)).toBeVisible();
});
