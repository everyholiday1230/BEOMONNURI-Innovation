/**
 * 법적 문서 테스트.
 *
 * ★ 가장 중요한 것: **게시본은 수정되지 않는다.**
 *
 *   문구를 조용히 바꿀 수 있으면 "누가 무엇에 동의했는가" 의 증거가 사라진다.
 *   분쟁이 생기면 우리가 제시할 것이 없다.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

import { PgLegalRepo } from '../db/legal-repo';

const PG_URL = process.env.PG_TEST_URL;
const d = PG_URL ? describe : describe.skip;

d('PgLegalRepo', () => {
  let pool: Pool;
  let repo: PgLegalRepo;
  let user: string;

  /* 테스트 문서만 지우기 위한 표식. 실제 게시본을 건드리면 안 된다. */
  const TAG = 'zz-test-';
  const EMAIL_SUFFIX = '@legal-test.local';

  const ver = () => `${TAG}${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: PG_URL });
    repo = new PgLegalRepo(pool);
  });

  afterAll(async () => {
    /*
       ★ 테스트가 만든 문서만 지운다.

         `DELETE FROM legal_documents` 를 조건 없이 쓰면 운영 DB 를 가리켰을 때
         게시된 약관과 동의 기록이 사라진다. 동의 기록은 복구할 수 없다.
    */
    await pool.query(`DELETE FROM user_legal_consents WHERE version LIKE $1`, [`${TAG}%`]);
    await pool.query(`DELETE FROM legal_documents WHERE version LIKE $1`, [`${TAG}%`]);
    await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`%${EMAIL_SUFFIX}`]);
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM user_legal_consents WHERE version LIKE $1`, [`${TAG}%`]);
    await pool.query(`DELETE FROM legal_documents WHERE version LIKE $1`, [`${TAG}%`]);
    const id = randomUUID();
    await pool.query(
      `INSERT INTO users (id, email, password_hash, role, status)
       VALUES ($1, $2, 'x', 'user', 'active')`,
      [id, `lg_${id.slice(0, 8)}${EMAIL_SUFFIX}`],
    );
    user = id;
  });

  const draft = (over: Partial<Parameters<PgLegalRepo['createDraft']>[0]> = {}) =>
    repo.createDraft({
      kind: 'terms', locale: 'zz', version: ver(),
      title: 'T', body: '# T\n\nbody', ...over,
    });

  it('초안은 게시되지 않은 상태로 만들어진다', async () => {
    const doc = await draft();
    expect(doc.publishedAt).toBeNull();
  });

  it('초안은 사용자에게 보이지 않는다', async () => {
    const doc = await draft({ locale: 'zz' });
    /*
       liveFor 는 게시본만 준다.

       ★ null 을 기대하지 않는다 — 다른 언어(en)에 게시본이 있으면 대체되어
         돌아온다. 그것도 옳은 동작이다. 확인해야 할 것은 "이 초안이 아니다" 다.
    */
    const live = await repo.liveFor('terms', 'zz');
    expect(live?.id).not.toBe(doc.id);
  });

  it('게시하면 사용자에게 보인다', async () => {
    const doc = await draft();
    const pub = await repo.publish(doc.id);
    expect(pub.publishedAt).not.toBeNull();
    // 효력일을 정하지 않았으면 게시 시점부터 적용된다.
    expect(pub.effectiveAt).not.toBeNull();

    const live = await repo.liveFor('terms', 'zz');
    expect(live?.id).toBe(doc.id);
  });

  it('초안은 수정할 수 있다', async () => {
    const doc = await draft();
    const up = await repo.updateDraft(doc.id, { title: 'changed' });
    expect(up.title).toBe('changed');
  });

  /*
     ★★ 게시본은 수정할 수 없다 ★★

     조용히 바꿀 수 있으면 이미 동의한 사람이 무엇에 동의했는지 알 수 없다.
  */
  it('게시본은 수정할 수 없다', async () => {
    const doc = await draft();
    await repo.publish(doc.id);
    await expect(repo.updateDraft(doc.id, { title: 'sneaky' })).rejects.toThrow('ALREADY_PUBLISHED');

    const again = await repo.byId(doc.id);
    expect(again?.title).toBe('T');
  });

  it('두 번 게시할 수 없다', async () => {
    const doc = await draft();
    await repo.publish(doc.id);
    await expect(repo.publish(doc.id)).rejects.toThrow('ALREADY_PUBLISHED');
  });

  it('빈 문서는 게시할 수 없다', async () => {
    const doc = await draft({ body: '   ' });
    await expect(repo.publish(doc.id)).rejects.toThrow('EMPTY_BODY');
  });

  it('같은 종류·언어에 같은 버전을 두 번 만들 수 없다', async () => {
    const v = ver();
    await draft({ version: v });
    // 두 개면 어느 것에 동의했는지 알 수 없다.
    await expect(draft({ version: v })).rejects.toThrow();
  });

  it('새 버전을 게시하면 그것이 최신이 된다', async () => {
    const first = await draft();
    await repo.publish(first.id);
    await new Promise((r) => setTimeout(r, 15));
    const second = await draft();
    await repo.publish(second.id);

    const live = await repo.liveFor('terms', 'zz');
    expect(live?.id).toBe(second.id);
  });

  it('요청 언어가 없으면 영어로 대체한다', async () => {
    const en = await draft({ locale: 'en', version: ver() });
    await repo.publish(en.id);
    const live = await repo.liveFor('terms', 'zz-XX');
    // 대체됐다는 사실을 화면이 알 수 있게 locale 을 그대로 준다.
    expect(live?.locale).toBe('en');
  });

  it('언어 태그의 앞부분으로도 찾는다', async () => {
    const doc = await draft({ locale: 'zz', version: ver() });
    await repo.publish(doc.id);
    // 'zz-KR' 요청 → 'zz' 게시본
    const live = await repo.liveFor('terms', 'zz-KR');
    expect(live?.id).toBe(doc.id);
  });

  // ---- 동의 기록 ----

  it('게시된 문서에 동의를 기록한다', async () => {
    const doc = await draft();
    await repo.publish(doc.id);
    const c = await repo.recordConsent({ userId: user, documentId: doc.id, ip: '1.2.3.4' });
    expect(c?.kind).toBe('terms');
    expect(c?.version).toBe(doc.version);
  });

  it('초안에는 동의할 수 없다', async () => {
    const doc = await draft();
    // 초안에 동의를 받으면 그 동의가 무엇에 대한 것인지 불분명해진다.
    await expect(repo.recordConsent({ userId: user, documentId: doc.id })).rejects.toThrow('NOT_PUBLISHED');
  });

  it('같은 문서에 두 번 동의하지 않는다', async () => {
    const doc = await draft();
    await repo.publish(doc.id);
    const first = await repo.recordConsent({ userId: user, documentId: doc.id });
    const second = await repo.recordConsent({ userId: user, documentId: doc.id });
    expect(first).not.toBeNull();
    // 재시도는 오류가 아니다 — null 로 알린다.
    expect(second).toBeNull();
    expect(await repo.consentsOf(user)).toHaveLength(1);
  });

  it('새 버전이 나오면 다시 동의가 필요하다', async () => {
    const v1 = await draft();
    await repo.publish(v1.id);
    await repo.recordConsent({ userId: user, documentId: v1.id });
    expect(await repo.pendingConsents(user, 'zz')).toHaveLength(0);

    await new Promise((r) => setTimeout(r, 15));
    const v2 = await draft();
    await repo.publish(v2.id);

    const pending = await repo.pendingConsents(user, 'zz');
    expect(pending.map((x) => x.kind)).toContain('terms');
    expect(pending[0]?.version).toBe(v2.version);
  });

  it('사용자를 지우면 동의 기록도 사라진다', async () => {
    const doc = await draft();
    await repo.publish(doc.id);
    await repo.recordConsent({ userId: user, documentId: doc.id });
    await pool.query('DELETE FROM users WHERE id = $1', [user]);
    expect(await repo.consentsOf(user)).toHaveLength(0);
  });

  it('게시 목록이 종류별 최신을 준다', async () => {
    const a = await draft();
    await repo.publish(a.id);
    const rows = await repo.publishedKinds();
    expect(rows.some((r) => r.kind === 'terms' && r.version === a.version)).toBe(true);
  });
});
