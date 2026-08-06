import pg from 'pg';
import type { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `pg` is CommonJS, so a NAMED ESM import (`import { Pool } from 'pg'`) is not statically resolvable and
 * throws at load time under the Node ESM loader used by `tsx` in dev/E2E. Since BATCH_1 this module is in
 * the server's import graph (the repository factory needs `createPool`), so the default-import interop
 * below is what keeps `pnpm dev` and the Playwright suites able to boot at all — the type-only import
 * above is erased at compile time and costs nothing.
 */
const { Pool: PgPool } = pg;

const PG_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../../infrastructure/postgres');

export function createPool(connectionString: string): Pool {
  return new PgPool({ connectionString, max: 10, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 });
}

function upFiles(): string[] {
  return readdirSync(PG_DIR)
    .filter((f) => f.endsWith('.postgres.sql') && !f.endsWith('.down.postgres.sql'))
    .sort();
}

/** Apply pending UP migrations (transactional per file), tracked in schema_migrations. */
export async function migrateUp(pool: Pool): Promise<string[]> {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  const applied = new Set((await pool.query('SELECT version FROM schema_migrations')).rows.map((r) => r.version as string));
  const ran: string[] = [];
  for (const file of upFiles()) {
    const version = file.replace(/\.postgres\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = readFileSync(join(PG_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      await client.query('COMMIT');
      ran.push(version);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  return ran;
}

/** Roll back applied migrations in reverse order using the matching *.down.postgres.sql files. */
export async function migrateDown(pool: Pool): Promise<string[]> {
  const applied = (await pool.query('SELECT version FROM schema_migrations ORDER BY version DESC')).rows.map((r) => r.version as string);
  const ran: string[] = [];
  for (const version of applied) {
    const downFile = `${version}.down.postgres.sql`;
    const sql = readFileSync(join(PG_DIR, downFile), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [version]);
      await client.query('COMMIT');
      ran.push(version);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
  return ran;
}
