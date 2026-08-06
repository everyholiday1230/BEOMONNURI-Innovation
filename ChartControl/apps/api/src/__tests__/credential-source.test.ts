import { describe, it, expect } from 'vitest';
import {
  resolveCredentialProvider,
  AwsSecretsManagerCredentialProvider,
  EnvCredentialProvider,
  parseCredentialSecret,
  type SecretsManagerClientLike,
} from '../trading/credential-source';

const SECRET = 'S3cr3t-should-never-appear';
const MEMO = 'M3mo-should-never-appear';

describe('parseCredentialSecret (redaction-safe)', () => {
  it('parses camel + snake keys', () => {
    expect(parseCredentialSecret(JSON.stringify({ accessKey: 'ak', secretKey: SECRET, memo: MEMO }))).toEqual({ accessKey: 'ak', secretKey: SECRET, memo: MEMO });
    expect(parseCredentialSecret(JSON.stringify({ access_key: 'ak', secret_key: SECRET, api_memo: MEMO }))).toEqual({ accessKey: 'ak', secretKey: SECRET, memo: MEMO });
  });
  it('throws with FIELD NAMES only (never secret values) when incomplete', () => {
    let msg = '';
    try { parseCredentialSecret(JSON.stringify({ accessKey: 'ak' })); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/secretKey/);
    expect(msg).toMatch(/memo/);
    expect(msg).not.toContain(SECRET);
    expect(msg).not.toContain(MEMO);
  });
  it('throws on non-JSON without echoing content', () => {
    expect(() => parseCredentialSecret('not json ' + SECRET)).toThrow(/not valid JSON/);
    try { parseCredentialSecret('not json ' + SECRET); } catch (e) { expect((e as Error).message).not.toContain(SECRET); }
  });
});

describe('resolveCredentialProvider — FAIL-CLOSED (§ pre-fix 5)', () => {
  it('production defaults to aws-secrets-manager and REQUIRES secret id + region', () => {
    expect(() => resolveCredentialProvider({ isProduction: true })).toThrow(/BITMART_SECRET_ARN|secret id|fail-closed/i);
    expect(() => resolveCredentialProvider({ isProduction: true, secretId: 'arn:...' })).toThrow(/AWS_REGION|region|fail-closed/i);
  });
  it('refuses the dev env provider in production', () => {
    expect(() => resolveCredentialProvider({ isProduction: true, source: 'env' })).toThrow(/not allowed in production|fail-closed/i);
  });
  it('returns an AWS provider when fully configured (does not connect yet)', () => {
    const p = resolveCredentialProvider({ isProduction: true, secretId: 'arn:aws:secretsmanager:...:bitmart', region: 'ap-northeast-2' });
    expect(p.kind).toBe('aws-secrets-manager');
  });
  it('dev env provider throws when env vars missing (fail-closed)', async () => {
    const p = resolveCredentialProvider({ isProduction: false, source: 'env', env: {} as NodeJS.ProcessEnv });
    expect(p).toBeInstanceOf(EnvCredentialProvider);
    await expect(p.load()).rejects.toThrow(/required|fail-closed/i);
  });
});

describe('AwsSecretsManagerCredentialProvider', () => {
  it('constructor is fail-closed on missing id/region', () => {
    expect(() => new AwsSecretsManagerCredentialProvider('', 'ap-northeast-2')).toThrow(/secret id|fail-closed/i);
    expect(() => new AwsSecretsManagerCredentialProvider('arn', '')).toThrow(/region|fail-closed/i);
  });
  it('loads + parses via an injected client (no real AWS, no SDK)', async () => {
    const fake: SecretsManagerClientLike = { async send() { return { SecretString: JSON.stringify({ accessKey: 'ak-123', secretKey: SECRET, memo: MEMO }) }; } };
    const p = new AwsSecretsManagerCredentialProvider('arn:...:bitmart', 'ap-northeast-2', async () => fake);
    const cred = await p.load();
    expect(cred.accessKey).toBe('ak-123');
    expect(cred.secretKey).toBe(SECRET);
  });
  it('load() fails closed WITHOUT echoing the secret when AWS errors', async () => {
    const fake: SecretsManagerClientLike = { async send() { throw Object.assign(new Error(SECRET), { name: 'AccessDeniedException' }); } };
    const p = new AwsSecretsManagerCredentialProvider('arn:...:bitmart', 'ap-northeast-2', async () => fake);
    let msg = '';
    await p.load().catch((e) => { msg = (e as Error).message; });
    expect(msg).toMatch(/GetSecretValue failed|fail-closed/i);
    expect(msg).toContain('AccessDeniedException');
    expect(msg).not.toContain(SECRET); // secret never leaks into error
  });
  it('real SDK path is fail-closed when @aws-sdk is not installed (no injected client)', async () => {
    const p = new AwsSecretsManagerCredentialProvider('arn:...:bitmart', 'ap-northeast-2');
    await expect(p.load()).rejects.toThrow(/not installed|fail-closed/i);
  });
});
