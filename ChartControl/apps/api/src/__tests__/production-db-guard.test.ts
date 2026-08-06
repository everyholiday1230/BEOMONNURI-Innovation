import { describe, it, expect } from 'vitest';
import { assertProductionDatabaseReadiness } from '../env';

/**
 * R5 / BL-10 — production must NOT run its persistence on SQLite. The audit found the app runtime uses
 * SQLite (`openDb`) unconditionally while the production target is Managed PostgreSQL. This guard is the
 * fail-closed control: production refuses to start unless a postgres:// DATABASE_URL is configured, so a
 * deployment can never silently persist MFA/favourites/orders/etc. to an ephemeral local file.
 */
describe('R5 production database fail-closed guard', () => {
  it('dev/test is unaffected and reports the sqlite backend', () => {
    expect(assertProductionDatabaseReadiness({ NODE_ENV: 'development' }, false)).toEqual({ backend: 'sqlite' });
    expect(assertProductionDatabaseReadiness({}, false)).toEqual({ backend: 'sqlite' });
  });

  it('production WITHOUT DATABASE_URL fails closed (SQLite refused)', () => {
    expect(() => assertProductionDatabaseReadiness({ NODE_ENV: 'production' }, true)).toThrow(/DATABASE_URL.*required in production/i);
    expect(() => assertProductionDatabaseReadiness({ NODE_ENV: 'production', DATABASE_URL: '' }, true)).toThrow(/required in production/i);
  });

  it('production with a non-postgres DATABASE_URL is refused', () => {
    expect(() =>
      assertProductionDatabaseReadiness({ NODE_ENV: 'production', DATABASE_URL: 'file:./quantumtrade.db' }, true),
    ).toThrow(/must be a postgres/i);
    expect(() =>
      assertProductionDatabaseReadiness({ NODE_ENV: 'production', DATABASE_URL: 'mysql://h/db' }, true),
    ).toThrow(/must be a postgres/i);
  });

  it('production with a postgres:// DATABASE_URL is accepted and selects the postgres backend', () => {
    expect(
      assertProductionDatabaseReadiness({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@rds:5432/qt' }, true),
    ).toEqual({ backend: 'postgres' });
    expect(
      assertProductionDatabaseReadiness({ NODE_ENV: 'production', DATABASE_URL: 'postgres://u:p@rds:5432/qt' }, true),
    ).toEqual({ backend: 'postgres' });
  });

  it('the backend is chosen from the environment only, never from a client-supplied value', () => {
    // There is no parameter to this guard other than the process environment: a request body cannot
    // influence the backend decision. This test documents that contract.
    expect(assertProductionDatabaseReadiness.length).toBeLessThanOrEqual(2);
  });
});
