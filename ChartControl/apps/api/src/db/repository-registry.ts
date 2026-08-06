/**
 * R5 / BL-10 — repository-aware production startup guard.
 *
 * A postgres:// DATABASE_URL proves a connection string exists; it does NOT prove the application's
 * repositories actually READ AND WRITE PostgreSQL. The audit's point: with the runtime still on
 * better-sqlite3, production could pass a URL-only check and then persist everything to an ephemeral
 * SQLite file. This guard closes that gap by inspecting the ACTUAL wired repositories.
 *
 * Every required production repository declares its backend and readiness from how it was constructed by
 * the SERVER — there is no env/client boolean that can flip the decision. In production, the process
 * starts ONLY when every required repository is `backend === 'postgres'` and `productionReady === true`.
 * Until the full cutover lands, production DELIBERATELY refuses to start (honest fail-closed) rather than
 * silently running on SQLite.
 */

export type RepositoryBackend = 'sqlite' | 'postgres' | 'memory';

export interface RepositoryDescriptor {
  repositoryId: string;
  backend: RepositoryBackend;
  /** Whether this implementation is certified for production use of that backend. */
  productionReady: boolean;
}

/**
 * The persistence domains that MUST be on managed PostgreSQL in production. Sourced from the audit's
 * BL-10 list (auth/session already have PG repos; the Prompt 5 domains are the cutover backlog).
 */
export const REQUIRED_PRODUCTION_REPOSITORY_IDS = [
  'auth.users',
  'auth.sessions',
  'auth.audit',
  'mfa',
  'account_lockout',
  'favorites',
  'preferences',
  'notifications',
  'order_drafts',
  'admin_operations',
  'gateway_state',
  'ai_policy',
] as const;

export type RequiredRepositoryId = (typeof REQUIRED_PRODUCTION_REPOSITORY_IDS)[number];

export interface RepositoryReadinessResult {
  ok: boolean;
  /** repositories that block production start-up (not postgres, or not production-ready, or missing). */
  offenders: { repositoryId: string; reason: 'not_postgres' | 'not_production_ready' | 'missing' }[];
  backendSummary: Record<string, RepositoryBackend | 'missing'>;
}

/**
 * Throws in production unless EVERY required repository is a production-ready PostgreSQL implementation.
 * Returns a summary in dev/test (never throws off-production).
 */
export function assertProductionRepositoryReadiness(
  descriptors: readonly RepositoryDescriptor[],
  isProduction = process.env.NODE_ENV === 'production',
): RepositoryReadinessResult {
  const byId = new Map(descriptors.map((d) => [d.repositoryId, d]));
  const backendSummary: Record<string, RepositoryBackend | 'missing'> = {};
  const offenders: RepositoryReadinessResult['offenders'] = [];

  for (const id of REQUIRED_PRODUCTION_REPOSITORY_IDS) {
    const d = byId.get(id);
    backendSummary[id] = d ? d.backend : 'missing';
    if (!d) {
      offenders.push({ repositoryId: id, reason: 'missing' });
    } else if (d.backend !== 'postgres') {
      offenders.push({ repositoryId: id, reason: 'not_postgres' });
    } else if (!d.productionReady) {
      offenders.push({ repositoryId: id, reason: 'not_production_ready' });
    }
  }

  const result: RepositoryReadinessResult = { ok: offenders.length === 0, offenders, backendSummary };

  if (isProduction && !result.ok) {
    const detail = offenders.map((o) => `${o.repositoryId}=${o.reason}`).join(', ');
    throw new Error(
      'fail-closed startup: production requires every persistence repository on managed PostgreSQL, but ' +
        `the following are not production-ready PostgreSQL: ${detail}. ` +
        'A postgres:// DATABASE_URL alone is insufficient — the wired repositories must be PostgreSQL ' +
        '(see BL-10 runtime cutover). Production refuses to start rather than persist to SQLite.',
    );
  }
  return result;
}
