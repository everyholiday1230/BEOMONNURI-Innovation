import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { createPool, migrateUp } from '../db/pg';
import { createIsolatedTestDatabase } from './helpers/pg-test-db';
import { PgCredentialRepo } from '../db/pg-credential-repo';

/**
 * 거래소 자격증명 저장소 (PostgreSQL) 검사.
 *
 * ★★ 왜 이 검사가 필요한가 — 실제로 겪은 고장
 *
 *   자격증명은 SQLite 에, 회원은 PostgreSQL 에 있었다. `exchange_credentials`
 *   에는 `user_id → users(id)` 외래키가 있으므로 SQLite 쪽에 그 회원이 없어
 *   **키 등록이 500(FOREIGN KEY constraint failed)** 이 났다.
 *
 *   읽기 경로는 빈 목록을 주므로(`credentialStatus: NONE`) 화면상 "아직 연결
 *   안 함" 과 구분되지 않았다. 실제 키로 등록을 시도할 때까지 아무도 몰랐다 —
 *   그때까지 이 서비스는 **어떤 고객도 거래소를 연결할 수 없는 상태**였다.
 *
 *   그래서 같은 회원 저장소(PostgreSQL) 위에서 등록이 되는지를 고정한다.
 */
const URL = process.env.PG_TEST_URL;

const ENC = {
  accessKeyMasked: 'abcd…wxyz',
  encryptedAccessKey: 'enc-ak',
  encryptedSecretKey: 'enc-sk',
  encryptedMemo: 'enc-memo',
  wrappedDek: 'wrapped',
  encryptionKeyVersion: 'v1',
  algo: 'aes-256-gcm',
};

describe.skipIf(!URL)('CRED-PG 거래소 자격증명 저장 (PostgreSQL)', () => {
  let pool: Pool;
  let userId: string;
  let otherId: string;

  beforeAll(async () => {
    const suiteUrl = await createIsolatedTestDatabase(URL!, 'pg_credentials');
    pool = createPool(suiteUrl);
    await migrateUp(pool);
    userId = randomUUID();
    otherId = randomUUID();
    for (const id of [userId, otherId]) {
      await pool.query(
        'INSERT INTO users (id, email, password_hash, status) VALUES ($1,$2,$3,$4)',
        [id, `u_${id}@ex.com`, 'scrypt$1$1$1$a$b', 'active'],
      );
    }
  });

  afterAll(async () => { await pool.end(); });

  it('[1] ★★ PostgreSQL 회원으로 등록이 된다 (외래키 위반이 없다)', async () => {
    const repo = new PgCredentialRepo(pool);
    const row = await repo.create(userId, ENC, 'my key', 'kucoin');
    expect(row.id).toBeTruthy();
    expect(row.exchange).toBe('kucoin');
    expect(row.connectionStatus).toBe('UNVERIFIED');
    // 방금 넣은 행을 다시 읽을 수 있어야 한다 — 못 읽으면 목록에 없는 키가 된다.
    const read = await repo.getOwned(userId, row.id);
    expect(read?.id).toBe(row.id);
  });

  it('[2] ★ 거래소 이름이 저장된다 (기본값으로 덮이지 않는다)', async () => {
    /*
       전에 'bitmart' 가 박혀 있어서 KuCoin 키를 저장해도 화면에 bitmart 로
       보였다. 어느 거래소 키인지 모르면 이용자가 멀쩡한 키를 지운다.
    */
    const repo = new PgCredentialRepo(pool);
    const row = await repo.create(userId, ENC, null as unknown as string, 'kucoin');
    expect(row.exchange).toBe('kucoin');
  });

  it('[3] ★★ 남의 자격증명은 보이지 않는다', async () => {
    const repo = new PgCredentialRepo(pool);
    const mine = await repo.create(userId, ENC, 'mine', 'kucoin');
    // id 를 알아도 소유자가 아니면 읽을 수 없어야 한다.
    expect(await repo.getOwned(otherId, mine.id)).toBeNull();
    const theirs = await repo.listOwned(otherId);
    expect(theirs.find((r) => r.id === mine.id)).toBeUndefined();
  });

  it('[4] 검증 결과가 저장된다', async () => {
    const repo = new PgCredentialRepo(pool);
    const row = await repo.create(userId, ENC, 'verify me', 'kucoin');
    await repo.setVerified(userId, row.id, 'VERIFIED', true);
    const after = await repo.getOwned(userId, row.id);
    expect(after?.connectionStatus).toBe('VERIFIED');
    expect(after?.permissionsVerified).toBe(true);
  });

  it('[5] ★ 실패도 저장된다 — 검증 실패를 미검증과 섞지 않는다', async () => {
    /*
       KuCoin 이 `Invalid KC-API-PASSPHRASE` 로 거부한 키는 '아직 검증 안 함'
       이 아니라 '검증 실패' 다. 섞으면 이용자가 다시 시도할지 고칠지 알 수 없다.
    */
    const repo = new PgCredentialRepo(pool);
    const row = await repo.create(userId, ENC, 'bad key', 'kucoin');
    await repo.setVerified(userId, row.id, 'FAILED', false);
    const after = await repo.getOwned(userId, row.id);
    expect(after?.connectionStatus).toBe('FAILED');
    expect(after?.permissionsVerified).toBe(false);
  });

  it('[6] 삭제는 표시만 하고 행을 지우지 않는다', async () => {
    const repo = new PgCredentialRepo(pool);
    const row = await repo.create(userId, ENC, 'to revoke', 'kucoin');
    expect(await repo.revoke(userId, row.id)).toBe(true);
    // 목록·조회에서 사라진다.
    expect(await repo.getOwned(userId, row.id)).toBeNull();
    // 그러나 행은 남아 있다 — 감사 추적이 필요하다.
    const raw = await pool.query(
      'SELECT revoked_at FROM exchange_credentials WHERE id = $1', [row.id],
    );
    expect(raw.rows[0]).toBeTruthy();
    expect(raw.rows[0].revoked_at).not.toBeNull();
    // 두 번 삭제하면 false — 이미 없는 것을 지웠다고 말하지 않는다.
    expect(await repo.revoke(userId, row.id)).toBe(false);
  });

  it('[7] ★★ 남의 자격증명을 삭제할 수 없다', async () => {
    const repo = new PgCredentialRepo(pool);
    const mine = await repo.create(userId, ENC, 'protected', 'kucoin');
    expect(await repo.revoke(otherId, mine.id)).toBe(false);
    // 여전히 내 목록에 있어야 한다.
    expect((await repo.getOwned(userId, mine.id))?.id).toBe(mine.id);
  });

  it('[8] ★ 평문 비밀이 표에 들어가지 않는다', async () => {
    const repo = new PgCredentialRepo(pool);
    const row = await repo.create(userId, {
      ...ENC,
      encryptedSecretKey: 'ENVELOPE-ONLY',
    }, 'ciphertext', 'kucoin');
    const raw = await pool.query(
      'SELECT encrypted_secret_key, encrypted_memo FROM exchange_credentials WHERE id = $1',
      [row.id],
    );
    /*
       ★ 저장소는 봉투를 그대로 넣기만 한다. 복호화 키는 vault 가 들고 있고
         이 표에는 없다 — 표가 유출되어도 그것만으로는 열 수 없어야 한다.
    */
    expect(raw.rows[0].encrypted_secret_key).toBe('ENVELOPE-ONLY');
    expect(raw.rows[0].encrypted_memo).toBe('enc-memo');
  });
});
