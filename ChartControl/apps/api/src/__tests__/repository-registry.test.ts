import { describe, it, expect } from 'vitest';
import {
  assertProductionRepositoryReadiness,
  REQUIRED_PRODUCTION_REPOSITORY_IDS,
  type RepositoryDescriptor,
} from '../db/repository-registry';

/**
 * R5 / BL-10 — repository-AWARE production guard. Proves the guard inspects the actual wired backend, so
 * a postgres:// URL cannot mask a SQLite runtime. "Production cannot silently run on SQLite" is only true
 * because this refuses to start unless every required repository is a production-ready PostgreSQL impl.
 */

const all = (backend: RepositoryDescriptor['backend'], productionReady = true): RepositoryDescriptor[] =>
  REQUIRED_PRODUCTION_REPOSITORY_IDS.map((repositoryId) => ({ repositoryId, backend, productionReady }));

describe('R5 repository-aware production guard', () => {
  it('production + ALL required repositories on production-ready PostgreSQL → boots', () => {
    const r = assertProductionRepositoryReadiness(all('postgres', true), true);
    expect(r.ok).toBe(true);
    expect(r.offenders).toEqual([]);
  });

  it('production + all repositories SQLite → refuses (the real current state)', () => {
    expect(() => assertProductionRepositoryReadiness(all('sqlite', false), true)).toThrow(/every persistence repository on managed PostgreSQL/i);
  });

  it('production + PARTIAL PostgreSQL (one domain still SQLite) → refuses', () => {
    const descriptors = all('postgres', true);
    // flip a single domain back to SQLite — a postgres:// URL would not catch this.
    const i = descriptors.findIndex((d) => d.repositoryId === 'order_drafts');
    descriptors[i] = { repositoryId: 'order_drafts', backend: 'sqlite', productionReady: false };
    let threw = false;
    try {
      assertProductionRepositoryReadiness(descriptors, true);
    } catch (e) {
      threw = true;
      expect((e as Error).message).toContain('order_drafts=not_postgres');
    }
    expect(threw).toBe(true);
  });

  it('production + postgres backend but NOT productionReady → refuses', () => {
    expect(() => assertProductionRepositoryReadiness(all('postgres', false), true)).toThrow(/not_production_ready/i);
  });

  it('production + a MISSING required repository → refuses', () => {
    const descriptors = all('postgres', true).filter((d) => d.repositoryId !== 'mfa');
    let threw = false;
    try {
      assertProductionRepositoryReadiness(descriptors, true);
    } catch (e) {
      threw = true;
      expect((e as Error).message).toContain('mfa=missing');
    }
    expect(threw).toBe(true);
  });

  it('development + SQLite → allowed (never throws off-production)', () => {
    const r = assertProductionRepositoryReadiness(all('sqlite', false), false);
    expect(r.ok).toBe(false); // reports not-ready...
    // ...but does not throw in development.
    expect(r.backendSummary['favorites']).toBe('sqlite');
  });

  it('test/E2E with explicit SQLite → allowed', () => {
    expect(() => assertProductionRepositoryReadiness(all('sqlite', false), false)).not.toThrow();
  });

  it('cannot be bypassed by an arbitrary boolean: decision derives only from descriptors + isProduction', () => {
    // There is no third parameter; a client/env boolean cannot flip the verdict. Passing SQLite in
    // production throws regardless of anything else in the environment.
    expect(assertProductionRepositoryReadiness.length).toBeLessThanOrEqual(2);
    expect(() => assertProductionRepositoryReadiness(all('sqlite', true), true)).toThrow();
  });

  it('the required set covers the BL-10 domains', () => {
    for (const id of ['auth.sessions', 'mfa', 'favorites', 'preferences', 'notifications', 'order_drafts', 'account_lockout', 'admin_operations', 'gateway_state', 'ai_policy']) {
      expect(REQUIRED_PRODUCTION_REPOSITORY_IDS).toContain(id);
    }
  });
});
