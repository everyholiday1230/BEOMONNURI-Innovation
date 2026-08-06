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
  // 'env'
  if (opts.isProduction) throw new Error('fail-closed: env credential provider is not allowed in production (use aws-secrets-manager)');
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
}): Promise<void> {
  if (!o.isProduction) return; // dev / e2e unaffected
  if (!o.secretId) throw new Error('fail-closed startup: BITMART_SECRET_ARN/BITMART_SECRET_ID required in production');
  if (!o.region) throw new Error('fail-closed startup: AWS_REGION required in production');
  try {
    await import('@aws-sdk/client-secrets-manager');
  } catch {
    throw new Error('fail-closed startup: @aws-sdk/client-secrets-manager is required in production');
  }
}
