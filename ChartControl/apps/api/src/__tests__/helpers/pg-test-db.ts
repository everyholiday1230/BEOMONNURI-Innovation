import { createPool } from '../../db/pg';

/**
 * Provision a DEDICATED database inside the ephemeral PostgreSQL container for one test suite.
 *
 * Vitest runs test FILES in parallel, and every PostgreSQL suite bootstraps itself with
 * `migrateDown()` + `migrateUp()`. Pointed at one shared database, two suites will drop each other's
 * schema mid-run — which shows up as unrelated, irreproducible failures rather than as the collision it
 * actually is. Isolating per suite makes each suite's result mean something on its own.
 *
 * Only ever called with `PG_TEST_URL` (an ephemeral container). The database is dropped and recreated, so
 * a suite always starts from a known-empty state.
 */
export async function createIsolatedTestDatabase(baseUrl: string, suite: string): Promise<string> {
  // Identifier is built from a fixed prefix + a sanitized suite name, so it cannot inject SQL.
  const dbName = `qt_test_${suite.replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`.slice(0, 60);
  const admin = createPool(baseUrl);
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await admin.end();
  }

  const url = new URL(baseUrl);
  url.pathname = `/${dbName}`;
  const suiteUrl = url.toString();

  // The 0001 migration expects the uuid/pgcrypto extensions to be available.
  const suitePool = createPool(suiteUrl);
  try {
    await suitePool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await suitePool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  } finally {
    await suitePool.end();
  }
  return suiteUrl;
}
