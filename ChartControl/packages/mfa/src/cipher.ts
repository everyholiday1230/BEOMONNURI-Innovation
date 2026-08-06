import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** AES-GCM authentication tag length in bytes. Pinned so a truncated tag is rejected. */
const TAG_BYTES = 16;

/**
 * Encryption-at-rest interface for the TOTP secret. Production wires this to AWS KMS / envelope
 * encryption; the dev/test implementation is AES-256-GCM with an injected 32-byte key. The plaintext
 * secret is NEVER logged and never returned to the client after activation.
 */
export interface SecretCipher {
  encrypt(plaintext: string): string; // returns an opaque, self-describing token
  decrypt(token: string): string;
}

export class AesGcmSecretCipher implements SecretCipher {
  private readonly key: Buffer;
  constructor(key: Buffer | string) {
    const k = typeof key === 'string' ? Buffer.from(key, 'base64') : key;
    if (k.length !== 32) throw new Error('AesGcmSecretCipher requires a 32-byte key');
    this.key = k;
  }
  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv, { authTagLength: TAG_BYTES });
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64')}.${enc.toString('base64')}.${tag.toString('base64')}`;
  }
  decrypt(token: string): string {
    const [v, ivB64, encB64, tagB64] = token.split('.');
    if (v !== 'v1' || !ivB64 || !encB64 || !tagB64) throw new Error('malformed cipher token');
    // authTagLength pinned: Node otherwise accepts a truncated auth tag, weakening AES-GCM
    // integrity (semgrep javascript.node-crypto.security.gcm-no-tag-length).
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'), {
      authTagLength: TAG_BYTES,
    });
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8');
  }
}
