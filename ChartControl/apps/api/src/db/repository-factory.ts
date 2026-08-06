import type { Pool } from 'pg';
import type {
  IAuditRepository,
  ISessionRepository,
  ITokenRepository,
  IUserRepository,
} from '@quantumtrade/auth';
import type { DB } from './sqlite';
import { SqliteAuditRepository, SqliteSessionRepository, SqliteTokenRepository, SqliteUserRepository } from './repos';
import { PgAuditRepository, PgSessionRepository, PgTokenRepository, PgUserRepository } from './pg-repos';
import { PgMfaRepo, SqliteMfaRepo, type IMfaRepo } from './mfa-repo';
import { PgLockoutStore, SqliteLockoutStore, type LockoutStore } from './lockout-repo';
import { SqliteFavoritesRepo, PgFavoritesRepo, type IFavoritesRepo } from './favorites-repo';
import { SqlitePreferencesRepo, PgPreferencesRepo, type IPreferencesRepo } from './preferences-repo';
import { SqliteNotificationRepo, PgNotificationRepo, type INotificationRepo } from './notification-repo';
import { SqliteOrderDraftRepo, PgOrderDraftRepo, type IOrderDraftRepo } from './order-draft-repo';
import { SqliteAdminRepo } from './admin-repos';
import { SqliteAdminRepoAdapter, PgAdminRepo, type IAdminRepo } from './admin-repo-contract';
import { ResourceRepo } from './resource-repo';
import { createPool } from './pg';
import type { RepositoryBackend, RepositoryDescriptor } from './repository-registry';

/**
 * BATCH_1 / BL-10 — core identity repository FACTORY.
 *
 * This is the single place that decides which backend the identity domains (users, sessions, auth audit,
 * verification/reset tokens, MFA credentials/challenges, account lockout) actually run on. Two properties
 * matter more than the code itself:
 *
 *  1. The decision is made by the SERVER from `NODE_ENV` + `DATABASE_URL` only. There is no argument,
 *     header, body field or feature flag that can select a backend, so a request cannot talk the process
 *     into persisting identity somewhere else.
 *  2. There is NO production SQLite fallback. In production a missing/non-postgres `DATABASE_URL` throws
 *     during construction instead of quietly opening the local file — the failure mode the audit called
 *     out (RDS provisioned, application still writing to an ephemeral SQLite file) is unreachable.
 *
 * Development, test and E2E stay on SQLite unconditionally, which is what keeps the existing E2E suites
 * running unchanged against `:memory:` / `.data/quantumtrade.db`.
 *
 * The factory also REPORTS what it built (`descriptors`). The production startup guard consumes that
 * report rather than a constant, so the guard's answer is derived from the wiring that actually happened.
 */

/** Repository ids owned by Batch 1 (must match `REQUIRED_PRODUCTION_REPOSITORY_IDS` spellings). */
export const BATCH_1_REPOSITORY_IDS = ['auth.users', 'auth.sessions', 'auth.audit', 'mfa', 'account_lockout'] as const;

/** Batch 1 also cuts the token repos over; they are not in the required list, so they are reported extra. */
export const BATCH_1_SUPPLEMENTAL_REPOSITORY_IDS = ['auth.tokens.email_verification', 'auth.tokens.password_reset'] as const;

export interface CoreIdentityRepositories {
  backend: RepositoryBackend;
  users: IUserRepository;
  sessions: ISessionRepository;
  audit: IAuditRepository;
  emailTokens: ITokenRepository;
  resetTokens: ITokenRepository;
  mfa: IMfaRepo;
  lockouts: LockoutStore;
  /** Present only for the postgres backend (owned by the caller's shutdown path). */
  pool?: Pool;
  /** What was ACTUALLY constructed — fed to `assertProductionRepositoryReadiness`. */
  descriptors: RepositoryDescriptor[];
  close(): Promise<void>;
}

export interface CoreIdentityFactoryOptions {
  /** SQLite handle used by the dev/test backend. Required because dev/E2E must stay on SQLite. */
  db: DB;
  isProduction: boolean;
  databaseUrl?: string;
  /** Injected in tests so a contract/guard test can exercise the postgres branch without a real dial. */
  poolFactory?: (connectionString: string) => Pool;
}

function descriptorsFor(backend: RepositoryBackend): RepositoryDescriptor[] {
  // `productionReady` is true only for postgres: these implementations are certified for production on
  // PostgreSQL and explicitly NOT certified on SQLite (that is the whole point of the guard).
  const productionReady = backend === 'postgres';
  return [...BATCH_1_REPOSITORY_IDS, ...BATCH_1_SUPPLEMENTAL_REPOSITORY_IDS].map((repositoryId) => ({
    repositoryId,
    backend,
    productionReady,
  }));
}

export function createCoreIdentityRepositories(opts: CoreIdentityFactoryOptions): CoreIdentityRepositories {
  if (opts.isProduction) {
    const url = opts.databaseUrl?.trim();
    if (!url || !/^postgres(ql)?:\/\//i.test(url)) {
      // Fail-closed, NOT a fallback: production identity persistence has exactly one supported backend.
      throw new Error(
        'fail-closed startup: production core identity repositories require a postgres:// DATABASE_URL ' +
          '(users/sessions/audit/tokens/MFA/account_lockout). SQLite is refused in production — see BL-10 ' +
          'Batch 1 cutover.',
      );
    }
    const pool = (opts.poolFactory ?? createPool)(url);
    return {
      backend: 'postgres',
      users: new PgUserRepository(pool),
      sessions: new PgSessionRepository(pool),
      audit: new PgAuditRepository(pool),
      emailTokens: new PgTokenRepository(pool, 'email_verification_tokens'),
      resetTokens: new PgTokenRepository(pool, 'password_reset_tokens'),
      mfa: new PgMfaRepo(pool),
      lockouts: new PgLockoutStore(pool),
      pool,
      descriptors: descriptorsFor('postgres'),
      close: async () => { await pool.end(); },
    };
  }

  // Development / test / E2E — SQLite, unconditionally.
  return {
    backend: 'sqlite',
    users: new SqliteUserRepository(opts.db),
    sessions: new SqliteSessionRepository(opts.db),
    audit: new SqliteAuditRepository(opts.db),
    emailTokens: new SqliteTokenRepository(opts.db, 'email_verification_tokens'),
    resetTokens: new SqliteTokenRepository(opts.db, 'password_reset_tokens'),
    mfa: new SqliteMfaRepo(opts.db),
    lockouts: new SqliteLockoutStore(opts.db),
    descriptors: descriptorsFor('sqlite'),
    close: async () => {},
  };
}

/* ────────────────────────── BATCH 2 — user/trading persistence ────────────────────────── */

/** Repository ids owned by Batch 2 (must match `REQUIRED_PRODUCTION_REPOSITORY_IDS` spellings). */
export const BATCH_2_REPOSITORY_IDS = ['favorites', 'preferences', 'notifications', 'order_drafts'] as const;

export interface UserDataRepositories {
  backend: RepositoryBackend;
  favorites: IFavoritesRepo;
  preferences: IPreferencesRepo;
  notifications: INotificationRepo;
  orderDrafts: IOrderDraftRepo;
  /** What was ACTUALLY constructed — fed to `assertProductionRepositoryReadiness`. */
  descriptors: RepositoryDescriptor[];
}

export interface UserDataFactoryOptions {
  db: DB;
  isProduction: boolean;
  /**
   * The PostgreSQL pool created by the core-identity factory. Reused here so the whole process shares ONE
   * pool rather than opening a second. Required in production; ignored in dev/test (SQLite).
   */
  pool?: Pool;
}

function descriptorsFor2(backend: RepositoryBackend): RepositoryDescriptor[] {
  const productionReady = backend === 'postgres';
  return [...BATCH_2_REPOSITORY_IDS].map((repositoryId) => ({ repositoryId, backend, productionReady }));
}

/**
 * BATCH_2 / BL-10 — user/trading persistence FACTORY (favorites, preferences, notifications, order
 * drafts). Same guarantees as Batch 1: the SERVER picks the backend from NODE_ENV (never client input),
 * and there is NO production SQLite fallback — production without a PostgreSQL pool throws during
 * construction instead of quietly writing to the local file. Reports `descriptors` so the startup guard's
 * answer is derived from the wiring that actually happened.
 */
export function createUserDataRepositories(opts: UserDataFactoryOptions): UserDataRepositories {
  if (opts.isProduction) {
    if (!opts.pool) {
      throw new Error(
        'fail-closed startup: production user/trading repositories (favorites/preferences/notifications/' +
          'order_drafts) require the PostgreSQL pool. SQLite is refused in production — see BL-10 Batch 2.',
      );
    }
    return {
      backend: 'postgres',
      favorites: new PgFavoritesRepo(opts.pool),
      preferences: new PgPreferencesRepo(opts.pool),
      notifications: new PgNotificationRepo(opts.pool),
      orderDrafts: new PgOrderDraftRepo(opts.pool),
      descriptors: descriptorsFor2('postgres'),
    };
  }
  const resource = new ResourceRepo(opts.db);
  return {
    backend: 'sqlite',
    favorites: new SqliteFavoritesRepo(resource),
    preferences: new SqlitePreferencesRepo(resource),
    notifications: new SqliteNotificationRepo(opts.db),
    orderDrafts: new SqliteOrderDraftRepo(opts.db),
    descriptors: descriptorsFor2('sqlite'),
  };
}

/* ────────────────────────── BATCH 3 — admin / gateway / ai-policy ────────────────────────── */

/**
 * Repository ids owned by Batch 3. One repository serves all three domains, so it reports three
 * descriptors (all sharing the same backend). Spellings must match `REQUIRED_PRODUCTION_REPOSITORY_IDS`.
 */
export const BATCH_3_REPOSITORY_IDS = ['admin_operations', 'gateway_state', 'ai_policy'] as const;

export interface AdminRepositories {
  backend: RepositoryBackend;
  admin: IAdminRepo;
  descriptors: RepositoryDescriptor[];
}

function descriptorsFor3(backend: RepositoryBackend): RepositoryDescriptor[] {
  const productionReady = backend === 'postgres';
  return [...BATCH_3_REPOSITORY_IDS].map((repositoryId) => ({ repositoryId, backend, productionReady }));
}

/**
 * BATCH_3 / BL-10 — admin/gateway/ai-policy persistence FACTORY. Same guarantees as Batch 1/2: the SERVER
 * picks the backend, there is NO production SQLite fallback (production without a pool throws), and the
 * PostgreSQL pool is the ONE created by the core-identity factory (no second client). Reports three
 * descriptors so the startup guard's answer for admin_operations/gateway_state/ai_policy is derived from
 * the wiring that actually happened.
 */
export function createAdminRepositories(opts: { db: DB; isProduction: boolean; pool?: Pool }): AdminRepositories {
  if (opts.isProduction) {
    if (!opts.pool) {
      throw new Error(
        'fail-closed startup: production admin/gateway/ai-policy repositories (admin_operations/gateway_state/' +
          'ai_policy) require the PostgreSQL pool. SQLite is refused in production — see BL-10 Batch 3.',
      );
    }
    return { backend: 'postgres', admin: new PgAdminRepo(opts.pool), descriptors: descriptorsFor3('postgres') };
  }
  return { backend: 'sqlite', admin: new SqliteAdminRepoAdapter(new SqliteAdminRepo(opts.db)), descriptors: descriptorsFor3('sqlite') };
}
