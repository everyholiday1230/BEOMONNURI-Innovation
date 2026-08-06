import { isolation } from './playwright.config';

/**
 * BL-13 — server-readiness WARM-UP, separate from any per-assertion timeout.
 *
 * Playwright's `webServer.url` already gates on the servers answering, but this adds an explicit,
 * generously-timed readiness + warm-up pass that is distinct from the 10s `expect.timeout`:
 *   1. the BFF `/health` returns ok, and
 *   2. the prebuilt admin shell serves its HTML entry (a first GET that primes the static server and the
 *      HTTP keep-alive path before the first test navigates).
 *
 * It does NOT touch auth/RBAC/CSRF and it does NOT suppress errors — a server that never becomes ready
 * fails the run here (fast, clearly attributed) rather than surfacing later as a flaky assertion timeout.
 */
async function waitFor(label: string, url: string, ok: (r: Response) => boolean, budgetMs: number): Promise<void> {
  const deadline = Date.now() + budgetMs;
  let lastErr = '';
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url, { redirect: 'manual' });
      if (ok(r)) return;
      lastErr = `status ${r.status}`;
    } catch (e) {
      lastErr = (e as Error).message;
    }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`[admin-e2e warmup] ${label} not ready within ${budgetMs}ms (${url}): ${lastErr}`);
}

export default async function globalSetup(): Promise<void> {
  const READY_BUDGET_MS = 60_000; // server-readiness budget — independent of expect.timeout (10s).
  await waitFor('BFF /health', `${isolation.API_URL}/health`, (r) => r.ok, READY_BUDGET_MS);
  // Prime the prebuilt admin shell (HTML entry). <400 or 401 both mean "serving".
  await waitFor('admin shell', isolation.BASE_URL, (r) => r.status < 400 || r.status === 401, READY_BUDGET_MS);
}
