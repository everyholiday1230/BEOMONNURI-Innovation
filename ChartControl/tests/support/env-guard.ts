import { createServer } from 'node:net';
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Phase 7 §5 — Playwright environment isolation.
 *
 * A previous regression run reported a false `e2e:admin` failure because
 * `reuseExistingServer: !process.env.CI` let Playwright adopt a **manually started** dev server that
 * was bound to the same port and wired to a different, persistent database. The suite was measuring
 * someone else's process.
 *
 * This module supplies the primitives that make that impossible:
 *   - `strictIsolation()`      — is this a CI / release-verification run (no reuse allowed)?
 *   - `assertPortFree()`       — fail immediately if anything already answers on a port
 *   - `port()`                 — per-suite port, overridable so parallel runs never collide
 *   - `ephemeralSqlitePath()`  — a throwaway database per run
 *   - `buildSha()`             — the commit the servers must report back
 *   - `assertServerIdentity()` — the served app is ours, at the expected SHA, on the expected URL
 */

/** Reuse is opt-in and never available under CI or release verification. */
export function strictIsolation(): boolean {
  if (process.env.PW_ALLOW_REUSE === '1') return false;
  return true;
}

export function reuseExistingServer(): boolean {
  // Default false: an already-running server is an error, not a convenience.
  return !strictIsolation();
}

/** Resolve a port from the environment with a documented default. */
export function port(envVar: string, fallback: number): number {
  const raw = process.env[envVar];
  const n = raw ? Number(raw) : fallback;
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`${envVar}=${raw} is not a valid TCP port`);
  }
  return n;
}

/**
 * Reject the run if a port is already occupied. Under strict isolation an occupied port means some
 * other process would be measured, so this throws instead of silently reusing it.
 */
export async function assertPortFree(p: number, label: string): Promise<void> {
  if (!strictIsolation()) return;
  await new Promise<void>((resolve, reject) => {
    const srv = createServer();
    srv.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
        reject(
          new Error(
            `PORT ${p} (${label}) IS ALREADY IN USE. Refusing to run: Playwright would adopt that ` +
              `process and the results would describe it, not this build. Stop the process on port ` +
              `${p} (e.g. a manually started \`pnpm dev\`), or set a different port via the ` +
              `corresponding *_PORT variable. Reuse can only be enabled deliberately with ` +
              `PW_ALLOW_REUSE=1, which is never set in CI.`,
          ),
        );
      } else reject(err);
    });
    srv.once('listening', () => srv.close(() => resolve()));
    srv.listen(p, '127.0.0.1');
  });
}

/** A throwaway SQLite path so no run can see another run's rows. */
export function ephemeralSqlitePath(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), `qt-e2e-${prefix}-`));
  return join(dir, 'e2e.db');
}

/** The commit the servers under test must report. */
export function buildSha(): string {
  if (process.env.GIT_SHA) return process.env.GIT_SHA;
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export interface ServerIdentityExpectation {
  /** Base URL the suite will drive. */
  baseUrl: string;
  /** Mount element id the served HTML must contain (`root` for the web app, `admin-root` for admin). */
  rootElementId: string;
  /** API origin that must answer `/health/ready`. */
  apiUrl: string;
  /** Commit the API must report as its build version. */
  expectedSha: string;
  /** Fail if the API reports live trading enabled — no suite may run against a live-trading server. */
  requireLiveTradingDisabled?: boolean;
}

/**
 * Verify the servers actually under test: the base URL serves our app, the API is the build we just
 * made, and live trading is off. Any mismatch fails loudly rather than producing results that
 * describe a foreign process.
 */
export async function assertServerIdentity(e: ServerIdentityExpectation): Promise<void> {
  // 1) Base URL must serve our HTML shell.
  const page = await fetch(e.baseUrl, { redirect: 'follow' });
  if (!page.ok) {
    throw new Error(`base URL ${e.baseUrl} answered HTTP ${page.status}; expected the app shell`);
  }
  const html = await page.text();
  if (!html.includes(`id="${e.rootElementId}"`)) {
    throw new Error(
      `base URL ${e.baseUrl} did not serve the expected app shell (no #${e.rootElementId} element). ` +
        'Another server is answering on this port.',
    );
  }

  // 2) API must be reachable and report the expected build.
  const readyRes = await fetch(`${e.apiUrl}/health/ready`);
  if (!readyRes.ok) {
    throw new Error(`${e.apiUrl}/health/ready answered HTTP ${readyRes.status}`);
  }
  const ready = (await readyRes.json()) as {
    status?: string;
    version?: string;
    liveTradingEnabled?: boolean;
  };
  if (ready.status !== 'ok') {
    throw new Error(`${e.apiUrl}/health/ready status=${String(ready.status)}; expected "ok"`);
  }

  if (strictIsolation() && e.expectedSha !== 'unknown') {
    if (ready.version !== e.expectedSha) {
      throw new Error(
        `SERVER BUILD MISMATCH: ${e.apiUrl} reports version="${String(ready.version)}" but this run ` +
          `expects "${e.expectedSha}". A different (probably manually started) server is bound to ` +
          'this port. Stop it and re-run.',
      );
    }
  }

  // 3) No suite may run against a server with live trading enabled.
  if (e.requireLiveTradingDisabled !== false && ready.liveTradingEnabled === true) {
    throw new Error(
      `${e.apiUrl} reports liveTradingEnabled=true. Refusing to run any E2E suite against a ` +
        'live-trading server.',
    );
  }
}
