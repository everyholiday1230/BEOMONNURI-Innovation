/**
 * 공지 저장소 테스트.
 *
 * 여기서 확인하는 것은 "무엇이 사용자에게 보이는가" 다. 이 판단이 틀리면
 * 초안이 전체 공개되거나, 끝난 점검 공지가 계속 떠서 사용자가 현재 상태를
 * 오해한다. 둘 다 사후에 되돌릴 수 없는 종류의 사고다.
 */

import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PgNoticeRepo } from '../db/notice-repo';

const URL = process.env.PG_TEST_URL;
const d = URL ? describe : describe.skip;

d('PgNoticeRepo', () => {
  let pool: Pool;
  let repo: PgNoticeRepo;
  let actorId: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL });
    repo = new PgNoticeRepo(pool);
    // 감사 추적 컬럼이 users 를 참조하므로 실제 사용자가 필요하다.
    actorId = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, role, status)
       VALUES ($1, $2, 'x', 'ADMIN', 'active') ON CONFLICT DO NOTHING`,
      [actorId, `notice-test-${actorId.slice(0, 8)}@test.local`],
    );
  });

  afterAll(async () => {
    await pool.query('DELETE FROM notices');
    await pool.query('DELETE FROM users WHERE id = $1', [actorId]);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM notices');
  });

  it('작성하면 초안이다 — 실수로 전체 공개되지 않는다', async () => {
    const n = await repo.create({ title: '점검 안내' }, actorId);
    expect(n.status).toBe('draft');
    expect(n.publishedAt).toBeNull();

    // 사용자에게는 보이지 않는다.
    expect(await repo.listVisible()).toHaveLength(0);
  });

  it('게시하면 사용자에게 보이고 published_at 이 남는다', async () => {
    const n = await repo.create({ title: '점검 안내' }, actorId);
    const p = await repo.publish(n.id, actorId);

    expect(p?.status).toBe('published');
    expect(p?.publishedAt).toBeTypeOf('number');

    const visible = await repo.listVisible();
    expect(visible.map((x) => x.title)).toEqual(['점검 안내']);
  });

  it('다시 게시해도 최초 게시 시각을 보존한다', async () => {
    const n = await repo.create({ title: 'a' }, actorId);
    const first = await repo.publish(n.id, actorId);
    await new Promise((r) => setTimeout(r, 30));
    const second = await repo.publish(n.id, actorId);

    // 언제 처음 공개됐는지는 나중에 확인해야 할 사실이다.
    expect(second?.publishedAt).toBe(first?.publishedAt);
  });

  it('만료된 공지는 숨는다 — 끝난 점검이 계속 떠 있으면 안 된다', async () => {
    const n = await repo.create({ title: '끝난 점검', expiresAt: Date.now() - 60_000 }, actorId);
    await repo.publish(n.id, actorId);

    expect(await repo.listVisible()).toHaveLength(0);
    // 관리자 목록에는 남는다 — 무엇을 공지했는지는 확인할 수 있어야 한다.
    expect(await repo.listAll()).toHaveLength(1);
  });

  it('예약 게시는 시각이 되기 전까지 숨는다', async () => {
    const n = await repo.create({ title: '예약', publishAt: Date.now() + 3_600_000 }, actorId);
    await repo.publish(n.id, actorId);

    expect(await repo.listVisible()).toHaveLength(0);
  });

  it('과거 publishAt 은 즉시 보인다', async () => {
    const n = await repo.create({ title: '이미 시작', publishAt: Date.now() - 60_000 }, actorId);
    await repo.publish(n.id, actorId);

    expect(await repo.listVisible()).toHaveLength(1);
  });

  it('고정 공지가 먼저 온다', async () => {
    const a = await repo.create({ title: '일반' }, actorId);
    await repo.publish(a.id, actorId);
    await new Promise((r) => setTimeout(r, 20));
    const b = await repo.create({ title: '고정', pinned: true }, actorId);
    await repo.publish(b.id, actorId);

    // 시간순이면 '일반' 이 먼저지만, 고정이 우선한다.
    expect((await repo.listVisible()).map((x) => x.title)).toEqual(['고정', '일반']);
  });

  it('내림은 즉시 사용자에게서 감춘다', async () => {
    const n = await repo.create({ title: '잘못된 공지' }, actorId);
    await repo.publish(n.id, actorId);
    expect(await repo.listVisible()).toHaveLength(1);

    await repo.unpublish(n.id, actorId);
    expect(await repo.listVisible()).toHaveLength(0);
  });

  it('보관은 숨기지만 삭제하지 않는다', async () => {
    const n = await repo.create({ title: '지난 공지' }, actorId);
    await repo.publish(n.id, actorId);
    await repo.archive(n.id, actorId);

    expect(await repo.listVisible()).toHaveLength(0);
    const all = await repo.listAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.status).toBe('archived');
  });

  it('수정은 게시 상태를 바꾸지 않는다 — 제목만 고치려다 게시되면 안 된다', async () => {
    const n = await repo.create({ title: '초안' }, actorId);
    const u = await repo.update(n.id, { title: '고친 초안' }, actorId);

    expect(u?.title).toBe('고친 초안');
    expect(u?.status).toBe('draft');
    expect(await repo.listVisible()).toHaveLength(0);
  });

  it('언어별로 걸러낸다', async () => {
    for (const [title, locale] of [['English notice', 'en'], ['한국어 공지', 'ko']] as const) {
      const n = await repo.create({ title, locale }, actorId);
      await repo.publish(n.id, actorId);
    }

    expect((await repo.listVisible('ko')).map((x) => x.title)).toEqual(['한국어 공지']);
    expect((await repo.listVisible('en')).map((x) => x.title)).toEqual(['English notice']);
    // 언어를 지정하지 않으면 전부 나온다.
    expect(await repo.listVisible()).toHaveLength(2);
  });

  it('0 과 음수 타임스탬프는 값 없음으로 본다 — 1970년으로 저장하면 즉시 만료된다', async () => {
    const n = await repo.create({ title: 'a', expiresAt: 0, publishAt: -1 }, actorId);
    expect(n.expiresAt).toBeNull();
    expect(n.publishAt).toBeNull();

    await repo.publish(n.id, actorId);
    expect(await repo.listVisible()).toHaveLength(1);
  });

  it('없는 공지에 대한 동작은 null 이다 (조용히 성공하지 않는다)', async () => {
    const fake = randomUUID();
    expect(await repo.publish(fake, actorId)).toBeNull();
    expect(await repo.unpublish(fake, actorId)).toBeNull();
    expect(await repo.archive(fake, actorId)).toBeNull();
    expect(await repo.update(fake, { title: 'x' }, actorId)).toBeNull();
    expect(await repo.get(fake)).toBeNull();
  });

  it('작성자를 기록한다 — 잘못된 공지의 책임 소재를 확인할 수 있어야 한다', async () => {
    const n = await repo.create({ title: 'a' }, actorId);
    expect(n.createdBy).toBe(actorId);
    expect(n.updatedBy).toBe(actorId);
  });
});
