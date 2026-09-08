/**
 * 보관기간 경과 개인정보 자동 파기.
 *
 * ★★ 무엇이 문제였나
 *
 *   개인정보처리방침은 접속기록을 3개월 후 파기한다고 약속하는데, 파기는 **수동 CLI
 *   뿐이었고 스케줄러 참조가 0건**이었다. 아무도 실행하지 않았고 `audit_logs` 576행이
 *   서비스 개시일부터 그대로 쌓여 있었다.
 *
 *   약속을 지키지 않는 것 자체가 위반이고, 더 나쁜 것은 **그 증거가 DB 에 남는다**는
 *   점이다. "3개월 후 파기한다고 적어 두고 1년치를 갖고 있었다" 가 그대로 드러난다.
 *
 * ★ 실제 Postgres 가 있을 때만 돈다(PG_TEST_URL). 없으면 건너뛴다 — 그 사실이
 *   skip 개수로 드러나야 하므로 조용히 통과시키지 않는다.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

import { createIsolatedTestDatabase } from './helpers/pg-test-db';
import { runRetentionPurge, startRetentionScheduler } from '../privacy/retention-scheduler.js';
import { RETENTION_RULES, cutoffFor, OPERATOR_RETENTION } from '../privacy/retention-policy.js';

const URL_ = process.env.PG_TEST_URL;

describe('보관기간 정책', () => {
  it('법정 의무 항목은 statutory 로 표시된다', () => {
    /*
       ★ 운영자가 임의로 줄이면 보존의무 위반이 되는 항목을 코드가 구분해야 한다.
         구분이 없으면 "짧게 바꿔 달라" 는 요청을 그대로 수행하게 된다.
    */
    expect(RETENTION_RULES.length).toBeGreaterThan(0);
    for (const r of RETENTION_RULES) {
      expect(r.days).toBeGreaterThan(0);
      expect(r.reason, `${r.table} 에 근거가 없다`).toBeTruthy();
      expect(typeof r.statutory).toBe('boolean');
    }
  });

  it('접속기록은 3개월(90일)이다 — 늘리면 수집 최소화와 충돌한다', () => {
    const audit = RETENTION_RULES.find((r) => r.table === 'audit_logs');
    expect(audit?.days).toBe(90);
    expect(audit?.statutory).toBe(true);
  });

  it('운영자 결정 항목은 따로 둔다 (자산 스냅샷 2년)', () => {
    /* 법정 의무가 없는 항목만 운영자가 정한다. */
    expect(OPERATOR_RETENTION.equitySnapshotDays).toBe(730);
  });

  it('cutoff 는 보관일수만큼 과거다', () => {
    const now = Date.UTC(2026, 8, 8);
    const rule = RETENTION_RULES[0]!;
    const cut = cutoffFor(rule, now).getTime();
    expect(now - cut).toBe(rule.days * 24 * 60 * 60 * 1000);
  });
});

describe.skipIf(!URL_)('보관기간 파기 — 실제 Postgres', () => {
  let pool: Pool;

  beforeAll(async () => {
    const url = await createIsolatedTestDatabase(URL_!, 'retention_purge');
    pool = new Pool({ connectionString: url });
    /*
       실제 표 구조를 흉내낸다. 마이그레이션 전체를 돌리지 않는 이유는 여기서 검증할
       것이 **삭제 조건**뿐이기 때문이다.
    */
    await pool.query('CREATE TABLE audit_logs (id serial primary key, at timestamptz, ip text)');
    await pool.query('CREATE TABLE admin_actions (id serial primary key, at timestamptz, ip text)');
    await pool.query('CREATE TABLE sessions (id serial primary key, expires_at timestamptz, ip text)');
  });

  afterAll(async () => { await pool?.end(); });

  it('오래된 행만 지운다 — 최근 행은 남긴다', async () => {
    const now = Date.now();
    const old = new Date(now - 200 * 24 * 3600 * 1000);   // 200일 전
    const fresh = new Date(now - 10 * 24 * 3600 * 1000);  // 10일 전
    for (const t of ['audit_logs', 'admin_actions']) {
      await pool.query(`INSERT INTO ${t} (at, ip) VALUES ($1,'1.1.1.1'), ($2,'2.2.2.2')`, [old, fresh]);
    }
    await pool.query(`INSERT INTO sessions (expires_at, ip) VALUES ($1,'1.1.1.1'), ($2,'2.2.2.2')`, [old, fresh]);

    const out = await runRetentionPurge(pool, now);
    expect(out.every((r) => !r.error), JSON.stringify(out)).toBe(true);

    for (const t of ['audit_logs', 'admin_actions', 'sessions']) {
      const { rows } = await pool.query(`SELECT ip FROM ${t}`);
      expect(rows.map((r) => r.ip), `${t} 에서 최근 행이 사라졌거나 옛 행이 남았다`)
        .toEqual(['2.2.2.2']);
    }
  });

  it('표가 없으면 오류가 아니라 skip 이다', async () => {
    await pool.query('DROP TABLE admin_actions');
    const out = await runRetentionPurge(pool, Date.now());
    const hit = out.find((r) => r.table === 'admin_actions');
    expect(hit?.skipped).toBe(true);
    expect(hit?.error).toBeUndefined();
    /* ★ 나머지 표는 계속 처리해야 한다 — 하나가 없다고 전체가 멈추면 안 된다. */
    expect(out.filter((r) => !r.skipped && !r.error).length).toBeGreaterThan(0);
  });

  it('스케줄러가 즉시 실행을 노출한다 (운영 점검용)', async () => {
    const h = startRetentionScheduler(pool, { intervalMs: 3_600_000, firstDelayMs: 3_600_000 });
    const rows = await h.runNow();
    h.stop();
    expect(Array.isArray(rows)).toBe(true);
  });
});
