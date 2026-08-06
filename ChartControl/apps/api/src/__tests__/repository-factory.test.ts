import { describe, it, expect } from 'vitest';
import type { Pool } from 'pg';
import { openDb } from '../db/sqlite';
import {
  createCoreIdentityRepositories,
  BATCH_1_REPOSITORY_IDS,
  BATCH_1_SUPPLEMENTAL_REPOSITORY_IDS,
  createUserDataRepositories,
  BATCH_2_REPOSITORY_IDS,
  createAdminRepositories,
  BATCH_3_REPOSITORY_IDS,
} from '../db/repository-factory';
import {
  assertProductionRepositoryReadiness,
  REQUIRED_PRODUCTION_REPOSITORY_IDS,
  type RepositoryDescriptor,
} from '../db/repository-registry';
import { SqliteMfaRepo, PgMfaRepo } from '../db/mfa-repo';
import { SqliteLockoutStore, PgLockoutStore } from '../db/lockout-repo';
import { PgUserRepository, PgSessionRepository, PgAuditRepository, PgTokenRepository } from '../db/pg-repos';
import { SqliteUserRepository, SqliteSessionRepository, SqliteAuditRepository, SqliteTokenRepository } from '../db/repos';

/**
 * BATCH_1 — the factory decides the backend, and the startup guard reads what the factory ACTUALLY built.
 *
 * The property that matters most here is the negative one: Batch 1 being complete is NOT enough to start
 * production. A partially-migrated persistence layer must keep failing closed, because the domains still
 * on SQLite would otherwise persist to an ephemeral file in production. These tests would fail if someone
 * "finished" the cutover by flipping a flag instead of wiring Batch 2/3.
 */

// A pool object is never dialled in these tests — the factory only needs to hold the reference.
const fakePool = () => ({}) as Pool;

describe('BATCH_1 repository factory — backend selection', () => {
  it('dev/test selects SQLite for every core identity repository', () => {
    const db = openDb(':memory:');
    const core = createCoreIdentityRepositories({ db, isProduction: false, databaseUrl: undefined });
    expect(core.backend).toBe('sqlite');
    expect(core.users).toBeInstanceOf(SqliteUserRepository);
    expect(core.sessions).toBeInstanceOf(SqliteSessionRepository);
    expect(core.audit).toBeInstanceOf(SqliteAuditRepository);
    expect(core.emailTokens).toBeInstanceOf(SqliteTokenRepository);
    expect(core.resetTokens).toBeInstanceOf(SqliteTokenRepository);
    expect(core.mfa).toBeInstanceOf(SqliteMfaRepo);
    expect(core.lockouts).toBeInstanceOf(SqliteLockoutStore);
    expect(core.pool).toBeUndefined();
  });

  it('dev/test stays on SQLite EVEN IF a postgres DATABASE_URL is present (E2E must not drift)', () => {
    const db = openDb(':memory:');
    const core = createCoreIdentityRepositories({
      db,
      isProduction: false,
      databaseUrl: 'postgres://user:pw@localhost:5432/whatever',
      poolFactory: () => { throw new Error('dev must not build a pool'); },
    });
    expect(core.backend).toBe('sqlite');
  });

  it('production selects PostgreSQL for every core identity repository', () => {
    const db = openDb(':memory:');
    const core = createCoreIdentityRepositories({
      db,
      isProduction: true,
      databaseUrl: 'postgres://user:pw@rds.example.com:5432/qt',
      poolFactory: fakePool,
    });
    expect(core.backend).toBe('postgres');
    expect(core.users).toBeInstanceOf(PgUserRepository);
    expect(core.sessions).toBeInstanceOf(PgSessionRepository);
    expect(core.audit).toBeInstanceOf(PgAuditRepository);
    expect(core.emailTokens).toBeInstanceOf(PgTokenRepository);
    expect(core.resetTokens).toBeInstanceOf(PgTokenRepository);
    expect(core.mfa).toBeInstanceOf(PgMfaRepo);
    expect(core.lockouts).toBeInstanceOf(PgLockoutStore);
  });

  it('production REFUSES to fall back to SQLite when DATABASE_URL is missing or not postgres', () => {
    const db = openDb(':memory:');
    for (const databaseUrl of [undefined, '', '   ', 'sqlite:///tmp/x.db', 'mysql://h/db', 'file:./local.db']) {
      expect(() =>
        createCoreIdentityRepositories({ db, isProduction: true, databaseUrl, poolFactory: fakePool }),
      ).toThrow(/fail-closed startup/);
    }
  });

  it('the factory error names the domains at stake and never echoes the connection string', () => {
    const db = openDb(':memory:');
    try {
      createCoreIdentityRepositories({ db, isProduction: true, databaseUrl: 'mysql://root:sekret@h/db', poolFactory: fakePool });
      throw new Error('should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toMatch(/account_lockout|MFA/i);
      expect(msg).not.toContain('sekret');
      expect(msg).not.toContain('mysql://');
    }
  });

  it('reports descriptors matching what it built (the guard input is derived, not declared)', () => {
    const db = openDb(':memory:');
    const sqlite = createCoreIdentityRepositories({ db, isProduction: false });
    expect(sqlite.descriptors.every((d) => d.backend === 'sqlite' && d.productionReady === false)).toBe(true);

    const pg = createCoreIdentityRepositories({ db, isProduction: true, databaseUrl: 'postgres://h/db', poolFactory: fakePool });
    expect(pg.descriptors.every((d) => d.backend === 'postgres' && d.productionReady === true)).toBe(true);
    expect(pg.descriptors.map((d) => d.repositoryId).sort()).toEqual(
      [...BATCH_1_REPOSITORY_IDS, ...BATCH_1_SUPPLEMENTAL_REPOSITORY_IDS].sort(),
    );
  });

  it('every Batch 1 id is a real required-repository id (no descriptor that satisfies nothing)', () => {
    for (const id of BATCH_1_REPOSITORY_IDS) {
      expect(REQUIRED_PRODUCTION_REPOSITORY_IDS as readonly string[]).toContain(id);
    }
  });
});

describe('BATCH_1 production guard — partial cutover must stay BLOCKED', () => {
  /** Reproduces exactly what index.ts assembles: factory descriptors + remaining domains on SQLite. */
  const descriptorsAfterBatch1 = (batch1Backend: 'postgres' | 'sqlite'): RepositoryDescriptor[] => {
    const db = openDb(':memory:');
    const core =
      batch1Backend === 'postgres'
        ? createCoreIdentityRepositories({ db, isProduction: true, databaseUrl: 'postgres://h/db', poolFactory: fakePool })
        : createCoreIdentityRepositories({ db, isProduction: false });
    const wired = new Map(core.descriptors.map((d) => [d.repositoryId, d]));
    return REQUIRED_PRODUCTION_REPOSITORY_IDS.map(
      (repositoryId) => wired.get(repositoryId) ?? { repositoryId, backend: 'sqlite' as const, productionReady: false },
    );
  };

  it('Batch 1 on PostgreSQL still THROWS in production — Batch 2/3 remain on SQLite', () => {
    const descriptors = descriptorsAfterBatch1('postgres');
    expect(() => assertProductionRepositoryReadiness(descriptors, true)).toThrow(/every persistence repository on managed PostgreSQL/);
  });

  it('the guard names the remaining offenders, and NONE of them is a Batch 1 domain', () => {
    const result = assertProductionRepositoryReadiness(descriptorsAfterBatch1('postgres'), false);
    expect(result.ok).toBe(false);
    const offenders = result.offenders.map((o) => o.repositoryId);
    // Batch 1 is genuinely done...
    for (const id of BATCH_1_REPOSITORY_IDS) {
      expect(offenders).not.toContain(id);
      expect(result.backendSummary[id]).toBe('postgres');
    }
    // ...and the remainder is honestly reported as the reason production cannot start.
    expect(offenders).toEqual(
      expect.arrayContaining(['favorites', 'preferences', 'notifications', 'order_drafts', 'admin_operations', 'gateway_state', 'ai_policy']),
    );
    expect(result.offenders.every((o) => o.reason === 'not_postgres')).toBe(true);
  });

  it('production passes ONLY when every required repository is production-ready PostgreSQL', () => {
    const all: RepositoryDescriptor[] = REQUIRED_PRODUCTION_REPOSITORY_IDS.map((repositoryId) => ({
      repositoryId,
      backend: 'postgres',
      productionReady: true,
    }));
    expect(() => assertProductionRepositoryReadiness(all, true)).not.toThrow();
    expect(assertProductionRepositoryReadiness(all, true).ok).toBe(true);
  });

  it('a postgres backend that is NOT production-ready does not pass either', () => {
    const all: RepositoryDescriptor[] = REQUIRED_PRODUCTION_REPOSITORY_IDS.map((repositoryId, i) => ({
      repositoryId,
      backend: 'postgres',
      productionReady: i !== 0, // one domain certified-false
    }));
    expect(() => assertProductionRepositoryReadiness(all, true)).toThrow(/not_production_ready/);
  });

  it('[no bypass] no env variable or boolean can make a SQLite deployment pass', () => {
    const sqliteEverywhere = descriptorsAfterBatch1('sqlite');
    const saved = { ...process.env };
    try {
      // Every plausible "just let it start" switch, including ones that do not exist: the guard reads
      // descriptors, so none of them can participate in the decision.
      for (const [k, v] of Object.entries({
        PRODUCTION_READY: 'true',
        REPOSITORY_PRODUCTION_READY: 'true',
        SKIP_REPOSITORY_GUARD: 'true',
        FORCE_POSTGRES: 'true',
        ALLOW_SQLITE_IN_PRODUCTION: 'true',
        DATABASE_URL: 'postgres://user:pw@rds.example.com:5432/qt',
        NODE_ENV: 'production',
      })) process.env[k] = v;
      expect(() => assertProductionRepositoryReadiness(sqliteEverywhere, true)).toThrow(/fail-closed startup/);
      // A postgres:// URL in the environment is explicitly NOT proof of a PostgreSQL runtime — that is
      // the whole finding — so the report still says not-ready with the URL set.
      expect(assertProductionRepositoryReadiness(sqliteEverywhere, false).ok).toBe(false);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });

  it('a MISSING descriptor is treated as an offender (a failed wiring cannot silently pass)', () => {
    // index.ts starts with an EMPTY descriptor list, so an auth-init failure lands exactly here.
    const result = assertProductionRepositoryReadiness([], false);
    expect(result.ok).toBe(false);
    expect(result.offenders.every((o) => o.reason === 'missing')).toBe(true);
    expect(() => assertProductionRepositoryReadiness([], true)).toThrow(/fail-closed startup/);
  });
});

describe('BATCH_2 user/trading factory — backend selection', () => {
  it('dev/test selects SQLite adapters for every user-data repository', () => {
    const db = openDb(':memory:');
    const ud = createUserDataRepositories({ db, isProduction: false });
    expect(ud.backend).toBe('sqlite');
    expect(ud.descriptors.every((d) => d.backend === 'sqlite' && d.productionReady === false)).toBe(true);
    expect(ud.descriptors.map((d) => d.repositoryId).sort()).toEqual([...BATCH_2_REPOSITORY_IDS].sort());
  });

  it('production selects PostgreSQL and reuses the ONE pool it was given', () => {
    const db = openDb(':memory:');
    const pool = fakePool();
    const ud = createUserDataRepositories({ db, isProduction: true, pool });
    expect(ud.backend).toBe('postgres');
    expect(ud.descriptors.every((d) => d.backend === 'postgres' && d.productionReady === true)).toBe(true);
  });

  it('production REFUSES to fall back to SQLite when no PostgreSQL pool is provided', () => {
    const db = openDb(':memory:');
    expect(() => createUserDataRepositories({ db, isProduction: true })).toThrow(/fail-closed startup/);
  });

  it('every Batch 2 id is a real required-repository id', () => {
    for (const id of BATCH_2_REPOSITORY_IDS) {
      expect(REQUIRED_PRODUCTION_REPOSITORY_IDS as readonly string[]).toContain(id);
    }
  });
});

describe('BATCH_2 production guard — Batch 1+2 ready but Batch 3 still BLOCKED', () => {
  /** Reproduces index.ts: core-identity + user-data factory descriptors, remaining (Batch 3) on SQLite. */
  const descriptorsAfterBatch2 = (backend: 'postgres' | 'sqlite'): RepositoryDescriptor[] => {
    const db = openDb(':memory:');
    const isProd = backend === 'postgres';
    const core = isProd
      ? createCoreIdentityRepositories({ db, isProduction: true, databaseUrl: 'postgres://h/db', poolFactory: fakePool })
      : createCoreIdentityRepositories({ db, isProduction: false });
    const ud = isProd
      ? createUserDataRepositories({ db, isProduction: true, pool: fakePool() })
      : createUserDataRepositories({ db, isProduction: false });
    const wired = new Map([...core.descriptors, ...ud.descriptors].map((d) => [d.repositoryId, d]));
    return REQUIRED_PRODUCTION_REPOSITORY_IDS.map(
      (repositoryId) => wired.get(repositoryId) ?? { repositoryId, backend: 'sqlite' as const, productionReady: false },
    );
  };

  it('Batch 1+2 on PostgreSQL STILL throws in production — Batch 3 (admin/gateway/ai) remains on SQLite', () => {
    expect(() => assertProductionRepositoryReadiness(descriptorsAfterBatch2('postgres'), true)).toThrow(
      /every persistence repository on managed PostgreSQL/,
    );
  });

  it('the offenders are EXACTLY the Batch 3 domains; every Batch 1+2 domain is postgres', () => {
    const result = assertProductionRepositoryReadiness(descriptorsAfterBatch2('postgres'), false);
    expect(result.ok).toBe(false);
    const offenders = result.offenders.map((o) => o.repositoryId).sort();
    for (const id of [...BATCH_1_REPOSITORY_IDS, ...BATCH_2_REPOSITORY_IDS]) {
      expect(offenders).not.toContain(id);
      expect(result.backendSummary[id]).toBe('postgres');
    }
    expect(offenders).toEqual(['admin_operations', 'ai_policy', 'gateway_state'].sort());
  });

  it('if even one Batch 2 domain is left on SQLite, production stays BLOCKED', () => {
    const descriptors = descriptorsAfterBatch2('postgres').map((d) =>
      d.repositoryId === 'notifications' ? { ...d, backend: 'sqlite' as const, productionReady: false } : d,
    );
    const result = assertProductionRepositoryReadiness(descriptors, false);
    expect(result.offenders.map((o) => o.repositoryId)).toContain('notifications');
    expect(() => assertProductionRepositoryReadiness(descriptors, true)).toThrow(/fail-closed startup/);
  });

  it('[no bypass] Batch 1+2 done but SQLite Batch 3 cannot be forced to pass by any env switch', () => {
    const descriptors = descriptorsAfterBatch2('postgres');
    const saved = { ...process.env };
    try {
      for (const [k, v] of Object.entries({
        PRODUCTION_READY: 'true',
        SKIP_REPOSITORY_GUARD: 'true',
        ALLOW_SQLITE_IN_PRODUCTION: 'true',
        DATABASE_URL: 'postgres://user:pw@rds.example.com:5432/qt',
        NODE_ENV: 'production',
      })) process.env[k] = v;
      expect(() => assertProductionRepositoryReadiness(descriptors, true)).toThrow(/fail-closed startup/);
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });
});

describe('BATCH_3 admin/gateway/ai-policy factory — backend selection', () => {
  it('dev/test selects the SQLite adapter and reports three descriptors', () => {
    const db = openDb(':memory:');
    const admin = createAdminRepositories({ db, isProduction: false });
    expect(admin.backend).toBe('sqlite');
    expect(admin.descriptors.map((d) => d.repositoryId).sort()).toEqual([...BATCH_3_REPOSITORY_IDS].sort());
    expect(admin.descriptors.every((d) => d.backend === 'sqlite' && d.productionReady === false)).toBe(true);
  });
  it('production selects PostgreSQL and reuses the shared pool', () => {
    const db = openDb(':memory:');
    const admin = createAdminRepositories({ db, isProduction: true, pool: fakePool() });
    expect(admin.backend).toBe('postgres');
    expect(admin.descriptors.every((d) => d.backend === 'postgres' && d.productionReady === true)).toBe(true);
  });
  it('production REFUSES to fall back to SQLite when no pool is provided', () => {
    const db = openDb(':memory:');
    expect(() => createAdminRepositories({ db, isProduction: true })).toThrow(/fail-closed startup/);
  });
  it('every Batch 3 id is a real required-repository id, and Batch 1+2+3 cover the whole required set', () => {
    for (const id of BATCH_3_REPOSITORY_IDS) expect(REQUIRED_PRODUCTION_REPOSITORY_IDS as readonly string[]).toContain(id);
    const covered = new Set<string>([...BATCH_1_REPOSITORY_IDS, ...BATCH_2_REPOSITORY_IDS, ...BATCH_3_REPOSITORY_IDS]);
    for (const id of REQUIRED_PRODUCTION_REPOSITORY_IDS) expect(covered.has(id)).toBe(true);
  });
});

describe('BATCH_3 production guard — the FINAL registry check', () => {
  /** Reproduces index.ts after all three batches wire their factories. */
  const descriptorsAfterBatch3 = (backend: 'postgres' | 'sqlite'): RepositoryDescriptor[] => {
    const db = openDb(':memory:');
    const isProd = backend === 'postgres';
    const core = isProd
      ? createCoreIdentityRepositories({ db, isProduction: true, databaseUrl: 'postgres://h/db', poolFactory: fakePool })
      : createCoreIdentityRepositories({ db, isProduction: false });
    const ud = isProd ? createUserDataRepositories({ db, isProduction: true, pool: fakePool() }) : createUserDataRepositories({ db, isProduction: false });
    const admin = isProd ? createAdminRepositories({ db, isProduction: true, pool: fakePool() }) : createAdminRepositories({ db, isProduction: false });
    const wired = new Map([...core.descriptors, ...ud.descriptors, ...admin.descriptors].map((d) => [d.repositoryId, d]));
    return REQUIRED_PRODUCTION_REPOSITORY_IDS.map(
      (repositoryId) => wired.get(repositoryId) ?? { repositoryId, backend: 'sqlite' as const, productionReady: false },
    );
  };

  it('ALL required repositories on PostgreSQL → local production-mode startup is ALLOWED (no throw)', () => {
    const descriptors = descriptorsAfterBatch3('postgres');
    // The whole point of Batch 3: the guard finally passes when every domain is production-ready PG.
    expect(() => assertProductionRepositoryReadiness(descriptors, true)).not.toThrow();
    const result = assertProductionRepositoryReadiness(descriptors, true);
    expect(result.ok).toBe(true);
    expect(result.offenders).toEqual([]);
    expect(Object.values(result.backendSummary).every((b) => b === 'postgres')).toBe(true);
  });

  it('admin_operations on SQLite → production REFUSED', () => {
    const descriptors = descriptorsAfterBatch3('postgres').map((d) => (d.repositoryId === 'admin_operations' ? { ...d, backend: 'sqlite' as const, productionReady: false } : d));
    expect(() => assertProductionRepositoryReadiness(descriptors, true)).toThrow(/fail-closed startup/);
  });
  it('gateway_state on SQLite → production REFUSED', () => {
    const descriptors = descriptorsAfterBatch3('postgres').map((d) => (d.repositoryId === 'gateway_state' ? { ...d, backend: 'sqlite' as const, productionReady: false } : d));
    expect(() => assertProductionRepositoryReadiness(descriptors, true)).toThrow(/fail-closed startup/);
  });
  it('ai_policy on SQLite → production REFUSED', () => {
    const descriptors = descriptorsAfterBatch3('postgres').map((d) => (d.repositoryId === 'ai_policy' ? { ...d, backend: 'sqlite' as const, productionReady: false } : d));
    expect(() => assertProductionRepositoryReadiness(descriptors, true)).toThrow(/fail-closed startup/);
  });
  it('a required repository descriptor missing entirely → production REFUSED', () => {
    const descriptors = descriptorsAfterBatch3('postgres').filter((d) => d.repositoryId !== 'ai_policy');
    expect(() => assertProductionRepositoryReadiness(descriptors, true)).toThrow(/fail-closed startup/);
  });
  it('a PostgreSQL descriptor that is NOT production-ready → production REFUSED', () => {
    const descriptors = descriptorsAfterBatch3('postgres').map((d) => (d.repositoryId === 'gateway_state' ? { ...d, productionReady: false } : d));
    expect(() => assertProductionRepositoryReadiness(descriptors, true)).toThrow(/not_production_ready/);
  });
  it('dev/test with everything on SQLite is allowed (never throws off-production)', () => {
    const descriptors = descriptorsAfterBatch3('sqlite');
    const result = assertProductionRepositoryReadiness(descriptors, false);
    expect(result.ok).toBe(false); // not ready...
    expect(() => assertProductionRepositoryReadiness(descriptors, false)).not.toThrow(); // ...but dev never throws
  });
});
