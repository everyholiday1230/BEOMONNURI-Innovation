import { test, expect, type Page } from '@playwright/test';

/**
 * B2 — favourites and preferences persistence (FAV-01/02, PREF-01/02).
 *
 * The claim under test is specifically SERVER persistence, so localStorage is cleared between the write
 * and the read. If the set came back from the local cache the assertion would pass for the wrong reason,
 * which is exactly the failure mode Prompt 3 shipped and Prompt 5 is meant to fix.
 */

/**
 * Register and sign in a FRESH user.
 *
 * The user E2E config does not seed accounts (unlike the admin suite), and a per-test account also keeps
 * the favourites assertions independent — a shared account would let one test's set leak into another's.
 */
async function signIn(page: Page): Promise<string> {
  const email = `b2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@ex.com`;
  const password = 'e2e-fixture-not-a-secret'; // low-entropy test fixture (min-10 policy); intentionally not secret-shaped

  // Sign up. Both the signup and the login screen label their primary button "Sign in"
  // (`action.signIn` / `nav.login` resolve to the same string), so the button is located by position
  // within the form rather than by an ambiguous accessible name.
  await page.goto('/signup');
  await page.getByLabel('email').fill(email);
  await page.getByLabel('password').fill(password);
  await page.getByLabel('confirm').fill(password);
  await page.locator('button.btn--primary').first().click();
  await expect(page.getByTestId('signup-ok')).toBeVisible({ timeout: 20_000 });

  // Log in explicitly so the session is deterministic regardless of whether signup auto-authenticates.
  await page.goto('/login');
  await page.getByLabel('email').fill(email);
  await page.getByLabel('password').fill(password);
  await page.locator('button.btn--primary').first().click();

  // Prove the session really exists before any assertion depends on it.
  await expect
    .poll(async () => page.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'include' })).status), {
      timeout: 20_000,
    })
    .toBe(200);
  return email;
}


/**
 * Mint a CSRF token.
 *
 * The `qt_csrf` cookie is only set by `GET /auth/csrf` (login alone does not set it), so reading
 * `document.cookie` before calling that endpoint yields nothing and every mutation is a 403 — which is
 * correct server behaviour, and exactly what [B2-4] asserts.
 */
async function csrfToken(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const r = await fetch('/api/auth/csrf', { credentials: 'include' });
    const b = (await r.json()) as { csrfToken: string | null };
    return b.csrfToken ?? '';
  });
}

/** Read the favourites the SERVER holds for this session, bypassing the UI and the local cache. */
async function serverFavorites(page: Page): Promise<{ symbols: string[]; version: number } | { status: number }> {
  return page.evaluate(async () => {
    const r = await fetch('/api/me/favorites', { credentials: 'include' });
    if (!r.ok) return { status: r.status };
    return (await r.json()) as { symbols: string[]; version: number };
  });
}

test.describe('[B2] favourites persistence', () => {
  test('[B2-1] a favourite written by the UI is stored server-side, not just in localStorage', async ({ page }) => {
    await signIn(page);
    // The Market Watch widget renders a star per row (`mw-star-*`); the symbol header has one too.
    await page.goto('/trade');
    const star = page.locator('[data-testid^="mw-star-"], [data-testid="symbol-favorite"]').first();
    await expect(star).toBeVisible({ timeout: 20_000 });
    await star.click();

    // Ask the SERVER directly — a localStorage-only write would leave this empty.
    await expect
      .poll(async () => {
        const res = await serverFavorites(page);
        return 'symbols' in res ? res.symbols.length : -1;
      }, { timeout: 20_000 })
      .toBeGreaterThan(0);

    const res = await serverFavorites(page);
    expect('symbols' in res).toBe(true);
    if ('symbols' in res) {
      expect(res.version).toBeGreaterThan(0);
      // Clicking the same star again removes it, and that removal is also persisted.
      await star.click();
      await expect
        .poll(async () => {
          const again = await serverFavorites(page);
          return 'symbols' in again ? again.symbols.length : -1;
        }, { timeout: 20_000 })
        .toBe(0);
    }
  });

  test('[B2-2] the set survives a reload with localStorage cleared', async ({ page }) => {
    await signIn(page);
    // Write directly through the API so the test does not depend on which control renders the star.
    const token = await csrfToken(page);
    const put = await page.evaluate(async (csrf) => {
      const r = await fetch('/api/me/favorites', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ symbols: ['ETHUSDT'] }),
      });
      return { status: r.status, body: r.ok ? await r.json() : null };
    }, token);
    expect(put.status).toBe(200);

    // Wipe every client-side cache, then reload. Anything that comes back came from the server.
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload();
    // The reload lands on whatever route was current; wait for the session probe rather than a specific
    // chrome element, so this does not depend on which screen renders.
    await expect
      .poll(async () => page.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'include' })).status), {
        timeout: 20_000,
      })
      .toBe(200);

    const res = await serverFavorites(page);
    expect('symbols' in res && res.symbols).toEqual(['ETHUSDT']);
    // …and the client adopted the server set into its cache (proving `loadFromServer` ran, not that the
    // value merely survived in localStorage — it was cleared above).
    await page.goto('/markets');
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const k = Object.keys(localStorage).find((key) => key.includes('favorites'));
            return k ? localStorage.getItem(k) : null;
          }),
        { timeout: 20_000 },
      )
      .toContain('ETHUSDT');
  });

  test('[B2-3] a stale If-Match is a 409 and does not overwrite', async ({ page }) => {
    await signIn(page);
    const token = await csrfToken(page);
    const out = await page.evaluate(async (csrf) => {
      const h = { 'content-type': 'application/json', 'x-csrf-token': csrf };
      const first = await fetch('/api/me/favorites', {
        method: 'PUT', credentials: 'include', headers: h, body: JSON.stringify({ symbols: ['BTCUSDT'] }),
      });
      const firstBody = (await first.json()) as { version: number };
      // Replay the PUT with the version that is now stale.
      const stale = await fetch('/api/me/favorites', {
        method: 'PUT',
        credentials: 'include',
        headers: { ...h, 'if-match': String(firstBody.version - 1) },
        body: JSON.stringify({ symbols: ['ETHUSDT'] }),
      });
      const after = await (await fetch('/api/me/favorites', { credentials: 'include' })).json();
      return { staleStatus: stale.status, after };
    }, token);
    expect(out.staleStatus).toBe(409);
    // The first writer's value survived the refused write.
    expect((out.after as { symbols: string[] }).symbols).toEqual(['BTCUSDT']);
  });

  test('[B2-4] a write without a CSRF token is refused and persists nothing', async ({ page }) => {
    await signIn(page);
    const out = await page.evaluate(async () => {
      const before = await (await fetch('/api/me/favorites', { credentials: 'include' })).json();
      const res = await fetch('/api/me/favorites', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' }, // no x-csrf-token
        body: JSON.stringify({ symbols: ['NOPEUSDT'] }),
      });
      const after = await (await fetch('/api/me/favorites', { credentials: 'include' })).json();
      return { status: res.status, before, after };
    });
    expect(out.status).toBe(403);
    expect((out.after as { symbols: string[] }).symbols).toEqual((out.before as { symbols: string[] }).symbols);
  });
});

test.describe('[B2] preferences persistence', () => {
  test('[B2-5] a partial preference update does not erase other fields', async ({ page }) => {
    await signIn(page);
    const token = await csrfToken(page);
    const out = await page.evaluate(async (csrf) => {
      const h = { 'content-type': 'application/json', 'x-csrf-token': csrf };
      await fetch('/api/account/preferences', {
        method: 'PUT', credentials: 'include', headers: h, body: JSON.stringify({ theme: 'dark', locale: 'ko' }),
      });
      await fetch('/api/account/preferences', {
        method: 'PUT', credentials: 'include', headers: h, body: JSON.stringify({ theme: 'light' }),
      });
      return (await (await fetch('/api/account/preferences', { credentials: 'include' })).json()) as {
        preferences: { theme: string; locale: string } | null; version: number;
      };
    }, token);
    expect(out.preferences?.theme).toBe('light');
    // The regression: locale used to be nulled by any partial write.
    expect(out.preferences?.locale).toBe('ko');
    expect(out.version).toBeGreaterThanOrEqual(2);
  });

  test('[B2-6] an unknown preference key is refused, not silently stored', async ({ page }) => {
    await signIn(page);
    const token = await csrfToken(page);
    const status = await page.evaluate(async (csrf) => {
      const r = await fetch('/api/account/preferences', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({ isAdmin: true }),
      });
      return r.status;
    }, token);
    expect(status).toBe(400);
  });
});
