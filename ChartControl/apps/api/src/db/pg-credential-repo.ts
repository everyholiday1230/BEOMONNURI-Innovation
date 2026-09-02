import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { CredentialRow } from './trading-repos';
import type { EncryptedCredential } from '../trading/credential-vault';

/**
 * 거래소 자격증명 저장소 (PostgreSQL).
 *
 * ★★ 왜 만들었는가 — 실제로 겪은 고장
 *
 *   회원은 PostgreSQL 에, 자격증명은 SQLite 에 있었다. `exchange_credentials`
 *   에는 `user_id → users(id)` 외래키가 걸려 있으므로, SQLite 쪽에 그 회원이
 *   없으면 저장이 실패한다.
 *
 *   결과: **거래소 API 키를 연결할 수 없었다.** 등록을 시도하면
 *   `FOREIGN KEY constraint failed` 로 500 이 났다. 읽기 경로는 빈 목록을
 *   돌려주므로(`credentialStatus: NONE`) 화면상으로는 "아직 연결 안 함" 과
 *   구분되지 않아, 실제 키로 시도해 보기 전까지 드러나지 않았다.
 *
 * ★ 인터페이스가 비동기다.
 *
 *   SQLite 판은 동기였다(better-sqlite3). PostgreSQL 은 비동기이므로 같은
 *   모양을 유지할 수 없다. 호출부를 모두 `await` 로 바꿨다 — 동기처럼 보이게
 *   감싸면(예: 결과 캐시) 방금 저장한 값을 못 읽는 경우가 생기고, 그때는
 *   "키를 등록했는데 목록에 없다" 로 나타난다.
 *
 * 불변식
 * -----
 * 1. 평문 비밀은 저장하지 않는다 — 봉투(암호문)만 넣고, 읽을 때도 암호문만 준다.
 * 2. 모든 조회에 `user_id` 를 함께 건다. id 만으로 찾으면 남의 키를 만질 수 있다.
 * 3. 삭제는 `revoked_at` 표시다(행을 지우지 않는다) — 감사 추적이 남아야 한다.
 * 4. ★★ 시간 칸은 `timestamptz` 다 — SQLite 판의 BIGINT 밀리초가 아니다.
 *    같은 이름의 표지만 형식이 다르다. 밀리초 숫자를 그대로 넣으면
 *    `1786778768135` 를 시각으로 해석해 실패하거나 엉뚱한 연도가 된다.
 *    그래서 `now()` 와 `to_timestamp` 를 쓰고, 숫자를 직접 넣지 않는다.
 */
export class PgCredentialRepo {
  constructor(private readonly pool: Pool) {}

  async create(
    userId: string,
    enc: EncryptedCredential,
    label?: string,
    exchange = 'bitmart',
  ): Promise<CredentialRow> {
    const id = randomUUID();
    await this.pool.query(
      `INSERT INTO exchange_credentials (
         id, user_id, exchange, label, access_key_masked,
         encrypted_access_key, encrypted_secret_key, encrypted_memo,
         wrapped_dek, encryption_key_version, algo,
         permissions_verified, ip_whitelist_confirmed, connection_status,
         created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,FALSE,FALSE,'UNVERIFIED',now(),now())`,
      [
        id, userId, exchange, label ?? null, enc.accessKeyMasked,
        enc.encryptedAccessKey, enc.encryptedSecretKey, enc.encryptedMemo,
        enc.wrappedDek, enc.encryptionKeyVersion, enc.algo,
      ],
    );
    const row = await this.getOwned(userId, id);
    if (!row) {
      /*
         ★ 방금 넣은 행을 못 읽으면 그대로 알린다. 빈 값을 만들어 돌려주면
           화면은 "등록 성공" 을 보여주고 목록에는 없는 상태가 된다.
      */
      throw new Error('credential was inserted but could not be read back');
    }
    return row;
  }

  async getOwned(userId: string, id: string): Promise<CredentialRow | null> {
    const r = await this.pool.query(
      'SELECT * FROM exchange_credentials WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
      [id, userId],
    );
    return r.rows[0] ? mapRow(r.rows[0] as Record<string, unknown>) : null;
  }

  async listOwned(userId: string): Promise<CredentialRow[]> {
    const r = await this.pool.query(
      'SELECT * FROM exchange_credentials WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at ASC',
      [userId],
    );
    return r.rows.map((row) => mapRow(row as Record<string, unknown>));
  }

  async setVerified(
    userId: string,
    id: string,
    status: string,
    permissionsVerified: boolean,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE exchange_credentials
          SET connection_status = $1, permissions_verified = $2, last_verified_at = now(), updated_at = now()
        WHERE id = $3 AND user_id = $4`,
      [status, permissionsVerified, id, userId],
    );
  }

  /*
     사용 기록.

     ★★ 예외를 밖으로 내지 않는다 — 사용 기록 실패가 주문을 실패시키면 안 된다.
       그래도 조용히 넘기지 않고 로그를 남긴다.

     ★ user_id 조건을 두지 않는다. 호출자는 이미 소유권을 확인한 뒤(getOwned)
       이 키를 쓰고 있고, 여기서 다시 조건을 걸면 인자를 하나 더 옮겨야 한다.
       revoked_at IS NULL 만은 유지한다 — 폐기된 키를 쓴 기록은 남기지 않는다.
  */
  async markUsed(id: string): Promise<void> {
    try {
      await this.pool.query(
        'UPDATE exchange_credentials SET last_used_at = now(), updated_at = now() WHERE id = $1 AND revoked_at IS NULL',
        [id],
      );
    } catch (e) {
      console.warn('[cred] markUsed 실패 — 사용 기록만 누락되고 주문은 계속한다:', (e as Error).message);
    }
  }

  async revoke(userId: string, id: string): Promise<boolean> {
    const r = await this.pool.query(
      'UPDATE exchange_credentials SET revoked_at = now(), updated_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL',
      [id, userId],
    );
    return (r.rowCount ?? 0) > 0;
  }
}

/**
 * 행 → 도메인 객체.
 *
 * ★ 컬럼 이름이 snake_case 다. 여기서 한 번만 변환하고, 위쪽 코드는 camelCase 만 본다.
 */
function mapRow(r: Record<string, unknown>): CredentialRow {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    exchange: String(r.exchange),
    label: (r.label as string | null) ?? null,
    accessKeyMasked: String(r.access_key_masked),
    encryptedAccessKey: String(r.encrypted_access_key),
    encryptedSecretKey: String(r.encrypted_secret_key),
    encryptedMemo: String(r.encrypted_memo),
    wrappedDek: String(r.wrapped_dek),
    encryptionKeyVersion: String(r.encryption_key_version),
    algo: String(r.algo),
    permissionsVerified: r.permissions_verified === true,
    ipWhitelistConfirmed: r.ip_whitelist_confirmed === true,
    connectionStatus: String(r.connection_status),
    // ★ 없으면 null. 0 으로 떨어뜨리면 "1970년에 쓰임" 이 된다.
    lastUsedAt: r.last_used_at instanceof Date ? r.last_used_at.getTime()
      : r.last_used_at === null || r.last_used_at === undefined ? null : Number(new Date(String(r.last_used_at)).getTime()),
  };
}
