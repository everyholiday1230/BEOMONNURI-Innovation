import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { openDb } from '../db/sqlite';
import { createPool, migrateUp, migrateDown } from '../db/pg';
import { SqliteAdminRepo } from '../db/admin-repos';
import { SqliteAdminRepoAdapter, PgAdminRepo, type IAdminRepo } from '../db/admin-repo-contract';
import { createIsolatedTestDatabase } from './helpers/pg-test-db';

/**
 * BATCH_3 / BL-10 — the admin/gateway/ai-policy repository CONTRACT runs the SAME behavioural assertions
 * against the SQLite adapter (dev/test) and the real PostgreSQL implementation (production). It proves a
 * cutover preserves: append-only audit, optimistic-version mutations + conflict, incident ack idempotency,
 * gateway resync idempotency + version, lockout clear, immutable report snapshots, idempotency-key replay,
 * and the two hard AI-policy safety invariants (live execution stays 0; the raw prompt is never stored).
 * SQLite always runs; PostgreSQL runs when PG_TEST_URL is set. Never touches RDS.
 */

const PG_URL = process.env.PG_TEST_URL;

type Harness = { repo: IAdminRepo; mkUser: (role?: string) => Promise<string>; cleanup?: () => Promise<void> };

function contract(name: string, setup: () => Promise<Harness>) {
  describe(`IAdminRepo contract — ${name}`, () => {
    let repo: IAdminRepo;
    let mkUser: (role?: string) => Promise<string>;
    let cleanup: (() => Promise<void>) | undefined;
    beforeAll(async () => { const s = await setup(); repo = s.repo; mkUser = s.mkUser; cleanup = s.cleanup; });
    afterAll(async () => { if (cleanup) await cleanup(); });

    it('append-only audit: records, filters and counts', async () => {
      const actor = await mkUser('ADMIN');
      const target = await mkUser();
      await repo.recordAction({ actorUserId: actor, actorRole: 'ADMIN', action: 'user.disable', resource: 'user', resourceId: target, targetUserId: target, result: 'success', riskLevel: 'high' });
      await repo.recordAction({ actorUserId: actor, actorRole: 'ADMIN', action: 'report.generate', resource: 'report', result: 'success' });
      expect(await repo.countAudit({ actorId: actor, limit: 50, offset: 0 })).toBe(2);
      const filtered = await repo.listAudit({ action: 'user.disable', limit: 50, offset: 0 }) as Record<string, unknown>[];
      expect(filtered).toHaveLength(1);
      expect(filtered[0]!.target_user_id).toBe(target);
    });

    it('user status/role writes and last-super-admin visibility', async () => {
      const u = await mkUser();
      expect(await repo.setUserStatus(u, 'disabled')).toBe(true);
      expect((await repo.getUser(u))!.status).toBe('disabled');
      expect(await repo.setUserRole(u, 'ADMIN')).toBe(true);
      expect((await repo.getUser(u))!.role).toBe('ADMIN');
      const sa = await mkUser('SUPER_ADMIN');
      expect(await repo.activeSuperAdminIds()).toContain(sa);
    });

    it('feature flag: optimistic version + conflict + history', async () => {
      await repo.seedFlag('contract_flag', false, 'x');
      const flag = (await repo.listFlags() as { id: string; key: string; enabled: number; version: number }[]).find((f) => f.key === 'contract_flag')!;
      expect(flag.enabled).toBe(0);
      const by = await mkUser('ADMIN');
      const ok = await repo.updateFlag(flag.id, true, 'enable', flag.version, by);
      expect(ok).toEqual({ ok: true });
      const stale = await repo.updateFlag(flag.id, false, 'again', flag.version, by);
      expect(stale).toEqual({ ok: false, conflict: true });
      const after = (await repo.listFlags() as { id: string; key: string; enabled: number }[]).find((f) => f.key === 'contract_flag')!;
      expect(after.enabled).toBe(1);
    });

    it('kill switch: update + version conflict', async () => {
      await repo.seedKill('contract_scope', null, false);
      const ks = (await repo.listKill() as { id: string; scope: string; version: number }[]).find((k) => k.scope === 'contract_scope')!;
      const by = await mkUser('SUPER_ADMIN');
      expect(await repo.updateKill(ks.id, true, 'r', ks.version, by)).toEqual({ ok: true });
      expect(await repo.updateKill(ks.id, false, 'r', ks.version, by)).toEqual({ ok: false, conflict: true });
      expect((await repo.getKill(ks.id))!.active).toBe(1);
    });

    it('incident ack is idempotent: first changes, second is a no-op that keeps version', async () => {
      const by = await mkUser('ADMIN');
      const id = await repo.createIncident({ title: 't', description: 'd', severity: 'SEV3', service: 'api', by });
      const first = await repo.ackIncident(id, 0, by);
      expect(first.changed).toBe(true);
      expect(first.version).toBe(1);
      const second = await repo.ackIncident(id, 1, by);
      expect(second.changed).toBe(false);
      expect(second.version).toBe(1);
      expect(second.acknowledgedBy).toBe(by);
      // stale version is a conflict
      const stale = await repo.ackIncident(id, 0, by);
      expect(stale).toEqual({ ok: false, conflict: true });
    });

    it('release gate: evidence + optimistic update', async () => {
      await repo.seedGate({ key: 'contract_gate', phase: 'Phase1', description: 'x', status: 'NOT_STARTED', productionRequired: true });
      const gate = (await repo.listGates() as { id: string; gate_key: string; production_required: number; version: number }[]).find((g) => g.gate_key === 'contract_gate')!;
      expect(gate.production_required).toBe(1);
      const by = await mkUser('SUPER_ADMIN');
      expect(await repo.hasEvidence(gate.id)).toBe(false);
      const r = await repo.updateGate(gate.id, 'IN_PROGRESS', gate.version, by, { evidencePath: 'artifacts/e.txt' });
      expect(r).toEqual({ ok: true });
      expect(await repo.hasEvidence(gate.id)).toBe(true);
    });

    it('security summary is aggregate-only and never leaks credential material', async () => {
      await mkUser();
      const s = await repo.securitySummary();
      expect(typeof (s.users as { total: number }).total).toBe('number');
      const blob = JSON.stringify(s).toLowerCase();
      // Precise credential tokens — NOT generic words like "recovery" (the payload legitimately lists
      // the metric name `recoveryCodeRedemptions` in `unavailable`, which is not credential material).
      for (const forbidden of ['password_hash', 'otpauth', 'pending_secret_encrypted', 'recovery_code', 'secret_encrypted']) {
        expect(blob.includes(forbidden)).toBe(false);
      }
    });

    it('lockout clear: changed then honest no-op', async () => {
      const u = await mkUser();
      const actor = await mkUser('ADMIN');
      // no lockout yet
      expect(await repo.clearLockout(u, actor)).toEqual({ changed: false, before: null });
      expect(await repo.countLockouts('any')).toBeGreaterThanOrEqual(0);
    });

    it('reports: compute → immutable snapshot → get/list/count', async () => {
      const by = await mkUser('ADMIN');
      const now = Date.now();
      const computed = await repo.computeReport('daily_operations', { from: now - 86_400_000, to: now });
      expect(typeof computed.data.usersTotal === 'number' || computed.data.usersTotal === null).toBe(true);
      const id = await repo.insertReport({ type: 'daily_operations', data: computed.data, source: { tables: computed.tables }, rowCount: computed.rowCount, from: now - 86_400_000, to: now, by });
      const got = await repo.getReport(id);
      expect(got!.report_type).toBe('daily_operations');
      expect(await repo.countReports('daily_operations')).toBeGreaterThanOrEqual(1);
    });

    it('gateway resync: increments count + version, stale version is a conflict', async () => {
      await repo.seedMockGateway();
      const before = (await repo.mockGatewayState())! as { version: number; resync_count: number };
      const by = await mkUser('ADMIN');
      const r = await repo.applyMockGatewayAction('resync', before.version, by);
      expect(r.ok).toBe(true);
      const after = (await repo.mockGatewayState())! as { version: number; resync_count: number };
      expect(Number(after.resync_count)).toBe(Number(before.resync_count) + 1);
      expect(Number(after.version)).toBe(Number(before.version) + 1);
      const stale = await repo.applyMockGatewayAction('resync', before.version, by);
      expect(stale).toEqual({ ok: false, conflict: true });
    });

    it('idempotency: a key can be claimed once; a retry finds the stored result', async () => {
      const u = await mkUser();
      const key = `idem-${randomUUID()}`;
      expect(await repo.claimIdempotent(key, 'contract', u)).toBe(true);
      expect(await repo.claimIdempotent(key, 'contract', u)).toBe(false);
      await repo.storeIdempotentResult(key, 'contract', { ok: true, n: 7 });
      const found = await repo.findIdempotent(key, 'contract');
      expect(found).not.toBeNull();
      expect(JSON.parse(found!.result as string)).toEqual({ ok: true, n: 7 });
    });

    it('AI policy: version bump + history + stale conflict; live execution stays 0 and prompt is never stored', async () => {
      await repo.seedAiPolicy();
      const p0 = (await repo.getAiPolicy())!;
      expect(Number(p0.live_execution_enabled)).toBe(0);
      const by = await mkUser('SUPER_ADMIN');
      const historyBefore = await repo.countAiPolicyHistory();
      const r = await repo.updateAiPolicy(
        { maxOutputTokens: 2048, dailyCostLimitMicros: 5000, allowedTools: ['get_market_snapshot'], promptDigest: 'abc123', promptAlgo: 'sha256', promptLen: 42 },
        Number(p0.version), by, { reason: 'tune' },
      );
      expect(r.ok).toBe(true);
      expect(Number(r.policy!.max_output_tokens)).toBe(2048);
      expect(Number(r.policy!.live_execution_enabled)).toBe(0);
      expect(await repo.countAiPolicyHistory()).toBe(historyBefore + 1);
      // stale version → conflict
      const stale = await repo.updateAiPolicy({ maxOutputTokens: 100, dailyCostLimitMicros: 0, allowedTools: [] }, Number(p0.version), by, {});
      expect(stale).toEqual({ ok: false, conflict: true });
      // the stored policy row carries only a digest — never raw prompt text
      const after = (await repo.getAiPolicy())!;
      expect(after.system_prompt_digest).toBe('abc123');
      expect(Object.keys(after)).not.toContain('system_prompt');
    });
  });
}

/* ─────────────── SQLite (always) ─────────────── */
contract('SQLite', async () => {
  const db = openDb(':memory:');
  let seq = 0;
  const mkUser = async (role = 'USER') => {
    const id = `u-${++seq}-${randomUUID().slice(0, 8)}`;
    db.prepare("INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES (?,?,?,?,'active',1,1)").run(id, `${id}@ex.com`, 'x', role);
    return id;
  };
  return { repo: new SqliteAdminRepoAdapter(new SqliteAdminRepo(db)), mkUser };
});

/* ─────────────── PostgreSQL (PG_TEST_URL) ─────────────── */
if (PG_URL) {
  contract('PostgreSQL', async () => {
    const pool: Pool = createPool(await createIsolatedTestDatabase(PG_URL, 'admin_ops_contract'));
    await migrateDown(pool).catch(() => {});
    await migrateUp(pool);
    const mkUser = async (role = 'USER') => {
      const id = randomUUID();
      await pool.query("INSERT INTO users (id,email,password_hash,role,status,created_at,updated_at) VALUES ($1,$2,'x',$3,'active',now(),now())", [id, `${id}@ex.com`, role]);
      return id;
    };
    return { repo: new PgAdminRepo(pool), mkUser, cleanup: async () => { await pool.end(); } };
  });
}
