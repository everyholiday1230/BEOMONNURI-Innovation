import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type DB = Database.Database;

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

/** Open (creating dirs as needed), enable FKs/WAL, and run forward migrations. */
export function openDb(path: string): DB {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

/** Idempotent, transactional, forward-only migration runner. */
export function migrate(db: DB): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const files = readdirSync(MIGRATIONS_DIR)
    // `.down.sql` is excluded defensively. Rollback scripts live in `migrations-down/`, but the glob
    // here is by extension, so a down-script accidentally dropped into this directory would otherwise
    // be applied as a FORWARD migration — and it would sort BEFORE its own up-script
    // (`…user_data.down.sql` < `…user_data.sql`), i.e. it would try to drop columns that do not exist
    // yet and break a clean install.
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map((r) => r.version),
  );
  const ran: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, Date.now());
    });
    tx();
    ran.push(version);
  }
  return ran;
}
