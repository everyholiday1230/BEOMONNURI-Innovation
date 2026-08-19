import { describe, it, expect } from 'vitest';
import {
  resolveCredentialProvider,
  AwsSecretsManagerCredentialProvider,
  EnvCredentialProvider,
  parseCredentialSecret,
  assertProductionCredentialReadiness,
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

describe('CRED-SRC AWS 없는 배포 (Render 등)', () => {
  it('[1] ★★ 프로덕션에서 아무 설정도 없으면 기동을 막는다', async () => {
    /*
       기본값이 통과면 ARN 을 적는 것을 잊은 배포가 조용히 환경변수 경로로 열린다.
       잊은 것과 의도한 것을 구분할 수 없게 된다.
    */
    await expect(assertProductionCredentialReadiness({
      isProduction: true, env: {} as NodeJS.ProcessEnv,
    })).rejects.toThrow(/BITMART_SECRET_ARN/);
  });

  it('[2] CREDENTIAL_SOURCE=env 를 직접 적으면 통과한다', async () => {
    /*
       AWS 를 쓰지 않는 배포(Render)를 위한 길이다. **명시적으로** 적어야 열린다.
    */
    await expect(assertProductionCredentialReadiness({
      isProduction: true, env: { CREDENTIAL_SOURCE: 'env' } as NodeJS.ProcessEnv,
    })).resolves.toBeUndefined();
  });

  it('[3] ★ 비슷한 값으로는 열리지 않는다', async () => {
    // 'ENV' · 'environment' · 'true' 같은 값이 통과하면 실수로 열린다.
    for (const v of ['ENV', 'environment', 'true', '1', 'yes']) {
      await expect(assertProductionCredentialReadiness({
        isProduction: true, env: { CREDENTIAL_SOURCE: v } as NodeJS.ProcessEnv,
      })).rejects.toThrow(/BITMART_SECRET_ARN/);
    }
  });

  it('[4] ★★ 제공자 선택도 같은 규칙을 따른다', () => {
    /*
       기동 검사만 통과하고 실제 제공자가 거부하면, 첫 주문에서 실패한다 —
       기동 시점이 아니라 **돈이 걸린 순간**에 터진다. 두 경로가 같은 규칙이어야 한다.

       ★ 프로덕션 기본값은 'aws-secrets-manager' 이므로, 아무 설정도 없으면
         ARN 부재로 먼저 막힌다. 어느 쪽이든 열리지 않는 것이 요점이다.
    */
    expect(() => resolveCredentialProvider({
      isProduction: true, env: {} as NodeJS.ProcessEnv,
    })).toThrow(/BITMART_SECRET_ARN/);

    // 'env' 를 명시적으로 고르면서 CREDENTIAL_SOURCE 가 없으면 거부한다.
    expect(() => resolveCredentialProvider({
      isProduction: true, source: 'env', env: {} as NodeJS.ProcessEnv,
    })).toThrow(/CREDENTIAL_SOURCE=env/);

    // 둘이 맞으면 통과한다.
    expect(resolveCredentialProvider({
      isProduction: true, source: 'env', env: { CREDENTIAL_SOURCE: 'env' } as NodeJS.ProcessEnv,
    })).toBeTruthy();
  });

  it('[5] 개발 환경은 영향받지 않는다', async () => {
    await expect(assertProductionCredentialReadiness({
      isProduction: false, env: {} as NodeJS.ProcessEnv,
    })).resolves.toBeUndefined();
    expect(resolveCredentialProvider({
      isProduction: false, env: {} as NodeJS.ProcessEnv,
    })).toBeTruthy();
  });
});
