/**
 * DEV / E2E ONLY — admin + user seed fixtures.
 *
 * This module is deliberately OUTSIDE the production import graph (Phase 7 §3). It holds the only
 * copy of the development fixture credentials, and it must never be reachable from
 * `apps/api/src/index.ts` through a statically analyzable import:
 *
 *  - `apps/api/tsup.config.ts` bundles ONLY `src/index.ts`; nothing here is referenced by it.
 *  - `src/index.ts` reaches this file through a specifier assembled at runtime, so esbuild cannot
 *    resolve it and therefore cannot inline it into `dist/index.js`. This is verified by an actual
 *    scan of the built artifact, not assumed — see `scripts/phase7-artifact-scan.sh` and
 *    `apps/api/src/__tests__/production-artifact.test.ts`.
 *  - The runtime container image copies `apps/api/dist` + production `node_modules` only
 *    (`infrastructure/docker/Dockerfile.api`), so this source file is not present in the image.
 *
 * Every entry point into this module refuses to run when `NODE_ENV === 'production'`.
 */

/** Thrown when a dev-only seed path is invoked in a production runtime. */
export class DevSeedForbiddenError extends Error {
  readonly code = 'DEV_SEED_FORBIDDEN';
  constructor() {
    super('dev seed is forbidden when NODE_ENV=production');
    this.name = 'DevSeedForbiddenError';
  }
}

export interface DevSeedUser {
  email: string;
  password: string;
  /** Admin role to grant, or null for a plain USER. */
  role: string | null;
  /** Why the fixture exists — disposable fixtures are mutated by E2E scenarios. */
  purpose: 'rbac-stable' | 'disposable';
}

/**
 * The dev fixture set. Mirrors `docs/PHASE7-03-SECRET-IAM-KMS.md` §"dev fixture identities".
 * SHA-256 digests of these e-mail addresses (and ONLY the digests) are compiled into the production
 * bundle so a production database can be checked for their presence without shipping the plaintext.
 * Keep `apps/api/src/security/dev-fixture-guard.ts` in sync — a unit test asserts they match.
 */
export const DEV_SEED_USERS: readonly DevSeedUser[] = [
  { email: 'admin@qt.local', password: 'adminpass1234', role: 'SUPER_ADMIN', purpose: 'rbac-stable' },
  { email: 'user@qt.local', password: 'userpass1234', role: null, purpose: 'rbac-stable' },
  { email: 'support@qt.local', password: 'supportpass1234', role: 'SUPPORT', purpose: 'rbac-stable' },
  { email: 'analyst@qt.local', password: 'analystpass1234', role: 'ANALYST', purpose: 'rbac-stable' },
  { email: 'disable-me@qt.local', password: 'disablepass1234', role: null, purpose: 'disposable' },
  { email: 'role-me@qt.local', password: 'rolepass1234', role: null, purpose: 'disposable' },
];

export interface DevSeedDeps {
  /** Auth service used to register the fixture accounts. */
  register(input: { email: string; password: string }): Promise<unknown>;
  /** Resolve a user id by e-mail (returns undefined if absent). */
  findUserId(email: string): string | undefined;
  /** Grant an admin role to a user id. */
  setUserRole(userId: string, role: string): void;
  /** Record the seed marker flag so operators can see a database was seeded. */
  markSeeded(): void;
  /** Structured log sink (no credentials are ever passed to it). */
  log?(message: string): void;
}

/**
 * Seed the dev/E2E fixtures. Refuses to run in production regardless of any other flag.
 * Returns the number of fixtures processed; never returns or logs a credential.
 */
export async function runDevSeed(deps: DevSeedDeps, nodeEnv = process.env.NODE_ENV): Promise<number> {
  if (nodeEnv === 'production') throw new DevSeedForbiddenError();

  let processed = 0;
  for (const fixture of DEV_SEED_USERS) {
    // Re-running is idempotent: an existing account simply fails registration and is skipped.
    await deps.register({ email: fixture.email, password: fixture.password }).catch(() => {});
    if (fixture.role) {
      const id = deps.findUserId(fixture.email);
      if (id) deps.setUserRole(id, fixture.role);
    }
    processed += 1;
  }
  deps.markSeeded();
  deps.log?.(`[api] DEV admin seed ready (${processed} fixtures: SUPER_ADMIN/SUPPORT/ANALYST + USERs)`);
  return processed;
}
