import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { createPool, migrateUp, migrateDown } from '../db/pg';
import { createIsolatedTestDatabase } from './helpers/pg-test-db';

/**
 * BL-01 remediation — PostgreSQL parity for Phase 6/7 schema (SQLite migrations 0006–0009).
 *
 * The audit found `infrastructure/postgres` stopped at 0005 while SQLite reached 0009, so nine tables
 * (mfa_credentials, mfa_challenges, user_favorites, user_favorites_meta, account_lockouts, admin_reports,
 * mock_gateway_state, ai_policy, ai_policy_history) plus several columns had NO PostgreSQL DDL. This
 * suite proves the new 0006–0009 PostgreSQL migrations create that schema on a REAL PostgreSQL instance
 * and that the invariants the SQLite versions rely on (PK/FK/UNIQUE/CHECK/partial-unique index/optimistic
 * version/transaction rollback/concurrency/ownership) actually hold on PostgreSQL.
 *
 * Runs ONLY when PG_TEST_URL is set (ephemeral local container). Otherwise skipped. NEVER touches AWS/RDS.
 */

const URL = process.env.PG_TEST_URL;

describe.skipIf(!URL)('PostgreSQL Phase 6/7 parity (real)', () => {
  let pool: Pool;
  const now = () => Date.now();
  const mkUserRow = async () => {
    const id = randomUUID();
    await pool.query(
      'INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,now(),now())',
      [id, `u_${id}@ex.com`, 'scrypt$1$1$1$a$b', 'user', 'active'],
    );
    return id;
  };

  beforeAll(async () => {
    // Dedicated database: this suite migrates down/up, so it must not share a schema with another suite.
    pool = createPool(await createIsolatedTestDatabase(URL!, 'postgres_phase67'));
    await migrateDown(pool).catch(() => {});
    await migrateUp(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('[clean install] 0006–0009 create every Phase 6/7 table', async () => {
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map((r) => r.tablename);
    for (const t of [
      'mfa_credentials',
      'mfa_challenges',
      'user_favorites',
      'user_favorites_meta',
      'account_lockouts',
      'admin_reports',
      'mock_gateway_state',
      'ai_policy',
      'ai_policy_history',
    ]) {
      expect(tables, `missing PG table ${t}`).toContain(t);
    }
  });

  it('[columns] additive columns exist on pre-existing tables', async () => {
    const cols = async (t: string) =>
      (await pool.query('SELECT column_name FROM information_schema.columns WHERE table_name=$1', [t])).rows.map((r) => r.column_name);
    expect(await cols('user_preferences')).toContain('version');
    const notif = await cols('notifications');
    for (const c of ['severity', 'read_at', 'correlation_id']) expect(notif).toContain(c);
    const drafts = await cols('order_drafts');
    for (const c of ['source', 'executable', 'version', 'updated_at', 'idempotency_key', 'valid', 'allowed']) expect(drafts).toContain(c);
    const inc = await cols('incidents');
    for (const c of ['acknowledged_at', 'acknowledged_by']) expect(inc).toContain(c);
  });

  it('[idempotent] re-running migrateUp applies nothing', async () => {
    expect((await migrateUp(pool)).length).toBe(0);
  });

  it('[MFA] credential PK + challenge FK + ON DELETE CASCADE', async () => {
    const uid = await mkUserRow();
    await pool.query(
      'INSERT INTO mfa_credentials (user_id,enabled,secret_encrypted,recovery_codes_json,last_used_counter,updated_at) VALUES ($1,1,$2,$3,$4,$5)',
      [uid, 'aesgcm-token', JSON.stringify([{ hash: 'h', usedAt: null }]), 42, now()],
    );
    await expect(
      pool.query('INSERT INTO mfa_credentials (user_id,enabled,updated_at) VALUES ($1,0,$2)', [uid, now()]),
    ).rejects.toThrow(/duplicate key|unique/i);
    await expect(
      pool.query('INSERT INTO mfa_challenges (token_hash,user_id,created_at,expires_at) VALUES ($1,$2,$3,$4)', ['th', randomUUID(), now(), now() + 1000]),
    ).rejects.toThrow(/foreign key|violates/i);
    await pool.query('INSERT INTO mfa_challenges (token_hash,user_id,created_at,expires_at) VALUES ($1,$2,$3,$4)', [`th-${uid}`, uid, now(), now() + 1000]);
    await pool.query('DELETE FROM users WHERE id=$1', [uid]);
    expect((await pool.query('SELECT count(*)::int AS n FROM mfa_credentials WHERE user_id=$1', [uid])).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM mfa_challenges WHERE user_id=$1', [uid])).rows[0].n).toBe(0);
  });

  it('[favorites] (user,symbol) PK dedupes, ownership isolates, set version optimistic', async () => {
    const a = await mkUserRow();
    const b = await mkUserRow();
    await pool.query('INSERT INTO user_favorites (user_id,symbol,sort_index,created_at) VALUES ($1,$2,0,$3)', [a, 'BTCUSDT', now()]);
    await expect(
      pool.query('INSERT INTO user_favorites (user_id,symbol,sort_index,created_at) VALUES ($1,$2,1,$3)', [a, 'BTCUSDT', now()]),
    ).rejects.toThrow(/duplicate key|unique/i);
    await pool.query('INSERT INTO user_favorites (user_id,symbol,sort_index,created_at) VALUES ($1,$2,0,$3)', [b, 'BTCUSDT', now()]);
    expect((await pool.query('SELECT symbol FROM user_favorites WHERE user_id=$1', [a])).rows.map((r) => r.symbol)).toEqual(['BTCUSDT']);
    await pool.query('INSERT INTO user_favorites_meta (user_id,version,updated_at) VALUES ($1,1,$2)', [a, now()]);
    const upd = await pool.query('UPDATE user_favorites_meta SET version=version+1, updated_at=$2 WHERE user_id=$1 AND version=1 RETURNING version', [a, now()]);
    expect(upd.rows[0].version).toBe(2);
    const stale = await pool.query('UPDATE user_favorites_meta SET version=version+1 WHERE user_id=$1 AND version=1', [a]);
    expect(stale.rowCount).toBe(0);
  });

  it('[order-draft] partial-unique idempotency index; NULL keys allowed; executable persisted 0', async () => {
    const uid = await mkUserRow();
    const insertDraft = (id: string, key: string | null) =>
      pool.query(
        `INSERT INTO order_drafts (id,user_id,symbol,side,data,created_at,source,executable,version,valid,allowed,idempotency_key)
         VALUES ($1,$2,'BTCUSDT','long','{}',now(),'MOCK',0,1,1,0,$3)`,
        [id, uid, key],
      );
    await insertDraft(randomUUID(), 'idem-A');
    await expect(insertDraft(randomUUID(), 'idem-A')).rejects.toThrow(/duplicate key|unique/i);
    await insertDraft(randomUUID(), null);
    await insertDraft(randomUUID(), null);
    expect((await pool.query('SELECT count(*)::int AS n FROM order_drafts WHERE user_id=$1', [uid])).rows[0].n).toBe(3);
    expect((await pool.query('SELECT DISTINCT executable FROM order_drafts WHERE user_id=$1', [uid])).rows.map((r) => r.executable)).toEqual([0]);
    // same key for a DIFFERENT user is allowed.
    const uid2 = await mkUserRow();
    const other = await pool.query(
      `INSERT INTO order_drafts (id,user_id,symbol,side,data,created_at,source,executable,idempotency_key)
       VALUES ($1,$2,'BTCUSDT','long','{}',now(),'MOCK',0,$3) RETURNING id`,
      [randomUUID(), uid2, 'idem-A'],
    );
    expect(other.rowCount).toBe(1);
  });

  it('[ai_policy] CHECK forbids live execution; digest-only prompt; optimistic version', async () => {
    await expect(
      pool.query('INSERT INTO ai_policy (id,live_execution_enabled,updated_at) VALUES ($1,1,$2)', ['p-bad', now()]),
    ).rejects.toThrow(/check constraint|violates/i);
    await pool.query(
      'INSERT INTO ai_policy (id,live_execution_enabled,system_prompt_digest,system_prompt_algo,system_prompt_len,version,updated_at) VALUES ($1,0,$2,$3,$4,0,$5)',
      ['default', 'sha256:abc', 'sha256', 128, now()],
    );
    expect((await pool.query('UPDATE ai_policy SET version=version+1 WHERE id=$1 AND version=5', ['default'])).rowCount).toBe(0);
    const ok = await pool.query('UPDATE ai_policy SET version=version+1 WHERE id=$1 AND version=0 RETURNING version', ['default']);
    expect(ok.rows[0].version).toBe(1);
    // no column can hold raw prompt text.
    const cols = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='ai_policy'")).rows.map((r) => r.column_name);
    expect(cols).not.toContain('system_prompt');
    expect(cols).toContain('system_prompt_digest');
  });

  it('[account_lockouts + admin_reports] PK/FK cascade + provenance snapshot', async () => {
    const uid = await mkUserRow();
    await pool.query('INSERT INTO account_lockouts (user_id,fails,first_fail_at,locked_until,version,updated_at) VALUES ($1,3,$2,$3,0,$2)', [uid, now(), now() + 60000]);
    await expect(
      pool.query('INSERT INTO account_lockouts (user_id,fails,first_fail_at,updated_at) VALUES ($1,1,$2,$2)', [uid, now()]),
    ).rejects.toThrow(/duplicate key|unique/i);
    await pool.query('DELETE FROM users WHERE id=$1', [uid]);
    expect((await pool.query('SELECT count(*)::int AS n FROM account_lockouts WHERE user_id=$1', [uid])).rows[0].n).toBe(0);
    await pool.query(
      'INSERT INTO admin_reports (id,report_type,source_json,data_json,row_count,generated_by,generated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      ['r1', 'user_activity', JSON.stringify({ tables: ['users'] }), JSON.stringify({ total: 0 }), 0, 'admin-1', now()],
    );
    expect((await pool.query("SELECT report_type FROM admin_reports WHERE id='r1'")).rows[0].report_type).toBe('user_activity');
  });

  it('[incidents] acknowledgement records actor separately from status', async () => {
    await pool.query(
      `INSERT INTO incidents (id,title,severity,status,version,detected_at,created_by,created_at,updated_at)
       VALUES ('inc-1','t','high','OPEN',0,$1,'sys',$1,$1)`,
      [now()],
    );
    const ack = await pool.query(
      "UPDATE incidents SET acknowledged_at=$1, acknowledged_by='admin-1', version=version+1 WHERE id='inc-1' AND version=0 RETURNING status, acknowledged_by",
      [now()],
    );
    expect(ack.rows[0].status).toBe('OPEN');
    expect(ack.rows[0].acknowledged_by).toBe('admin-1');
  });

  it('[transaction rollback] discards a Phase 6/7 write', async () => {
    const uid = await mkUserRow();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO user_favorites (user_id,symbol,sort_index,created_at) VALUES ($1,$2,0,$3)', [uid, 'ETHUSDT', now()]);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect((await pool.query('SELECT count(*)::int AS n FROM user_favorites WHERE user_id=$1', [uid])).rows[0].n).toBe(0);
  });

  it('[rollback] 0006–0009 down removes their objects, then full stack re-applies', async () => {
    await migrateDown(pool);
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map((r) => r.tablename);
    for (const t of ['mfa_credentials', 'user_favorites', 'account_lockouts', 'ai_policy']) expect(tables).not.toContain(t);
    const applied = await migrateUp(pool);
    expect(applied).toContain('0006_phase6_mfa');
    expect(applied).toContain('0009_phase7_admin_ops');
    const drafts = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='order_drafts'")).rows.map((r) => r.column_name);
    expect(drafts).toContain('idempotency_key');
  });
});
