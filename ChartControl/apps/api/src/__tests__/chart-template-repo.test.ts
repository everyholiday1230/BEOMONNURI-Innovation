import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { Pool } from 'pg';
import { createPool, migrateUp } from '../db/pg';
import { createIsolatedTestDatabase } from './helpers/pg-test-db';
import { randomUUID } from 'node:crypto';
import {
  PgChartTemplateRepo,
  MAX_CHART_TEMPLATES,
  MAX_TEMPLATE_PAYLOAD_CHARS,
} from '../db/chart-template-repo';

/*
   차트 템플릿 저장소.

   왜 이 테스트가 필요한가
   -------------------
   템플릿이 localStorage 에만 있어서 기기를 바꾸면 사라졌다. 서버로 옮기면서
   중요한 계약이 생겼다 — 특히 **남의 템플릿을 읽거나 지울 수 없어야** 한다.
   그 계약이 깨지면 사용자 데이터가 섞인다.

   PG_TEST_URL 이 없으면 건너뛴다(기록에 남는다).
*/
const PG_URL = process.env.PG_TEST_URL;
const d = PG_URL ? describe : describe.skip;

d('chart templates (real Postgres)', () => {
  let pool: Pool;
  let repo: PgChartTemplateRepo;
  let userA = '';
  let userB = '';

  beforeAll(async () => {
    /* ★ 스키마를 적용한 격리 DB (빈 DB 에서 users 부재로 전부 실패하던 것을 고침). */
    pool = createPool(await createIsolatedTestDatabase(PG_URL!, 'chart_template_repo'));
    await migrateUp(pool);
    repo = new PgChartTemplateRepo(pool);
    /* ★ users.id 에 DB 기본값이 없다 — 명시적으로 넣어야 한다.
         (기존 테스트들도 randomUUID() 를 직접 넘긴다) */
    const mk = async (email: string) => {
      const id = randomUUID();
      const r = await pool.query(
        `INSERT INTO users (id, email, password_hash, role, status)
              VALUES ($1, $2, 'x', 'user', 'active')
         ON CONFLICT (email) DO UPDATE SET status = 'active'
           RETURNING id`,
        [id, email],
      );
      return String(r.rows[0].id);
    };
    userA = await mk('tpl-a@test.local');
    userB = await mk('tpl-b@test.local');
  });

  afterAll(async () => {
    /* ★ beforeAll 이 실패하면 userA/userB 가 빈 문자열이다. 그대로 uuid 배열에
         넣으면 정리 쿼리가 또 터져서 원인 파악이 어려워진다. */
    const ids = [userA, userB].filter((x) => x.length > 0);
    if (ids.length > 0) {
      await pool.query('DELETE FROM chart_templates WHERE user_id = ANY($1::uuid[])', [ids]);
    }
    await pool.query('DELETE FROM users WHERE email IN ($1,$2)', ['tpl-a@test.local', 'tpl-b@test.local']);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM chart_templates WHERE user_id = ANY($1::uuid[])', [[userA, userB]]);
  });

  const payload = { indicators: [{ name: 'MA', calcParams: [20] }], candleType: 'candle_solid' };

  it('[1] 저장하고 다시 읽는다 — payload 를 그대로 보존한다', async () => {
    const out = await repo.save(userA, { name: '기본', symbol: 'BTCUSDT', timeframe: '15m', payload });
    expect(out.ok).toBe(true);
    const list = await repo.list(userA);
    expect(list).toHaveLength(1);
    expect(list[0]!.name).toBe('기본');
    expect(list[0]!.symbol).toBe('BTCUSDT');
    /* payload 를 서버가 해석하지 않고 그대로 돌려주는지 — 지표 스키마가 바뀌어도
       서버를 고칠 필요가 없어야 한다. */
    expect(list[0]!.payload).toEqual(payload);
  });

  it('[2] 같은 이름은 덮어쓴다 — 목록에 같은 이름이 둘 보이지 않는다', async () => {
    await repo.save(userA, { name: '기본', payload: { v: 1 } });
    await repo.save(userA, { name: '기본', payload: { v: 2 } });
    const list = await repo.list(userA);
    expect(list).toHaveLength(1);
    expect(list[0]!.payload).toEqual({ v: 2 });
  });

  it('[3] ★ 다른 사용자의 템플릿은 보이지 않는다', async () => {
    await repo.save(userA, { name: 'A의 것', payload });
    expect(await repo.list(userB)).toHaveLength(0);
  });

  it('[4] ★ 다른 사용자의 템플릿은 지울 수 없다', async () => {
    const out = await repo.save(userA, { name: 'A의 것', payload });
    expect(out.ok).toBe(true);
    const id = out.ok ? out.template.id : '';
    /* id 를 알아도 지워지지 않아야 한다 — 소유권은 user_id 로 확인한다. */
    expect(await repo.remove(userB, id)).toBe(false);
    expect(await repo.list(userA)).toHaveLength(1);
    // 본인은 지울 수 있다.
    expect(await repo.remove(userA, id)).toBe(true);
    expect(await repo.list(userA)).toHaveLength(0);
  });

  it('[5] 없는 id 를 지우면 false — 예외를 던지지 않는다', async () => {
    expect(await repo.remove(userA, '00000000-0000-0000-0000-000000000000')).toBe(false);
  });

  it('[6] 개수 상한을 넘기면 이유를 알린다', async () => {
    for (let i = 0; i < MAX_CHART_TEMPLATES; i += 1) {
      const r = await repo.save(userA, { name: `t${i}`, payload: { i } });
      expect(r.ok).toBe(true);
    }
    const over = await repo.save(userA, { name: 'one-more', payload: {} });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toBe('tooMany');
  });

  it('[7] ★ 상한에 걸려도 기존 템플릿 수정은 막지 않는다', async () => {
    for (let i = 0; i < MAX_CHART_TEMPLATES; i += 1) {
      await repo.save(userA, { name: `t${i}`, payload: { i } });
    }
    /* 상한에 걸렸다고 수정까지 막으면 사용자가 정리도 못 하는 상태에 빠진다. */
    const edit = await repo.save(userA, { name: 't0', payload: { edited: true } });
    expect(edit.ok).toBe(true);
    const list = await repo.list(userA);
    expect(list).toHaveLength(MAX_CHART_TEMPLATES);
    expect(list.find((x) => x.name === 't0')!.payload).toEqual({ edited: true });
  });

  it('[8] 너무 큰 payload 는 거부한다 — 한 사용자가 DB 를 부풀릴 수 없다', async () => {
    const huge = { blob: 'x'.repeat(MAX_TEMPLATE_PAYLOAD_CHARS + 10) };
    const out = await repo.save(userA, { name: 'huge', payload: huge });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('tooLarge');
    expect(await repo.list(userA)).toHaveLength(0);
  });

  it('[9] 빈 이름·공백만 있는 이름은 거부한다', async () => {
    for (const bad of ['', '   ', '\t']) {
      const out = await repo.save(userA, { name: bad, payload });
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toBe('invalidName');
    }
  });

  it('[10] 목록은 최근 수정 순이다', async () => {
    await repo.save(userA, { name: 'old', payload: {} });
    await new Promise((r) => setTimeout(r, 20));
    await repo.save(userA, { name: 'new', payload: {} });
    const list = await repo.list(userA);
    expect(list.map((x) => x.name)).toEqual(['new', 'old']);
  });

  it('[11] schemaVersion 을 보존한다 — 나중에 형식이 바뀌어도 변환할 수 있다', async () => {
    await repo.save(userA, { name: 'v2', payload: {}, schemaVersion: 2 });
    const list = await repo.list(userA);
    expect(list[0]!.schemaVersion).toBe(2);
  });
});
