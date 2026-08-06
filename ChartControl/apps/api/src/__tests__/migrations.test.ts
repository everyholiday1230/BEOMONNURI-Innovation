import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { openDb, migrate } from '../db/sqlite';

/**
 * B10 — migration quality.
 *
 * Four paths are exercised for real rather than asserted in prose:
 *   1. clean install     — every migration applies to an empty database
 *   2. upgrade           — 0007 applies on top of a database already at 0006 WITH DATA
 *   3. re-run            — the runner is a no-op the second time
 *   4. rollback          — the down script returns the schema to its 0006 shape
 *
 * It also pins the trap that was hit while writing 0007: the runner globs `*.sql`, so a `.down.sql`
 * left in the forward directory would be applied as a forward migration AND would sort before its own
 * up-script. The exclusion is asserted here so it cannot regress.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const UP_DIR = join(HERE, '..', 'db', 'migrations');
const DOWN_DIR = join(HERE, '..', 'db', 'migrations-down');

const cols = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

const tables = (db: Database.Database) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name);

/** Apply forward migrations up to (and including) `stopAfter`, mirroring the real runner. */
function migrateUpTo(db: Database.Database, stopAfter: string): string[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const files = readdirSync(UP_DIR)
    .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
    .sort();
  const ran: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    db.exec(readFileSync(join(UP_DIR, file), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, Date.now());
    ran.push(version);
    if (version === stopAfter) break;
  }
  return ran;
}

describe('migration runner', () => {
  it('never applies a rollback script as a forward migration', () => {
    const forward = readdirSync(UP_DIR).filter((f) => f.endsWith('.sql'));
    for (const f of forward) {
      expect(f.endsWith('.down.sql'), `${f} must not live in the forward migrations directory`).toBe(false);
    }
    // And the sort-order hazard that makes this dangerous is real, so document it with an assertion.
    expect(['0007_phase7_user_data.down.sql', '0007_phase7_user_data.sql'].sort()[0]).toBe(
      '0007_phase7_user_data.down.sql',
    );
  });

  it('[clean] applies every migration to an empty database', () => {
    const db = openDb(':memory:');
    const applied = (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: string }[]).map(
      (r) => r.version,
    );
    expect(applied).toContain('0001_init');
    expect(applied).toContain('0007_phase7_user_data');
    // 0007's objects exist.
    expect(tables(db)).toContain('user_favorites');
    expect(tables(db)).toContain('user_favorites_meta');
    expect(cols(db, 'user_preferences')).toContain('version');
    expect(cols(db, 'notifications')).toEqual(expect.arrayContaining(['severity', 'read_at', 'correlation_id']));
    expect(cols(db, 'order_drafts')).toEqual(expect.arrayContaining(['source', 'executable']));
    db.close();
  });

  it('[re-run] a second migrate() is a no-op', () => {
    const db = openDb(':memory:');
    expect(migrate(db)).toEqual([]);
    db.close();
  });

  it('[upgrade] 0007 applies on top of a populated 0006 database without data loss', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateUpTo(db, '0006_phase6_mfa');
    expect(tables(db)).not.toContain('user_favorites');

    // Populate the tables 0007 alters, so the ADD COLUMNs are exercised against real rows.
    db.prepare('INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run('u1', 'a@ex.com', 'x', 'USER', 'active', 1000, 1000);
    db.prepare('INSERT INTO user_preferences (user_id,theme,locale,updated_at) VALUES (?,?,?,?)')
      .run('u1', 'dark', 'ko', 1000);
    db.prepare('INSERT INTO notifications (id,user_id,type,message,read,created_at) VALUES (?,?,?,?,?,?)')
      .run('n1', 'u1', 'system', 'hello', 0, 1000);
    db.prepare('INSERT INTO order_drafts (id,user_id,symbol,side,data,created_at) VALUES (?,?,?,?,?,?)')
      .run('d1', 'u1', 'BTCUSDT', 'buy', '{}', 1000);

    // Apply 0007 on top.
    db.exec(readFileSync(join(UP_DIR, '0007_phase7_user_data.sql'), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run('0007_phase7_user_data', 1);

    // Pre-existing rows survive and get the declared defaults.
    const pref = db.prepare('SELECT theme, locale, version FROM user_preferences WHERE user_id=?').get('u1') as {
      theme: string; locale: string; version: number;
    };
    expect(pref).toEqual({ theme: 'dark', locale: 'ko', version: 1 });
    const notif = db.prepare('SELECT message, severity, read_at FROM notifications WHERE id=?').get('n1') as {
      message: string; severity: string; read_at: number | null;
    };
    expect(notif).toEqual({ message: 'hello', severity: 'info', read_at: null });
    const draft = db.prepare('SELECT source, executable FROM order_drafts WHERE id=?').get('d1') as {
      source: string; executable: number;
    };
    // A draft is not executable by default — that is the safety default, stored not derived.
    expect(draft).toEqual({ source: 'MOCK', executable: 0 });
    db.close();
  });

  it('[constraints] a favourite cannot be duplicated and is scoped to its owner', () => {
    const db = openDb(':memory:');
    db.prepare('INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run('u1', 'a@ex.com', 'x', 'USER', 'active', 1, 1);
    db.prepare('INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run('u2', 'b@ex.com', 'x', 'USER', 'active', 1, 1);
    const ins = db.prepare('INSERT INTO user_favorites (user_id,symbol,sort_index,created_at) VALUES (?,?,?,?)');
    ins.run('u1', 'BTCUSDT', 0, 1);
    // Same symbol for the same user is refused by the primary key, not by application code.
    expect(() => ins.run('u1', 'BTCUSDT', 1, 2)).toThrow();
    // …but the same symbol for a DIFFERENT user is fine.
    expect(() => ins.run('u2', 'BTCUSDT', 0, 2)).not.toThrow();
    // Deleting the owner removes the favourites (ON DELETE CASCADE).
    db.prepare('DELETE FROM users WHERE id=?').run('u1');
    expect((db.prepare('SELECT COUNT(*) n FROM user_favorites WHERE user_id=?').get('u1') as { n: number }).n).toBe(0);
    expect((db.prepare('SELECT COUNT(*) n FROM user_favorites WHERE user_id=?').get('u2') as { n: number }).n).toBe(1);
    db.close();
  });

  it('[rollback] the down script returns the schema to its 0006 shape', () => {
    const db = openDb(':memory:');
    db.prepare('INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
      .run('u1', 'a@ex.com', 'x', 'USER', 'active', 1, 1);
    db.prepare('INSERT INTO user_favorites (user_id,symbol,sort_index,created_at) VALUES (?,?,?,?)')
      .run('u1', 'BTCUSDT', 0, 1);

    db.exec(readFileSync(join(DOWN_DIR, '0007_phase7_user_data.down.sql'), 'utf8'));

    expect(tables(db)).not.toContain('user_favorites');
    expect(tables(db)).not.toContain('user_favorites_meta');
    expect(cols(db, 'user_preferences')).not.toContain('version');
    expect(cols(db, 'notifications')).not.toContain('severity');
    expect(cols(db, 'order_drafts')).not.toContain('executable');
    // The runner no longer considers 0007 applied, so a subsequent migrate() re-applies just that one.
    const versions = (db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map((r) => r.version);
    expect(versions).not.toContain('0007_phase7_user_data');
    expect(migrate(db)).toEqual(['0007_phase7_user_data']);
    expect(tables(db)).toContain('user_favorites');
    db.close();
  });
});

/**
 * 0008 — order_drafts extension for the B4 draft contract.
 *
 * The interesting properties are the partial unique index (which must permit the many pre-existing rows
 * with a NULL idempotency key while still preventing a duplicate key per user) and a rollback that leaves
 * 0007's own columns alone.
 */
describe('0008_phase7_order_drafts', () => {
  const seedUser = (db: Database.Database, id: string) =>
    db
      .prepare(
        "INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES (?,?,'x','USER','active',1,1)",
      )
      .run(id, `${id}@ex.com`);

  it('[clean] adds the version, verdict and idempotency columns', () => {
    const db = openDb(':memory:');
    const c = cols(db, 'order_drafts');
    for (const name of ['version', 'updated_at', 'idempotency_key', 'valid', 'allowed']) {
      expect(c, `order_drafts.${name}`).toContain(name);
    }
    // 0007's columns must still be there: 0008 extends, it does not replace.
    expect(c).toContain('source');
    expect(c).toContain('executable');
  });

  it('[constraint] permits many NULL idempotency keys but rejects a duplicate key per user', () => {
    const db = openDb(':memory:');
    seedUser(db, 'u1');
    seedUser(db, 'u2');
    const insert = (id: string, user: string, key: string | null) =>
      db
        .prepare('INSERT INTO order_drafts (id,user_id,symbol,side,data,created_at,idempotency_key) VALUES (?,?,?,?,?,?,?)')
        .run(id, user, 'BTCUSDT', 'long', '{}', 1, key);

    // Legacy rows carry no key. A plain UNIQUE index would have made the second of these fail.
    insert('a', 'u1', null);
    insert('b', 'u1', null);
    insert('c', 'u1', 'k1');
    expect(() => insert('d', 'u1', 'k1')).toThrow();
    // The same key for a different user is fine: uniqueness is per user, not global.
    expect(() => insert('e', 'u2', 'k1')).not.toThrow();
  });

  it('[upgrade] applies on top of a populated 0007 database and defaults existing rows', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateUpTo(db, '0007_phase7_user_data');
    seedUser(db, 'u9');
    db.prepare('INSERT INTO order_drafts (id,user_id,symbol,side,data,created_at) VALUES (?,?,?,?,?,?)').run(
      'pre',
      'u9',
      'BTCUSDT',
      'long',
      '{}',
      1,
    );
    db.exec(readFileSync(join(UP_DIR, '0008_phase7_order_drafts.sql'), 'utf8'));

    const row = db.prepare('SELECT version, idempotency_key, valid FROM order_drafts WHERE id=?').get('pre') as {
      version: number;
      idempotency_key: string | null;
      valid: number | null;
    };
    // The pre-existing row keeps its data and picks up the declared default; the nullable verdict columns
    // stay NULL rather than being invented as 0 (which would read as "the server said no").
    expect(row.version).toBe(1);
    expect(row.idempotency_key).toBeNull();
    expect(row.valid).toBeNull();
  });

  it('[rollback] the down script removes only what 0008 added', () => {
    const db = openDb(':memory:');
    db.exec(readFileSync(join(DOWN_DIR, '0008_phase7_order_drafts.down.sql'), 'utf8'));
    const c = cols(db, 'order_drafts');
    for (const name of ['version', 'updated_at', 'idempotency_key', 'valid', 'allowed']) {
      expect(c, `order_drafts.${name} should be gone`).not.toContain(name);
    }
    // 0007's columns survive the 0008 rollback.
    expect(c).toContain('source');
    expect(c).toContain('executable');
    const versions = (db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map((r) => r.version);
    expect(versions).not.toContain('0008_phase7_order_drafts');
    expect(migrate(db)).toEqual(['0008_phase7_order_drafts']);
  });
});

/**
 * 0009 — admin operational contracts (B7).
 *
 * The properties worth pinning are the ones that are load-bearing for safety rather than merely present:
 * the `ai_policy.live_execution_enabled` CHECK (the database itself refuses to enable live AI execution),
 * the lockout row's cascade to its user, and a rollback that leaves the 0005 shape of `incidents` intact.
 */
describe('0009_phase7_admin_ops', () => {
  const seedUser = (db: Database.Database, id: string) =>
    db
      .prepare(
        "INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES (?,?,'x','USER','active',1,1)",
      )
      .run(id, `${id}@ex.com`);

  it('[clean] creates the B7 tables and the incident acknowledgement columns', () => {
    const db = openDb(':memory:');
    const t = tables(db);
    for (const name of ['account_lockouts', 'admin_reports', 'mock_gateway_state', 'ai_policy', 'ai_policy_history']) {
      expect(t, name).toContain(name);
    }
    expect(cols(db, 'incidents')).toEqual(expect.arrayContaining(['acknowledged_at', 'acknowledged_by']));
    const applied = (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: string }[]).map((r) => r.version);
    expect(applied).toContain('0009_phase7_admin_ops');
    db.close();
  });

  it('[constraint] the DATABASE refuses to enable live AI execution', () => {
    const db = openDb(':memory:');
    db.prepare('INSERT INTO ai_policy (id, live_execution_enabled, updated_at) VALUES (?,0,?)').run('default', 1);
    // Not a default that a future UPDATE could overwrite — a CHECK that rejects the row.
    expect(() => db.prepare('UPDATE ai_policy SET live_execution_enabled=1 WHERE id=?').run('default')).toThrow();
    expect(() => db.prepare('INSERT INTO ai_policy (id, live_execution_enabled, updated_at) VALUES (?,1,?)').run('other', 1)).toThrow();
    expect((db.prepare("SELECT live_execution_enabled v FROM ai_policy WHERE id='default'").get() as { v: number }).v).toBe(0);
    db.close();
  });

  it('[constraint] a lockout is scoped to one user and cascades on delete', () => {
    const db = openDb(':memory:');
    seedUser(db, 'u1');
    const ins = db.prepare('INSERT INTO account_lockouts (user_id,fails,first_fail_at,locked_until,updated_at) VALUES (?,?,?,?,?)');
    ins.run('u1', 3, 1000, 2000, 1000);
    // One row per user: the PRIMARY KEY, not application code, prevents a second lockout record.
    expect(() => ins.run('u1', 1, 1, 1, 1)).toThrow();
    // An orphan lockout for an unknown user is refused by the foreign key.
    expect(() => ins.run('ghost', 1, 1, 1, 1)).toThrow();
    db.prepare('DELETE FROM users WHERE id=?').run('u1');
    expect((db.prepare('SELECT COUNT(*) n FROM account_lockouts').get() as { n: number }).n).toBe(0);
    db.close();
  });

  it('[upgrade] applies on top of a populated 0008 database and preserves incident rows', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateUpTo(db, '0008_phase7_order_drafts');
    expect(tables(db)).not.toContain('account_lockouts');
    db.prepare(
      `INSERT INTO incidents (id,title,description,severity,service,status,version,detected_at,created_by,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).run('inc1', 'existing incident', 'd', 'SEV3', 'api', 'OPEN', 4, 1000, 'someone', 1000, 1000);

    db.exec(readFileSync(join(UP_DIR, '0009_phase7_admin_ops.sql'), 'utf8'));

    const row = db.prepare('SELECT title, version, acknowledged_at, acknowledged_by FROM incidents WHERE id=?').get('inc1') as {
      title: string; version: number; acknowledged_at: number | null; acknowledged_by: string | null;
    };
    // The pre-existing incident keeps its data and its version, and is NOT retroactively acknowledged —
    // a nullable column is the honest "nobody has acknowledged this" value.
    expect(row).toEqual({ title: 'existing incident', version: 4, acknowledged_at: null, acknowledged_by: null });
    db.close();
  });

  it('[rollback] the down script removes only what 0009 added', () => {
    const db = openDb(':memory:');
    db.exec(readFileSync(join(DOWN_DIR, '0009_phase7_admin_ops.down.sql'), 'utf8'));
    const t = tables(db);
    for (const name of ['account_lockouts', 'admin_reports', 'mock_gateway_state', 'ai_policy', 'ai_policy_history']) {
      expect(t, `${name} should be gone`).not.toContain(name);
    }
    const c = cols(db, 'incidents');
    expect(c).not.toContain('acknowledged_at');
    expect(c).not.toContain('acknowledged_by');
    // 0005's own incident columns survive the 0009 rollback.
    expect(c).toEqual(expect.arrayContaining(['status', 'severity', 'version', 'root_cause']));
    // 0008's objects are untouched.
    expect(cols(db, 'order_drafts')).toContain('idempotency_key');
    const versions = (db.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map((r) => r.version);
    expect(versions).not.toContain('0009_phase7_admin_ops');
    expect(migrate(db)).toEqual(['0009_phase7_admin_ops']);
    expect(tables(db)).toContain('ai_policy');
    db.close();
  });
});
