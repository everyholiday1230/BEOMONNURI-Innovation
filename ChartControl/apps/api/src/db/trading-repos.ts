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
}

/** User-scoped exchange-credential store. Never returns secret/memo plaintext (only ciphertext). */
export class SqliteCredentialRepo {
  constructor(private readonly db: DB) {}
  /**
   * 자격증명 저장.
   *
   * `exchange` 를 인자로 받는다. 예전에는 'bitmart' 가 박혀 있어서, KuCoin 키를
   * 저장해도 화면에 "bitmart" 로 표시됐다. 사용자가 어느 거래소 키인지 알 수
   * 없으면 잘못된 키를 지우게 된다.
   */
  create(userId: string, enc: EncryptedCredential, label?: string, exchange = 'bitmart'): CredentialRow {
    const id = randomUUID();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO exchange_credentials (id,user_id,exchange,label,access_key_masked,encrypted_access_key,encrypted_secret_key,encrypted_memo,wrapped_dek,encryption_key_version,algo,permissions_verified,ip_whitelist_confirmed,connection_status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,0,0,'UNVERIFIED',?,?)`,
      )
      .run(id, userId, exchange, label ?? null, enc.accessKeyMasked, enc.encryptedAccessKey, enc.encryptedSecretKey, enc.encryptedMemo, enc.wrappedDek, enc.encryptionKeyVersion, enc.algo, now, now);
    return this.getOwned(userId, id)!;
  }
  getOwned(userId: string, id: string): CredentialRow | null {
    const r = this.db.prepare('SELECT * FROM exchange_credentials WHERE id=? AND user_id=? AND revoked_at IS NULL').get(id, userId) as Record<string, unknown> | undefined;
    return r ? map(r) : null;
  }
  listOwned(userId: string): CredentialRow[] {
    return (this.db.prepare('SELECT * FROM exchange_credentials WHERE user_id=? AND revoked_at IS NULL').all(userId) as Record<string, unknown>[]).map(map);
  }
  setVerified(userId: string, id: string, status: string, permissionsVerified: boolean): void {
    this.db.prepare('UPDATE exchange_credentials SET connection_status=?, permissions_verified=?, last_verified_at=?, updated_at=? WHERE id=? AND user_id=?')
      .run(status, permissionsVerified ? 1 : 0, Date.now(), Date.now(), id, userId);
  }
  revoke(userId: string, id: string): boolean {
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
