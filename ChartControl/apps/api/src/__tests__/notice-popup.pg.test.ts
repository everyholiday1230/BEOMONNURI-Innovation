import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { createPool, migrateUp } from '../db/pg';
import { createIsolatedTestDatabase } from './helpers/pg-test-db';
import { PgNoticeRepo } from '../db/notice-repo';

/**
 * 공지 팝업 검사 (실제 PostgreSQL).
 *
 * ★★ 이 기능의 위험은 두 방향이다.
 *
 *   1. **너무 많이 띄운다** — 이용자가 닫는 데 익숙해져 정작 중요한 공지도 읽지
 *      않는다. 그래서 기본값이 꺼짐이어야 하고, 기존 공지가 갑자기 팝업이 되면
 *      안 된다.
 *   2. **읽었는데 또 뜬다** — 읽음을 로컬에만 두면 기기를 바꿀 때마다 다시 뜬다.
 *      그러면 이용자는 우리 화면이 고장났다고 여긴다.
 */
const URL = process.env.PG_TEST_URL;

describe.skipIf(!URL)('NOTICE-POPUP 팝업 공지', () => {
  let pool: Pool;
  let repo: PgNoticeRepo;
  let userA: string;
  let userB: string;

  beforeAll(async () => {
    const suiteUrl = await createIsolatedTestDatabase(URL!, 'notice_popup');
    pool = createPool(suiteUrl);
    await migrateUp(pool);
    repo = new PgNoticeRepo(pool);
    userA = randomUUID();
    userB = randomUUID();
    for (const id of [userA, userB]) {
      await pool.query(
        'INSERT INTO users (id, email, password_hash, status) VALUES ($1,$2,$3,$4)',
        [id, `u_${id}@ex.com`, 'scrypt$1$1$1$a$b', 'active'],
      );
    }
  });
  afterAll(async () => { await pool.end(); });

  /** 발행된 공지를 만든다. */
  async function publish(input: {
    title: string; popup?: boolean; severity?: 'info' | 'warning' | 'critical'; locale?: string;
  }) {
    const n = await repo.create({
      title: input.title, body: 'body',
      ...(input.popup === undefined ? {} : { popup: input.popup }),
      ...(input.severity ? { severity: input.severity } : {}),
      locale: input.locale ?? 'en',
    }, null);
    await repo.publish(n.id, null);
    return n.id;
  }

  it('[1] ★★ 기본값은 팝업이 아니다', async () => {
    /*
       기본값이 켜짐이면 이 기능을 추가한 순간 **기존 공지 전부가** 이용자에게
       한꺼번에 튀어나온다.
    */
    const id = await publish({ title: 'plain notice' });
    const row = await repo.get(id);
    expect(row?.popup).toBe(false);
    expect(row?.severity).toBe('info');

    const popups = await repo.listUnreadPopups(userA, 'en');
    expect(popups.find((x) => x.id === id)).toBeUndefined();
  });

  it('[2] 팝업으로 표시한 공지만 나온다', async () => {
    const id = await publish({ title: 'popup one', popup: true, severity: 'warning' });
    const popups = await repo.listUnreadPopups(userA, 'en');
    expect(popups.find((x) => x.id === id)).toBeTruthy();
  });

  it('[3] ★★ 긴급한 것이 먼저 나온다', async () => {
    await publish({ title: 'info later', popup: true, severity: 'info' });
    const crit = await publish({ title: 'critical one', popup: true, severity: 'critical' });
    const popups = await repo.listUnreadPopups(userA, 'en', 3);
    /*
       상한(limit)에 잘릴 때 가장 중요한 공지가 빠지면 안 된다 — 점검 공지가
       "새 종목 상장" 뒤로 밀려 표시되지 않는 일이 생긴다.
    */
    expect(popups[0]!.id).toBe(crit);
    expect(popups[0]!.severity).toBe('critical');
  });

  it('[4] ★ 상한을 넘겨 한꺼번에 띄우지 않는다', async () => {
    for (let i = 0; i < 6; i += 1) {
      await publish({ title: `extra ${i}`, popup: true, severity: 'warning' });
    }
    const popups = await repo.listUnreadPopups(userA, 'en', 3);
    // 오래 쌓인 팝업 20개가 한꺼번에 뜨면 화면을 쓸 수 없다.
    expect(popups.length).toBeLessThanOrEqual(3);
  });

  it('[5] ★★ 읽으면 다시 나오지 않는다 (서버 기록)', async () => {
    const id = await publish({ title: 'read me', popup: true, severity: 'warning' });
    expect(await repo.markRead(userA, id)).toBe(true);
    const popups = await repo.listUnreadPopups(userA, 'en', 10);
    expect(popups.find((x) => x.id === id)).toBeUndefined();
    /*
       ★ 읽음이 **서버에** 있으므로 다른 기기에서도 뜨지 않는다. 로컬 저장이면
         브라우저를 바꿀 때마다 같은 팝업을 본다.
    */
  });

  it('[6] ★★ 읽음은 사람마다 따로다', async () => {
    const id = await publish({ title: 'per user', popup: true, severity: 'warning' });
    await repo.markRead(userA, id);
    const forB = await repo.listUnreadPopups(userB, 'en', 10);
    // A 가 읽었다고 B 에게 안 보이면, B 는 점검 공지를 영원히 못 본다.
    expect(forB.find((x) => x.id === id)).toBeTruthy();
  });

  it('[7] 두 번 읽어도 오류가 아니다', async () => {
    const id = await publish({ title: 'twice', popup: true, severity: 'info' });
    expect(await repo.markRead(userA, id)).toBe(true);
    // 두 기기에서 동시에 닫을 수 있다.
    expect(await repo.markRead(userA, id)).toBe(true);
  });

  it('[8] ★★ 없는 공지를 읽음 처리하면 실패한다', async () => {
    /*
       성공으로 위장하면 화면이 팝업을 닫고, 서버에는 기록이 없어 다음 로그인에
       또 뜬다 — 이용자는 우리 화면이 고장났다고 여긴다.
    */
    expect(await repo.markRead(userA, randomUUID())).toBe(false);
  });

  it('[9] 언어가 다른 공지는 나오지 않는다', async () => {
    const ja = await publish({ title: 'にほんご', popup: true, severity: 'warning', locale: 'ja' });
    const en = await repo.listUnreadPopups(userB, 'en', 10);
    // 읽을 수 없는 언어의 공지를 띄우면 이용자는 무슨 일인지 알 수 없다.
    expect(en.find((x) => x.id === ja)).toBeUndefined();
    const jaList = await repo.listUnreadPopups(userB, 'ja', 10);
    expect(jaList.find((x) => x.id === ja)).toBeTruthy();
  });

  it('[10] ★ 발행하지 않은 공지는 나오지 않는다', async () => {
    const n = await repo.create(
      { title: 'draft popup', body: 'x', popup: true, severity: 'critical', locale: 'en' },
      null,
    );
    const popups = await repo.listUnreadPopups(userB, 'en', 10);
    // 초안이 이용자에게 튀어나오면 작성 중인 글이 공개된다.
    expect(popups.find((x) => x.id === n.id)).toBeUndefined();
  });

  it('[11] ★ 잘못된 긴급도는 저장되지 않는다', async () => {
    /*
       오타('critcal')가 조용히 저장되면 화면이 모르는 값으로 취급해 **가장 약한
       표시**로 떨어진다 — 긴급 공지가 배너로 지나간다. DB CHECK 제약으로 막는다.
    */
    await expect(pool.query(
      "INSERT INTO notices (id, title, body, status, locale, popup, severity, created_at, updated_at)"
      + " VALUES ($1,'bad','x','published','en',TRUE,'critcal', now(), now())",
      [randomUUID()],
    )).rejects.toThrow();
  });
});
