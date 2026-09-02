import { randomUUID } from 'node:crypto';
import type { DB } from './sqlite';
import type { EncryptedCredential } from '../trading/credential-vault';
import type { IdempotencyStore } from '../trading/idempotency';

export interface CredentialRow extends EncryptedCredential {
  id: string;
  userId: string;
  exchange: string;
  label: string | null;
  permissionsVerified: boolean;
  ipWhitelistConfirmed: boolean;
  connectionStatus: string;
  /*
     ★★ 이 키가 **마지막으로 실제 쓰인** 시각(ms). 모르면 null.

       지갑 화면에 "Last used" 열이 있는데 이 값이 어디에서도 기록되지 않아
       모든 키가 영원히 "—" 로 보였다 — 주문 18건을 낸 키까지 그랬다.
       "마지막 사용" 은 고객이 **키가 몰래 쓰이는지 확인하는 필드**다. 쓰이는
       키를 "—" 로 보여주면 그 확인이 무의미해지고, 오히려 "안 쓰이는 중" 이라고
       말하는 셈이다.

       null 과 "쓰인 적 없음" 을 화면에서 구분한다 — 기록 이전에 쓰인 키가
       있으므로(실서비스에 이미 있다) "없음" 으로 단정하지 않는다.
  */
  lastUsedAt: number | null;
}

/**
 * 자격증명 저장소 계약.
 *
 * ★★ **비동기다.** SQLite 판은 동기로 끝나지만 PostgreSQL 판은 그럴 수 없다.
 *   두 판이 같은 모양이어야 라우트가 어느 배포에서든 같은 코드로 동작한다.
 *   동기 판을 그대로 두고 한쪽만 비동기로 만들면, 배포에 따라 `await` 유무가
 *   달라져 "개발에서는 되는데 실서비스에서 안 되는" 상태가 된다.
 */
export interface CredentialStore {
  create(userId: string, enc: EncryptedCredential, label?: string, exchange?: string): Promise<CredentialRow>;
  getOwned(userId: string, id: string): Promise<CredentialRow | null>;
  listOwned(userId: string): Promise<CredentialRow[]>;
  setVerified(userId: string, id: string, status: string, permissionsVerified: boolean): Promise<void>;
  /*
     이 키로 거래소를 실제 호출했음을 기록한다.

     ★ 실패해도 호출자를 막지 않는다 — 사용 기록이 주문을 실패시키면 안 된다.
       그래서 반환값이 없고, 구현이 삼킨다(단, 삼킬 때 로그를 남긴다).
  */
  markUsed(id: string): Promise<void>;
  revoke(userId: string, id: string): Promise<boolean>;
}

/** User-scoped exchange-credential store. Never returns secret/memo plaintext (only ciphertext). */
export class SqliteCredentialRepo implements CredentialStore {
  constructor(private readonly db: DB) {}
  /**
   * 자격증명 저장.
   *
   * `exchange` 를 인자로 받는다. 예전에는 'bitmart' 가 박혀 있어서, KuCoin 키를
   * 저장해도 화면에 "bitmart" 로 표시됐다. 사용자가 어느 거래소 키인지 알 수
   * 없으면 잘못된 키를 지우게 된다.
   */
  async create(userId: string, enc: EncryptedCredential, label?: string, exchange = 'bitmart'): Promise<CredentialRow> {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO exchange_credentials (id,user_id,exchange,label,access_key_masked,encrypted_access_key,encrypted_secret_key,encrypted_memo,wrapped_dek,encryption_key_version,algo,permissions_verified,ip_whitelist_confirmed,connection_status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,0,0,'UNVERIFIED',?,?)`,
      )
      .run(id, userId, exchange, label ?? null, enc.accessKeyMasked, enc.encryptedAccessKey, enc.encryptedSecretKey, enc.encryptedMemo, enc.wrappedDek, enc.encryptionKeyVersion, enc.algo, now, now);
    return (await this.getOwned(userId, id))!;
  }
  async getOwned(userId: string, id: string): Promise<CredentialRow | null> {
    const r = this.db.prepare('SELECT * FROM exchange_credentials WHERE id=? AND user_id=? AND revoked_at IS NULL').get(id, userId) as Record<string, unknown> | undefined;
    return r ? map(r) : null;
  }
  async listOwned(userId: string): Promise<CredentialRow[]> {
    return (this.db.prepare('SELECT * FROM exchange_credentials WHERE user_id=? AND revoked_at IS NULL').all(userId) as Record<string, unknown>[]).map(map);
  }
  async setVerified(userId: string, id: string, status: string, permissionsVerified: boolean): Promise<void> {
    this.db.prepare('UPDATE exchange_credentials SET connection_status=?, permissions_verified=?, last_verified_at=?, updated_at=? WHERE id=? AND user_id=?')
      .run(status, permissionsVerified ? 1 : 0, Date.now(), Date.now(), id, userId);
  }
  /*
     사용 기록.

     ★★ 절대 예외를 밖으로 내지 않는다. 사용 기록 실패가 주문을 실패시키면
       부작용이 원래 목적보다 커진다. 다만 조용히 삼키지도 않는다 — 삼킨 사실을
       로그로 남겨야 "기록이 왜 비었나" 를 나중에 알 수 있다.
  */
  async markUsed(id: string): Promise<void> {
    try {
      this.db.prepare('UPDATE exchange_credentials SET last_used_at=?, updated_at=? WHERE id=? AND revoked_at IS NULL')
        .run(Date.now(), Date.now(), id);
    } catch (e) {
      console.warn('[cred] markUsed 실패 — 사용 기록만 누락되고 주문은 계속한다:', (e as Error).message);
    }
  }
  async revoke(userId: string, id: string): Promise<boolean> {
    const info = this.db.prepare('UPDATE exchange_credentials SET revoked_at=? WHERE id=? AND user_id=? AND revoked_at IS NULL').run(Date.now(), id, userId);
    return info.changes > 0;
  }
}

function map(r: Record<string, unknown>): CredentialRow {
  return {
    id: String(r.id), userId: String(r.user_id), exchange: String(r.exchange), label: (r.label as string) ?? null,
    accessKeyMasked: String(r.access_key_masked), encryptedAccessKey: String(r.encrypted_access_key),
    encryptedSecretKey: String(r.encrypted_secret_key), encryptedMemo: String(r.encrypted_memo),
    wrappedDek: String(r.wrapped_dek), encryptionKeyVersion: String(r.encryption_key_version), algo: String(r.algo),
    permissionsVerified: !!r.permissions_verified, ipWhitelistConfirmed: !!r.ip_whitelist_confirmed, connectionStatus: String(r.connection_status),
    // ★ 없으면 null 이다. 0 으로 바꾸면 "1970년에 쓰임" 이 된다.
    lastUsedAt: r.last_used_at === null || r.last_used_at === undefined ? null : Number(r.last_used_at),
  };
}

/** SQLite-backed idempotency store (UNIQUE PK enforces single execution per key). */
export class SqliteIdempotencyStore implements IdempotencyStore {
  constructor(private readonly db: DB, private readonly userId: string, private readonly scope: string) {}
  async get(key: string): Promise<{ result: unknown } | null> {
    const r = this.db.prepare('SELECT result FROM idempotency_records WHERE idempotency_key=?').get(key) as { result: string | null } | undefined;
    return r ? { result: r.result ? JSON.parse(r.result) : null } : null;
  }
  async put(key: string, result: unknown): Promise<void> {
    this.db.prepare('INSERT OR IGNORE INTO idempotency_records (idempotency_key,user_id,scope,result,created_at) VALUES (?,?,?,?,?)')
      .run(key, this.userId, this.scope, JSON.stringify(result), Date.now());
  }
}
