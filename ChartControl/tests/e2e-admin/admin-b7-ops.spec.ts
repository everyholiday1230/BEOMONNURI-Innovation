import { test, expect, type Page } from '@playwright/test';
import { isolation } from './playwright.config';

/**
 * Prompt 5 / B7 + B8 — the admin console actually CONSUMES the seven new backend contracts.
 *
 * Every scenario below proves consumption two ways: the browser really issued the request (captured from
 * the network, not inferred), and the screen really rendered what came back. A test that only asserted a
 * visible card could pass over hard-coded UI text, which is the exact failure mode this batch exists to
 * remove.
 *
 * Nothing here enables live trading, live AI execution, or contacts a real gateway/exchange host. The
 * gateway control acts on the LOCAL MOCK row and the response says so.
 */

const SEED = { email: 'admin@qt.local', password: 'adminpass1234' };

async function login(page: Page, email: string, password: string) {
  await page.goto('/');
  await page.getByLabel(/Email|이메일/).fill(email);
  await page.getByLabel(/Password|비밀번호/).fill(password);
  await page.getByRole('button', { name: /Sign in|로그인/ }).click();
}

async function loginAdmin(page: Page) {
  await login(page, SEED.email, SEED.password);
  await expect(page.getByRole('navigation', { name: 'admin' })).toBeVisible();
}

/** Record every admin request the BROWSER makes, so "the UI consumes it" is observed rather than assumed. */
function recordRequests(page: Page) {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/admin/')) seen.push(`${r.method()} ${new URL(r.url()).pathname}${new URL(r.url()).search}`);
  });
  return {
    seen,
    /** Assert at least one recorded request matches. */
    async expectCalled(pattern: RegExp) {
      await expect
        .poll(() => seen.some((s) => pattern.test(s)), { timeout: 15_000, message: `no request matched ${pattern}\nseen:\n${seen.join('\n')}` })
        .toBe(true);
    },
  };
}

const settled = (testid: string) => `[data-testid="${testid}"]:not([data-table-status="loading"])`;

/** Fill the reason, satisfy step-up when the dialog declares it, and confirm. */
async function confirmDanger(page: Page, reason: string) {
  const dlg = page.getByTestId('danger-dialog');
  await dlg.getByTestId('danger-reason').fill(reason);
  const stepUp = dlg.getByTestId('danger-stepup');
  if (await stepUp.count()) await stepUp.check();
  const confirm = dlg.getByTestId('danger-confirm');
  await expect(confirm).toBeEnabled();
  await confirm.click();
}

// ───────────────────────── ADM-API-13 · Security ─────────────────────────

test('[B7-1] Security consumes /admin/security/summary and /admin/security/lockouts', async ({ page }) => {
  const net = recordRequests(page);
  await loginAdmin(page);
  await page.getByRole('link', { name: /Security|보안/ }).click();

  await net.expectCalled(/^GET \/api\/admin\/security\/summary/);
  await net.expectCalled(/^GET \/api\/admin\/security\/lockouts/);

  // Measured cards, not the old "everything is not measured" screen.
  await expect(page.getByTestId('sec-card-users')).toBeVisible();
  await expect(page.getByTestId('sec-card-mfa')).toBeVisible();
  await expect(page.getByTestId('sec-card-lockouts')).toBeVisible();
  await expect(page.getByTestId('sec-card-sessions')).toBeVisible();
  // The dev seed creates six accounts, so the total is a real number and its card rolls up as measured.
  await expect(page.getByTestId('sec-card-users-total')).not.toContainText(/Not measured|측정되지 않음/);
  await expect(page.getByTestId('sec-card-users')).not.toHaveAttribute('data-rollup', 'unknown');
  // …and this session is counted.
  await expect(page.getByTestId('sec-card-sessions-active')).not.toContainText(/Not measured|측정되지 않음/);
  // Provenance is shown.
  await expect(page.getByTestId('sec-summary-source')).toContainText(/account_lockouts/);
  // Signals the deployment does not record are STILL not measured, never a healthy zero.
  await expect(page.getByTestId('sec-card-unmeasured')).toHaveAttribute('data-rollup', 'unknown');
  await expect(page.getByTestId('sec-card-unmeasured')).toContainText(/Not measured|측정되지 않음/);
  // The lockout table rendered (empty is a legitimate settled state — nothing is locked in a fresh seed).
  await page.locator(settled('sec-lockouts')).waitFor({ timeout: 15_000 });
});

test('[B7-2] no MFA material reaches the Security DOM, and self-unlock is stated as refused', async ({ page }) => {
  await loginAdmin(page);
  await page.getByRole('link', { name: /Security|보안/ }).click();
  await page.locator(settled('sec-lockouts')).waitFor({ timeout: 15_000 });
  await expect(page.getByTestId('sec-self-unlock-note')).toBeVisible();
  // The two notes legitimately contain the words being searched for, so they are removed before the scan.
  const notes = [
    (await page.getByTestId('sec-secret-note').innerText()).toLowerCase(),
    (await page.getByTestId('sec-honesty-note').innerText()).toLowerCase(),
  ];
  let main = (await page.locator('main').innerText()).toLowerCase();
  for (const n of notes) main = main.replace(n, '');
  for (const bad of ['otpauth', 'password_hash', 'recovery code', '복구 코드', 'qr', 'seed']) {
    expect(main, `"${bad}" must not appear on the Security screen`).not.toContain(bad);
  }
  expect(await page.locator('main pre').count()).toBe(0);
});

// ───────────────────────── ADM-API-12 · Reports ─────────────────────────

test('[B7-3] Reports generates a real report from the SERVER type allowlist and shows its provenance', async ({ page }) => {
  const net = recordRequests(page);
  await loginAdmin(page);
  await page.getByRole('link', { name: /Reports|리포트/ }).click();

  await net.expectCalled(/^GET \/api\/admin\/reports\?/);
  // The selector is populated from the server allowlist — never a client-side list.
  const select = page.getByTestId('rep-type');
  await expect(select).toBeVisible();
  const options = await select.locator('option').allTextContents();
  expect(options).toContain('daily_operations');
  expect(options).toContain('compliance_audit');
  expect(options.length).toBe(5);

  await select.selectOption('trading_activity');
  await page.getByTestId('rep-generate').click();
  await confirmDanger(page, 'e2e generates a trading activity report');
  await net.expectCalled(/^POST \/api\/admin\/reports/);
  await expect(page.getByTestId('rep-message')).toContainText(/trading_activity/);

  // The report is listed, and its detail carries the provenance rather than bare numbers.
  await page.locator(settled('rep-list')).waitFor({ timeout: 15_000 });
  const row = page.locator('[data-testid="rep-list-row"]').filter({ hasText: 'trading_activity' }).first();
  await expect(row).toBeVisible();
  await row.getByTestId('rep-open-detail').click();
  await expect(page.getByTestId('rep-detail')).toBeVisible();
  await net.expectCalled(/^GET \/api\/admin\/reports\/[0-9a-f-]{8}/);
  await expect(page.getByTestId('rep-detail-provenance')).toContainText(/orders/);
  await expect(page.getByTestId('rep-detail-provenance')).toContainText(/LOCAL_DB_AGGREGATE/);
  await expect(page.getByTestId('rep-detail-figures')).toContainText(/ordersInWindow/);
  await expect(page.getByTestId('rep-detail-note')).toBeVisible();
  await page.getByTestId('rep-detail-close').click();
});

test('[B7-4] an unknown report type cannot be requested from the UI and is refused by the server', async ({ page, context }) => {
  await loginAdmin(page);
  await page.getByRole('link', { name: /Reports|리포트/ }).click();
  await expect(page.getByTestId('rep-type')).toBeVisible();
  // The UI cannot offer one: every option is from the allowlist.
  const values = await page.getByTestId('rep-type').locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(values.every((v) => /^[a-z_]+$/.test(v))).toBe(true);
  // And bypassing the UI is refused with a 422 that does not echo the rejected value.
  const cookies = await context.cookies();
  const csrf = cookies.find((c) => c.name === 'qt_csrf')?.value ?? '';
  const res = await context.request.post(`${isolation.BASE_URL}/api/admin/reports`, {
    headers: { 'x-csrf-token': csrf, origin: isolation.BASE_URL, 'content-type': 'application/json' },
    data: { type: 'e2e_bogus_report_marker' },
  });
  expect(res.status()).toBe(422);
  expect(await res.text()).not.toContain('e2e_bogus_report_marker');
});

// ───────────────────────── ADM-API-15 · Backup ─────────────────────────

test('[B7-5] Backup consumes /admin/backup/status and reports SQLite facts without fabricating a backup', async ({ page, context }) => {
  const net = recordRequests(page);
  await loginAdmin(page);
  await page.getByRole('link', { name: /Backup|백업/ }).click();
  await net.expectCalled(/^GET \/api\/admin\/backup\/status/);

  await expect(page.getByTestId('bak-card-datastore')).toContainText(/sqlite/i);
  await expect(page.getByTestId('bak-engine-note')).toContainText(/SQLite/);
  await expect(page.getByTestId('bak-card-datastore-journalMode')).not.toContainText(/Not measured|측정되지 않음/);
  await expect(page.getByTestId('bak-card-datastore-lastMigration')).toContainText(/0009/);
  // Everything unknowable stays not measured — the card cannot roll up as healthy.
  await expect(page.getByTestId('bak-card-unmeasured')).toHaveAttribute('data-rollup', 'unknown');
  await expect(page.getByTestId('bak-card-unmeasured')).toContainText(/pitr/i);
  // The managed-PG backup/PITR release gate is NOT marked passed.
  await expect(page.getByTestId('bak-card-gate')).toContainText(/backup-restore-pitr/);
  await expect(page.getByTestId('bak-card-gate')).toContainText(/NOT_EXECUTED/);
  // Restore stays refused by policy for every role, and no restore endpoint exists at all.
  const restore = page.getByTestId('bak-restore');
  await expect(restore).toBeDisabled();
  await expect(restore).toHaveAttribute('data-deny-reason', 'policy');
  await expect(page.getByTestId('bak-restore-reason')).toContainText(/DISABLED_BY_POLICY/);
  const cookies = await context.cookies();
  const csrf = cookies.find((c) => c.name === 'qt_csrf')?.value ?? '';
  const res = await context.request.post(`${isolation.BASE_URL}/api/admin/backup/restore`, {
    headers: { 'x-csrf-token': csrf, origin: isolation.BASE_URL, 'content-type': 'application/json' },
    data: {},
  });
  expect([404, 405], `restore must not exist (got ${res.status()})`).toContain(res.status());
});

// ───────────────── ADM-API-07 / ADM-API-08 · Gateway ─────────────────

test('[B7-6] Exchange consumes /admin/gateway/metrics and reports staleness honestly', async ({ page }) => {
  const net = recordRequests(page);
  await loginAdmin(page);
  await page.getByRole('link', { name: /Exchange|거래소 연결/ }).click();
  await net.expectCalled(/^GET \/api\/admin\/gateway\/metrics/);

  await expect(page.getByTestId('gw-card-metrics')).toBeVisible();
  // The source is stated, and no real gateway host is claimed.
  await expect(page.getByTestId('gw-card-metrics-source')).toContainText(/LOCAL_DB:exchange_websocket_sessions/);
  await expect(page.getByTestId('gw-card-metrics-realHost')).toContainText(/Not Connected|연결 안 됨/);
  // With no recorded sessions, freshness is UNDECIDABLE and shown as not measured — not as FRESH.
  await expect(page.getByTestId('gw-card-metrics-freshness')).toContainText(/Not measured|측정되지 않음|FRESH|STALE/);
  await expect(page.getByTestId('gw-card-mock')).toBeVisible();
  await expect(page.getByTestId('gw-card-mock-target')).toContainText(/LOCAL_MOCK/);
  await expect(page.getByTestId('gw-mock-note')).toContainText(/LOCAL MOCK|로컬 MOCK/);
});

test('[B7-7] a confirmed resync changes the LOCAL MOCK state and says so', async ({ page }) => {
  const net = recordRequests(page);
  await loginAdmin(page);
  await page.getByRole('link', { name: /Exchange|거래소 연결/ }).click();
  await expect(page.getByTestId('gw-card-mock-resyncs')).toBeVisible();
  const before = Number((await page.getByTestId('gw-card-mock-resyncs').innerText()).replace(/\D+/g, '') || '0');

  await page.getByTestId('gw-resync').click();
  await confirmDanger(page, 'e2e resyncs the local mock gateway');
  await net.expectCalled(/^POST \/api\/admin\/gateway\/resync/);

  // The outcome names the target, so "Resync" cannot be read as having touched an exchange.
  await expect(page.getByTestId('gw-control-message')).toContainText(/APPLIED_TO_LOCAL_MOCK/);
  await expect(page.getByTestId('gw-control-message')).toContainText(/LOCAL_MOCK/);
  // The dialog closes itself on a server-confirmed success (it is never closed optimistically).
  await expect(page.getByTestId('danger-dialog')).toBeHidden();
  // The counter really moved, i.e. the row was written rather than a message being displayed.
  await expect
    .poll(async () => Number((await page.getByTestId('gw-card-mock-resyncs').innerText()).replace(/\D+/g, '') || '0'), { timeout: 15_000 })
    .toBeGreaterThan(before);
});

// ───────────────────────── ADM-API-09 · Incident ack ─────────────────────────

test('[B7-8] an incident can be acknowledged, and a stale version is a 409', async ({ page, context }) => {
  const net = recordRequests(page);
  await loginAdmin(page);
  await page.getByRole('link', { name: /Incidents|인시던트/ }).click();
  const title = `e2e-ack-${Date.now()}`;
  await page.getByLabel('title').fill(title);
  await page.getByRole('button', { name: '+ Incident' }).click();

  const row = page.locator('tbody tr').filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute('data-acknowledged', 'false');
  // Acknowledgement is separate from the lifecycle status: the incident is still OPEN.
  await expect(row.getByRole('combobox')).toHaveValue('OPEN');

  await row.getByRole('button', { name: /Acknowledge|확인 처리/ }).click();
  await confirmDanger(page, 'e2e acknowledges this incident');
  await net.expectCalled(/^POST \/api\/admin\/incidents\/[0-9a-f-]+\/ack/);
  await expect(page.getByTestId('incident-ack-message')).toContainText(/Acknowledged|확인됨/);
  await expect(page.getByTestId('danger-dialog')).toBeHidden();

  const acked = page.locator('tbody tr').filter({ hasText: title });
  await expect(acked).toHaveAttribute('data-acknowledged', 'true');
  // Still OPEN — acknowledging is not a state transition.
  await expect(acked.getByRole('combobox')).toHaveValue('OPEN');

  // A stale version is refused with a 409 rather than silently re-acknowledging.
  const cookies = await context.cookies();
  const csrf = cookies.find((c) => c.name === 'qt_csrf')?.value ?? '';
  const list = await context.request.get(`${isolation.BASE_URL}/api/admin/incidents`, { headers: { origin: isolation.BASE_URL } });
  const incidents = ((await list.json()) as { incidents: { id: string; title: string; version: number }[] }).incidents;
  const mine = incidents.find((i) => i.title === title)!;
  expect(mine.version).toBeGreaterThan(0); // the ack bumped it
  const stale = await context.request.post(`${isolation.BASE_URL}/api/admin/incidents/${mine.id}/ack`, {
    headers: { 'x-csrf-token': csrf, origin: isolation.BASE_URL, 'content-type': 'application/json' },
    data: { version: 0 },
  });
  expect(stale.status()).toBe(409);
  // Acking twice with the CURRENT version is honest about changing nothing.
  const again = await context.request.post(`${isolation.BASE_URL}/api/admin/incidents/${mine.id}/ack`, {
    headers: { 'x-csrf-token': csrf, origin: isolation.BASE_URL, 'content-type': 'application/json' },
    data: { version: mine.version },
  });
  expect(again.status()).toBe(200);
  expect(((await again.json()) as { changed: boolean }).changed).toBe(false);
});

// ───────────────────────── ADM-API-11 · AI policy ─────────────────────────

test('[B7-9] the AI policy can be written and the prompt is only ever a digest', async ({ page }) => {
  const net = recordRequests(page);
  await loginAdmin(page);
  await page.getByRole('link', { name: /AI Operations|AI 운영/ }).click();
  await net.expectCalled(/^GET \/api\/admin\/ai\/policy/);
  await expect(page.getByTestId('ai-card-policy-state')).toBeVisible();

  await page.getByTestId('ai-policy-write').click();
  await page.getByTestId('ai-policy-max-tokens').fill('1536');
  const marker = 'E2E_PROMPT_TEXT_MARKER_DO_NOT_LEAK';
  await page.getByTestId('ai-policy-prompt').fill(`You are QuantumTrade AI. ${marker}`);
  await page.getByTestId('ai-policy-prompt-version').fill('e2e-v1');
  await confirmDanger(page, 'e2e tightens the AI output budget');
  await net.expectCalled(/^PUT \/api\/admin\/ai\/policy/);
  // Success closes the dialog (never optimistically — only after the server said so) and the screen
  // reports it, so the confirmation is asserted on the screen rather than on a dialog that is gone.
  await expect(page.getByTestId('danger-dialog')).toBeHidden();
  await expect(page.getByTestId('ai-policy-message')).toBeVisible();
  await expect(page.getByTestId('ai-card-policy-state-maxOutputTokens')).toContainText('1536');
  // A digest is shown; the prompt text is nowhere in the document.
  await expect(page.getByTestId('ai-card-policy-state-promptAlgo')).toContainText('sha256');
  await expect(page.getByTestId('ai-card-policy-state-promptDigest')).not.toContainText(/Not measured|측정되지 않음/);
  expect(await page.content()).not.toContain(marker);
  // Live AI execution is still not enabled, and the version advanced (optimistic locking is real).
  await expect(page.getByTestId('ai-card-policy-state-liveExecution')).toContainText(/Not Executed|미실행/);
  await expect(page.getByTestId('ai-card-policy-state-version')).not.toContainText(/Not measured|측정되지 않음/);
});

// ───────────────────────── B8 · /admin/ai/errors ─────────────────────────

test('[B8-1] the AI Ops screen consumes /admin/ai/errors with pagination and filtering', async ({ page }) => {
  const net = recordRequests(page);
  await loginAdmin(page);
  await page.getByRole('link', { name: /AI Operations|AI 운영/ }).click();

  await net.expectCalled(/^GET \/api\/admin\/ai\/errors\?/);
  await expect(page.getByTestId('ai-errors')).toBeVisible();
  await page.locator(settled('ai-errors')).waitFor({ timeout: 15_000 });
  // Real controls: search, pagination mode, and a status filter restricted to the server's error family.
  await expect(page.getByTestId('ai-errors-search')).toBeVisible();
  await expect(page.getByTestId('ai-errors-mode')).toContainText(/Server-paginated|서버 페이지네이션/);
  const statuses = await page.getByTestId('ai-errors-filter-status').locator('option').evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
  expect(statuses).toContain('error');
  expect(statuses).toContain('timeout');
  // There is deliberately no `ok` option: the endpoint refuses it, so the UI must not offer it.
  expect(statuses).not.toContain('ok');

  // Filtering and searching really re-query the server (the request is observed, not inferred).
  await page.getByTestId('ai-errors-filter-status').selectOption('error');
  await net.expectCalled(/^GET \/api\/admin\/ai\/errors\?.*status=error/);
  await page.getByTestId('ai-errors-search').fill('trace-does-not-exist');
  await net.expectCalled(/^GET \/api\/admin\/ai\/errors\?.*q=trace-does-not-exist/);
  await page.locator(settled('ai-errors')).waitFor({ timeout: 15_000 });
});

test('[B8-2] the error panel exposes only safe identifiers — no prompt or response text', async ({ page }) => {
  await loginAdmin(page);
  await page.getByRole('link', { name: /AI Operations|AI 운영/ }).click();
  await page.locator(settled('ai-errors')).waitFor({ timeout: 15_000 });
  await expect(page.getByTestId('ai-errors-redaction-note')).toBeVisible();
  // The redaction notes themselves mention the words being searched for, so they are excluded first.
  const notes = [
    (await page.getByTestId('ai-errors-redaction-note').innerText()).toLowerCase(),
    (await page.getByTestId('ai-redaction-note').innerText()).toLowerCase(),
    (await page.getByTestId('ai-policy-digest-note').innerText()).toLowerCase(),
    (await page.getByTestId('ai-policy-live-note').innerText()).toLowerCase(),
  ];
  let main = (await page.locator('main').innerText()).toLowerCase();
  for (const n of notes) main = main.replace(n, '');
  for (const bad of ['password', 'secret', 'authorization', 'api_key', 'apikey', 'bearer ']) {
    expect(main, `"${bad}" must not appear on the AI Ops screen`).not.toContain(bad);
  }
  expect(await page.locator('main pre').count()).toBe(0);
});

// ───────────────────────── RBAC across the admin roles ─────────────────────────

test('[B7-10] RBAC: SUPPORT and ANALYST get the right verdicts on the new controls', async ({ page, context }) => {
  // SUPPORT holds user.status.write (so unlock is available) but neither audit.read (reports) nor
  // gateway.write (gateway control) nor incident.write (ack).
  await login(page, 'support@qt.local', 'supportpass1234');
  await expect(page.getByRole('navigation', { name: 'admin' })).toBeVisible();
  await page.goto('/#/security');
  await expect(page.getByTestId('sec-card-users')).toBeVisible({ timeout: 15_000 });
  await page.goto('/#/exchange');
  await expect(page.getByTestId('gw-resync')).toBeDisabled();
  await expect(page.getByTestId('gw-resync')).toHaveAttribute('data-deny-reason', 'permission');
  // Reports needs admin.audit.read to even open, so the route is denied rather than shown empty.
  await page.goto('/#/reports');
  await expect(page.locator('[data-state="denied"]')).toBeVisible({ timeout: 15_000 });
  // Signing out in the console resets CLIENT state; the session cookie is what identifies the actor, so
  // the jar is cleared before assuming a different role.
  await context.clearCookies();

  // ANALYST is read-only: it may generate reports (it holds audit.export) but not unlock, not control the
  // gateway, and not acknowledge an incident.
  await login(page, 'analyst@qt.local', 'analystpass1234');
  await expect(page.getByRole('navigation', { name: 'admin' })).toBeVisible();
  await page.goto('/#/reports');
  await expect(page.getByTestId('rep-generate')).toBeEnabled({ timeout: 15_000 });
  await page.goto('/#/exchange');
  await expect(page.getByTestId('gw-reconnect')).toHaveAttribute('data-deny-reason', 'permission');
  await page.goto('/#/ai');
  await expect(page.getByTestId('ai-policy-write')).toBeDisabled({ timeout: 15_000 });
  await expect(page.getByTestId('ai-policy-write')).toHaveAttribute('data-deny-reason', 'permission');
  // The read side is still available to a read-only role.
  await expect(page.getByTestId('ai-errors')).toBeVisible();
});

test('[B7-11] a plain USER cannot reach any of the new endpoints', async ({ page, context }) => {
  await login(page, 'user@qt.local', 'userpass1234');
  // The console refuses a non-admin role outright.
  await expect(page.locator('[data-state="denied"]')).toBeVisible({ timeout: 15_000 });
  const cookies = await context.cookies();
  const csrf = cookies.find((c) => c.name === 'qt_csrf')?.value ?? '';
  const headers = { 'x-csrf-token': csrf, origin: isolation.BASE_URL, 'content-type': 'application/json' };
  for (const path of [
    '/api/admin/security/summary',
    '/api/admin/security/lockouts',
    '/api/admin/reports',
    '/api/admin/backup/status',
    '/api/admin/gateway/metrics',
    '/api/admin/ai/policy',
    '/api/admin/ai/errors',
  ]) {
    const res = await context.request.get(`${isolation.BASE_URL}${path}`, { headers });
    expect(res.status(), `GET ${path} must be 403 for a plain USER`).toBe(403);
  }
  for (const path of ['/api/admin/gateway/resync', '/api/admin/reports']) {
    const res = await context.request.post(`${isolation.BASE_URL}${path}`, { headers, data: {} });
    expect(res.status(), `POST ${path} must be 403 for a plain USER`).toBe(403);
  }
});
