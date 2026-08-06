import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { createPool, migrateUp, migrateDown } from '../db/pg';
import { createIsolatedTestDatabase } from './helpers/pg-test-db';
import { PgUserRepository, PgSessionRepository, PgAuditRepository } from '../db/pg-repos';
import { AuthService } from '@quantumtrade/auth';

const URL = process.env.PG_TEST_URL;

// Runs ONLY when PG_TEST_URL is set (real PostgreSQL). Otherwise skipped (normal `pnpm test`).
describe.skipIf(!URL)('PostgreSQL integration (real)', () => {
  let pool: Pool;
  let suiteUrl: string;
  const mkUser = () => ({ id: randomUUID(), email: `u_${randomUUID()}@ex.com`, hash: 'scrypt$1$1$1$a$b' });

  beforeAll(async () => {
    // Dedicated database: this suite migrates down/up, so it must not share a schema with another suite.
    suiteUrl = await createIsolatedTestDatabase(URL!, 'postgres_integration');
    pool = createPool(suiteUrl);
    await migrateDown(pool).catch(() => {}); // clean slate (ignore if nothing applied)
  });
  afterAll(async () => {
    await pool.end();
  });

  it('empty bootstrap → migrate up creates tables, indexes, seeds', async () => {
    const ran = await migrateUp(pool);
    expect(ran).toContain('0001_init');
    expect(ran).toContain('0002_phase2_closure');
    expect(ran).toContain('0003_phase3_trading');
    expect(ran).toContain('0004_phase4_ai');
    expect(ran).toContain('0005_phase5_admin');
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map((r) => r.tablename);
    for (const t of ['users', 'sessions', 'permissions', 'role_permissions', 'user_roles', 'ai_signals', 'signal_versions', 'simulation_orders', 'simulation_order_events', 'audit_logs', 'layout_versions',
      'exchange_credentials', 'orders', 'order_events', 'executions', 'positions', 'risk_checks', 'reconciliation_runs', 'idempotency_records', 'trading_kill_switches',
      'ai_runs', 'ai_tool_calls', 'ai_tool_outputs', 'chart_commands', 'chart_overlays', 'ai_usage_records', 'ai_prompt_versions', 'ai_evaluation_runs', 'ai_feedback',
      'admin_actions', 'feature_flags', 'feature_flag_history', 'kill_switches', 'kill_switch_history', 'incidents', 'incident_events', 'release_gates', 'release_gate_evidence', 'prompt_change_requests', 'prompt_approvals'])
      expect(tables).toContain(t);
    const idx = (await pool.query("SELECT indexname FROM pg_indexes WHERE tablename='sessions'")).rows.map((r) => r.indexname);
    expect(idx).toContain('idx_sessions_user');
    const perms = (await pool.query('SELECT count(*)::int AS n FROM permissions')).rows[0].n;
    expect(perms).toBe(12);
  });

  it('orders UNIQUE(user_id, client_order_id) + idempotency PK prevent duplicates (concurrent)', async () => {
    const u = mkUser();
    await pool.query('INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,now(),now())', [u.id, u.email, u.hash, 'user', 'active']);
    const insertOrder = (coid: string) =>
      pool.query(
        `INSERT INTO orders (internal_order_id,user_id,client_order_id,symbol,side,type,quantity,status,mode,created_at,updated_at)
         VALUES ($1,$2,$3,'BTCUSDT','long','market','0.001','SUBMITTING','BITMART_LIVE_SHADOW',now(),now())`,
        [randomUUID(), u.id, coid],
      );
    await insertOrder('dup-coid');
    await expect(insertOrder('dup-coid')).rejects.toThrow(/duplicate key|unique/i);
    // idempotency race: 5 concurrent inserts of the same key → exactly 1 succeeds.
    const key = 'idem-1';
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => pool.query('INSERT INTO idempotency_records (idempotency_key,user_id,scope,created_at) VALUES ($1,$2,$3,now())', [key, u.id, 'order.submit'])),
    );
    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect(results.filter((r) => r.status === 'rejected').length).toBe(4);
  });

  it('migrate up is idempotent (no re-apply)', async () => {
    expect((await migrateUp(pool)).length).toBe(0);
  });

  it('unique constraint on users.email', async () => {
    const u = mkUser();
    await pool.query('INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,now(),now())', [u.id, u.email, u.hash, 'user', 'active']);
    await expect(
      pool.query('INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,now(),now())', [randomUUID(), u.email, u.hash, 'user', 'active']),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it('foreign key enforced (session.user_id → users.id)', async () => {
    await expect(
      pool.query('INSERT INTO sessions (id,user_id,csrf_secret,created_at,expires_at) VALUES ($1,$2,$3,now(),now())', ['sess-x', randomUUID(), 'c']),
    ).rejects.toThrow(/foreign key|violates/i);
  });

  it('transaction rollback discards writes', async () => {
    const u = mkUser();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,now(),now())', [u.id, u.email, u.hash, 'user', 'active']);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    const n = (await pool.query('SELECT count(*)::int AS n FROM users WHERE id=$1', [u.id])).rows[0].n;
    expect(n).toBe(0);
  });

  it('concurrent session creation via pool (idempotent count)', async () => {
    const u = mkUser();
    await pool.query('INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,now(),now())', [u.id, u.email, u.hash, 'user', 'active']);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        pool.query('INSERT INTO sessions (id,user_id,csrf_secret,created_at,expires_at) VALUES ($1,$2,$3,now(),now()+interval \'1 hour\')', [`s-${u.id}-${i}`, u.id, 'c']),
      ),
    );
    const n = (await pool.query('SELECT count(*)::int AS n FROM sessions WHERE user_id=$1', [u.id])).rows[0].n;
    expect(n).toBe(20);
  });

  it('connection pool handles many parallel queries', async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => pool.query('SELECT 1 AS x')));
    expect(results.every((r) => r.rows[0].x === 1)).toBe(true);
  });

  it('repository integration: AuthService register/login/validate on PostgreSQL', async () => {
    const service = new AuthService(new PgUserRepository(pool), new PgSessionRepository(pool), new PgAuditRepository(pool));
    const email = `repo_${randomUUID()}@ex.com`;
    const reg = await service.register({ email, password: 'longenough123' }, { ip: '1.1.1.1' });
    expect(reg.ok).toBe(true);
    const login = await service.login({ email, password: 'longenough123' }, { ip: '1.1.1.1' });
    expect(login.ok).toBe(true);
    if (!login.ok) return;
    const v = await service.validateSession(login.sessionId);
    expect(v?.user.email).toBe(email);
    await service.logout(login.sessionId);
    expect(await service.validateSession(login.sessionId)).toBeNull();
  });

  it('parameterized queries neutralize SQL injection', async () => {
    const evil = "x'; DROP TABLE users; --";
    const repo = new PgUserRepository(pool);
    expect(await repo.findByEmail(evil)).toBeNull();
    // users table must still exist.
    const exists = (await pool.query("SELECT to_regclass('public.users') AS t")).rows[0].t;
    expect(exists).toBe('users');
  });

  it('reconnect: a fresh pool works after the previous one is used', async () => {
    // Reconnect against the SAME (isolated) database this suite migrated, not the container default.
    const p2 = createPool(suiteUrl);
    const r = await p2.query('SELECT count(*)::int AS n FROM users');
    expect(typeof r.rows[0].n).toBe('number');
    await p2.end();
  });

  it('migrate down removes all 0002 then 0001 objects', async () => {
    await migrateDown(pool);
    const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")).rows.map((r) => r.tablename);
    for (const t of ['users', 'sessions', 'ai_signals', 'permissions']) expect(tables).not.toContain(t);
    // re-apply so the suite leaves a valid schema.
    await migrateUp(pool);
  });
});
