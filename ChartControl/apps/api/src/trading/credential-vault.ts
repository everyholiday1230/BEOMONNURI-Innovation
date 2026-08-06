import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

/**
 * Exchange credential vault (docs PHASE3-02). Envelope encryption:
 *  - a random per-credential DEK encrypts each field with AES-256-GCM,
 *  - the DEK is WRAPPED by a KEK. Dev uses a local KEK (env, never in DB); prod uses a managed KMS
 *    (IKmsProvider). We persist ONLY ciphertext + wrapped DEK + key version + algo. Plaintext
 *    secret/memo are NEVER stored, logged, or returned to the browser.
 */
export const VAULT_ALGO = 'AES-256-GCM+envelope';

export interface IKmsProvider {
  readonly keyVersion: string;
  wrapDek(dek: Buffer): Promise<string>; // returns base64 wrapped DEK
  unwrapDek(wrapped: string, keyVersion: string): Promise<Buffer>;
}

/** Dev KEK provider — local 32-byte key (from env, NOT the DB). Prod MUST use a managed KMS. */
export class LocalKekProvider implements IKmsProvider {
  private readonly kek: Buffer;
  constructor(
    kekBase64: string,
    readonly keyVersion = 'local-v1',
  ) {
    const k = Buffer.from(kekBase64, 'base64');
    if (k.length !== 32) throw new Error('KEK must be 32 bytes (base64)');
    this.kek = k;
  }
  async wrapDek(dek: Buffer): Promise<string> {
    return encGcm(this.kek, dek).toString('base64');
  }
  async unwrapDek(wrapped: string, _keyVersion: string): Promise<Buffer> {
    return decGcm(this.kek, Buffer.from(wrapped, 'base64'));
  }
}

function encGcm(key: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]); // 12 + 16 + n
}
function decGcm(key: Buffer, blob: Buffer): Buffer {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const ct = blob.subarray(28);
  // authTagLength pinned to 16 bytes: without it Node accepts a truncated tag, which weakens the
  // integrity guarantee of AES-GCM (semgrep javascript.node-crypto.security.gcm-no-tag-length).
  const d = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

export interface PlainCredential {
  accessKey: string;
  secretKey: string;
  memo: string;
}
export interface EncryptedCredential {
  accessKeyMasked: string;
  encryptedAccessKey: string;
  encryptedSecretKey: string;
  encryptedMemo: string;
  wrappedDek: string;
  encryptionKeyVersion: string;
  algo: string;
}

/** Partial-mask an access key for display/logs (e.g. "abcd…**…wxyz"). Never expose secret/memo. */
export function maskAccessKey(accessKey: string): string {
  if (accessKey.length <= 8) return '****';
  return `${accessKey.slice(0, 4)}…${accessKey.slice(-4)}`;
}

export class CredentialVault {
  constructor(private readonly kms: IKmsProvider) {}

  async encrypt(cred: PlainCredential): Promise<EncryptedCredential> {
    const dek = randomBytes(32);
    const enc = (s: string) => encGcm(dek, Buffer.from(s, 'utf8')).toString('base64');
    // Encrypt all fields BEFORE wrapping/zeroizing the DEK.
    const encryptedAccessKey = enc(cred.accessKey);
    const encryptedSecretKey = enc(cred.secretKey);
    const encryptedMemo = enc(cred.memo);
    const wrappedDek = await this.kms.wrapDek(dek);
    dek.fill(0); // best-effort zeroization
    return {
      accessKeyMasked: maskAccessKey(cred.accessKey),
      encryptedAccessKey,
      encryptedSecretKey,
      encryptedMemo,
      wrappedDek,
      encryptionKeyVersion: this.kms.keyVersion,
      algo: VAULT_ALGO,
    };
  }

  /** Decrypt to plaintext — SERVER-SIDE ONLY (used to sign requests); never sent to the client. */
  async decrypt(rec: EncryptedCredential): Promise<PlainCredential> {
    const dek = await this.kms.unwrapDek(rec.wrappedDek, rec.encryptionKeyVersion);
    const dec = (b64: string) => decGcm(dek, Buffer.from(b64, 'base64')).toString('utf8');
    const out = { accessKey: dec(rec.encryptedAccessKey), secretKey: dec(rec.encryptedSecretKey), memo: dec(rec.encryptedMemo) };
    dek.fill(0);
    return out;
  }

  /** Key rotation: unwrap the DEK with the old KEK and re-wrap with a new KMS/KEK. */
  async rotate(rec: EncryptedCredential, newKms: IKmsProvider): Promise<EncryptedCredential> {
    const dek = await this.kms.unwrapDek(rec.wrappedDek, rec.encryptionKeyVersion);
    const wrappedDek = await newKms.wrapDek(dek);
    dek.fill(0);
    return { ...rec, wrappedDek, encryptionKeyVersion: newKms.keyVersion };
  }
}
