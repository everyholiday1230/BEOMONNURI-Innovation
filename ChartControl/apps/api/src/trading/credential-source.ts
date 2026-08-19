/**
 * BitMart credential source (docs PHASE3-02). Production loads credentials at runtime from AWS
 * Secrets Manager via the instance IAM role — the plaintext secret/memo/access-key are NEVER printed,
 * logged, returned to the client, or placed in error messages (only field NAMES appear in errors).
 *
 * FAIL-CLOSED: when the configured managed source is unavailable/misconfigured (no ARN, no region,
 * SDK not installed, IAM role cannot fetch), `load()` / `resolveCredentialProvider()` THROW rather
 * than silently degrading. Live/Read-Only-live must never run without a real managed secret source.
 */

export interface BitMartCredentialPlain {
  accessKey: string;
  secretKey: string;
  memo: string;
}

export interface ICredentialProvider {
  readonly kind: string;
  /** Returns plaintext credentials for SERVER-SIDE signing only. Never expose to the client. */
  load(): Promise<BitMartCredentialPlain>;
}

/** Minimal shape of the AWS SDK v3 SecretsManager client (injectable for tests, no hard dep). */
export interface SecretsManagerClientLike {
  send(command: unknown): Promise<{ SecretString?: string }>;
}

/** Parse + validate a secret JSON payload WITHOUT ever echoing values. Accepts snake/camel keys. */
export function parseCredentialSecret(secretString: string): BitMartCredentialPlain {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(secretString) as Record<string, unknown>;
  } catch {
    throw new Error('credential secret is not valid JSON (fail-closed)'); // no value echoed
  }
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = obj[k];
      if (typeof v === 'string' && v.length > 0) return v;
    }
    return undefined;
  };
  const accessKey = pick('accessKey', 'access_key', 'apiKey', 'api_key');
  const secretKey = pick('secretKey', 'secret_key', 'secret');
  const memo = pick('memo', 'apiMemo', 'api_memo');
  const missing = [
    ['accessKey', accessKey],
    ['secretKey', secretKey],
    ['memo', memo],
  ]
    .filter(([, v]) => !v)
    .map(([name]) => name as string);
  if (missing.length > 0) throw new Error(`credential secret missing field(s): ${missing.join(', ')} (fail-closed)`); // names only
  return { accessKey: accessKey!, secretKey: secretKey!, memo: memo! };
}

/**
 * AWS Secrets Manager credential provider. Uses the instance IAM role via the AWS SDK default
 * credential chain. The SDK is an OPTIONAL runtime dependency loaded by dynamic import; if it is not
 * installed and no client is injected, `load()` throws (fail-closed).
 */
export class AwsSecretsManagerCredentialProvider implements ICredentialProvider {
  readonly kind = 'aws-secrets-manager';
  constructor(
    private readonly secretId: string,
    private readonly region: string,
    /** injectable client (tests). When absent, the real SDK is dynamically imported. */
    private readonly clientFactory?: () => Promise<SecretsManagerClientLike>,
  ) {
    if (!secretId) throw new Error('aws-secrets-manager: secret id (ARN/name) required (fail-closed)');
    if (!region) throw new Error('aws-secrets-manager: region required (fail-closed)');
  }

  private async client(): Promise<SecretsManagerClientLike> {
    if (this.clientFactory) return this.clientFactory();
    let mod: {
      SecretsManagerClient: new (cfg: { region: string }) => SecretsManagerClientLike;
      GetSecretValueCommand: new (input: { SecretId: string }) => unknown;
    };
    try {
      // Real dependency (apps/api production dep). Lazily imported so unit tests without AWS still run.
      mod = (await import('@aws-sdk/client-secrets-manager')) as unknown as typeof mod;
    } catch {
      throw new Error('aws-secrets-manager: @aws-sdk/client-secrets-manager not installed and no client injected (fail-closed)');
    }
    const client = new mod.SecretsManagerClient({ region: this.region });
    (client as unknown as { __GetSecretValueCommand?: unknown }).__GetSecretValueCommand = mod.GetSecretValueCommand;
    return client;
  }

  async load(): Promise<BitMartCredentialPlain> {
    const client = await this.client();
    const Cmd = (client as unknown as { __GetSecretValueCommand?: new (i: { SecretId: string }) => unknown }).__GetSecretValueCommand;
    const command = Cmd ? new Cmd({ SecretId: this.secretId }) : { SecretId: this.secretId };
    let res: { SecretString?: string };
    try {
      res = await client.send(command);
    } catch (e) {
      // Never include the secret; only the error class/message from AWS (which does not contain the secret).
      throw new Error(`aws-secrets-manager: GetSecretValue failed (fail-closed): ${(e as Error).name}`);
    }
    if (!res.SecretString) throw new Error('aws-secrets-manager: secret has no SecretString (fail-closed)');
    return parseCredentialSecret(res.SecretString);
  }
}

/**
 * Dev-only credential provider from process env. Allowed ONLY when explicitly selected in a dev
 * context; production must use the managed source. Values are read but never logged.
 */
export class EnvCredentialProvider implements ICredentialProvider {
  readonly kind = 'env';
  constructor(private readonly env: NodeJS.ProcessEnv) {}
  async load(): Promise<BitMartCredentialPlain> {
    const accessKey = this.env.BITMART_ACCESS_KEY ?? this.env.BITMART_API_KEY;
    const secretKey = this.env.BITMART_SECRET_KEY ?? this.env.BITMART_SECRET;
    const memo = this.env.BITMART_MEMO ?? this.env.BITMART_API_MEMO;
    if (!accessKey || !secretKey || !memo) throw new Error('env credential provider: BITMART_ACCESS_KEY/SECRET_KEY/MEMO required (fail-closed)');
    return { accessKey, secretKey, memo };
  }
}

export type CredentialSourceKind = 'aws-secrets-manager' | 'env';

export interface ResolveCredentialOptions {
  source?: string; // BITMART_CREDENTIAL_SOURCE
  secretId?: string; // BITMART_SECRET_ARN | BITMART_SECRET_ID
  region?: string; // AWS_REGION | AWS_DEFAULT_REGION
  isProduction: boolean; // NODE_ENV==='production' or live/read-only-live deployment
  env?: NodeJS.ProcessEnv;
  clientFactory?: () => Promise<SecretsManagerClientLike>;
}

/**
 * Resolve the credential provider, FAIL-CLOSED. In production (or when `aws-secrets-manager` is
 * selected) a valid secret id + region are REQUIRED; the dev `env` provider is refused in production.
 */
export function resolveCredentialProvider(opts: ResolveCredentialOptions): ICredentialProvider {
  const source = (opts.source as CredentialSourceKind | undefined) ?? (opts.isProduction ? 'aws-secrets-manager' : 'env');
  if (source === 'aws-secrets-manager') {
    if (!opts.secretId) throw new Error('fail-closed: BITMART_SECRET_ARN/BITMART_SECRET_ID required for aws-secrets-manager');
    if (!opts.region) throw new Error('fail-closed: AWS_REGION required for aws-secrets-manager');
    return new AwsSecretsManagerCredentialProvider(opts.secretId, opts.region, opts.clientFactory);
  }
  /*
     'env' — 환경변수에서 읽는다.

     ★★ 프로덕션에서는 **명시적으로 선택해야** 허용된다.

       AWS 를 쓰지 않는 배포(Render 등)에서는 Secrets Manager 가 없다. 그렇다고
       조건을 없애면 실수로 프로덕션이 환경변수 경로로 열린다 — 그래서
       `CREDENTIAL_SOURCE=env` 를 **직접 적어야** 통과한다.

     ★ 무엇을 포기하는가 (알고 선택해야 한다)
         · 서버가 침해되면 `/proc/<pid>/environ` 이나 프로세스 덤프에서 브로커
           키가 그대로 읽힌다. Secrets Manager 도 값을 메모리에 올리므로 차이는
           "환경·디스크에 남는지" 와 "접근 감사 로그" 다.
         · 키 회전이 수동이 된다(재배포 필요).

     ★ 무엇이 걸려 있는가
         이 키는 **운영자 브로커 키**다(고객 키는 별개로 DB 에 봉투암호화된다).
         유출되면 남이 우리 이름으로 주문에 태그를 붙일 수 있지만 **자금을
         빼낼 수는 없다** — 출금 권한이 없다. 그래서 환경변수 + 서버 접근 통제로
         감당 가능한 범위라고 판단했다(2026-08, 사장님 승인).
  */
  if (opts.isProduction && (opts.env ?? process.env).CREDENTIAL_SOURCE !== 'env') {
    throw new Error(
      'fail-closed: env credential provider in production requires CREDENTIAL_SOURCE=env '
      + '(set it deliberately, or use aws-secrets-manager)',
    );
  };
  return new EnvCredentialProvider(opts.env ?? process.env);
}

/**
 * Startup fail-closed guard (item 2). In production, refuse to start unless the AWS SDK is installed
 * AND a Secret ARN/id + region are configured. Throws with a redaction-safe message (no secret values).
 */
export async function assertProductionCredentialReadiness(o: {
  isProduction: boolean;
  secretId?: string;
  region?: string;
  /** 검사용 주입. 없으면 process.env. */
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  if (!o.isProduction) return; // dev / e2e unaffected
  /*
     ★★ AWS 를 쓰지 않는 배포는 `CREDENTIAL_SOURCE=env` 로 통과한다.

       Render 처럼 Secrets Manager 가 없는 곳에 올리려면 이 길이 필요하다.
       기본값은 여전히 AWS 요구다 — 아무 설정도 없으면 기동을 막는다.

     ★ 조건을 "AWS 설정이 없으면 통과" 로 만들지 않았다. 그러면 ARN 을 적는 것을
       잊은 배포가 조용히 환경변수 경로로 열린다 — 잊은 것과 의도한 것을
       구분할 수 없다.
  */
  if ((o.env ?? process.env).CREDENTIAL_SOURCE === 'env') {
    return;
  }
  if (!o.secretId) throw new Error('fail-closed startup: BITMART_SECRET_ARN/BITMART_SECRET_ID required in production');
  if (!o.region) throw new Error('fail-closed startup: AWS_REGION required in production');
  try {
    await import('@aws-sdk/client-secrets-manager');
  } catch {
    throw new Error('fail-closed startup: @aws-sdk/client-secrets-manager is required in production');
  }
}
