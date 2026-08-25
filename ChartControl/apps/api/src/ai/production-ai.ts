import {
  MockReplayProvider,
  OpenAIResponsesProvider,
  BedrockConverseProvider,
  type IAIStreamingProvider,
  type OpenAiResponsesTransport,
  type OpenAiResponsesPayload,
  type RawResponsesEvent,
  type BedrockConverseTransport,
  type BedrockConversePayload,
  type BedrockStreamChunk,
} from '@quantumtrade/ai';

/**
 * Production AI wiring (docs PHASE4-02). The OpenAI API key is loaded ONLY from AWS Secrets Manager
 * via the instance IAM role — separate from the BitMart secret, never returned to the browser, never
 * logged, never in env/.env/git. FAIL-CLOSED: if the provider is `openai` in production but the SDK
 * or Secret ARN/region is missing, AI is marked UNAVAILABLE (the UI shows "AI unavailable") — we do
 * NOT silently fall back to the mock provider.
 */
export interface AiSecretConfig {
  isProduction: boolean;
  secretArn?: string;
  region?: string;
  /**
   * Plain API key from an env var (e.g. OPENAI_API_KEY). Lets a non-AWS host (Render) enable AI
   * WITHOUT AWS Secrets Manager. When present it is used directly. Keep it only in the platform's
   * secret env store — never in git.
   */
  directKey?: string;
  /** test-only: inject a Secrets Manager client (never a real secret). */
  smClientFactory?: () => Promise<{ send(cmd: unknown): Promise<{ SecretString?: string }> }>;
}

/** Load the OpenAI API key from a direct env var, else AWS Secrets Manager (fail-closed). */
export async function loadOpenAiApiKey(cfg: AiSecretConfig): Promise<string> {
  // Non-AWS deployments (Render) can supply the key directly via env.
  if (cfg.directKey && cfg.directKey.trim()) return cfg.directKey.trim();
  if (!cfg.secretArn) throw new Error('fail-closed: OPENAI_SECRET_ARN or OPENAI_API_KEY required');
  if (!cfg.region) throw new Error('fail-closed: AWS_REGION required for OpenAI secret');
  let client: { send(cmd: unknown): Promise<{ SecretString?: string }> };
  let CommandCtor: (new (i: { SecretId: string }) => unknown) | undefined;
  if (cfg.smClientFactory) {
    client = await cfg.smClientFactory();
  } else {
    let mod: { SecretsManagerClient: new (c: { region: string }) => typeof client; GetSecretValueCommand: new (i: { SecretId: string }) => unknown };
    try {
      mod = (await import('@aws-sdk/client-secrets-manager')) as unknown as typeof mod;
    } catch {
      throw new Error('fail-closed: @aws-sdk/client-secrets-manager not installed');
    }
    client = new mod.SecretsManagerClient({ region: cfg.region }) as unknown as typeof client;
    CommandCtor = mod.GetSecretValueCommand;
  }
  let res: { SecretString?: string };
  try {
    res = await client.send(CommandCtor ? new CommandCtor({ SecretId: cfg.secretArn }) : { SecretId: cfg.secretArn });
  } catch (e) {
    throw new Error(`fail-closed: OpenAI GetSecretValue failed: ${(e as Error).name}`); // no secret in message
  }
  if (!res.SecretString) throw new Error('fail-closed: OpenAI secret has no SecretString');
  // Secret may be raw key or JSON {apiKey|OPENAI_API_KEY}
  const s = res.SecretString.trim();
  if (s.startsWith('{')) {
    const obj = JSON.parse(s) as Record<string, unknown>;
    const key = (obj.apiKey ?? obj.OPENAI_API_KEY ?? obj.openai_api_key) as string | undefined;
    if (!key) throw new Error('fail-closed: OpenAI secret JSON missing apiKey');
    return key;
  }
  return s;
}

/** Minimal structural type of the OpenAI SDK Responses streaming client (avoids hard type coupling). */
interface OpenAiLike {
  responses: { stream(payload: Record<string, unknown>): AsyncIterable<{ type: string; [k: string]: unknown }> };
}

/**
 * Build a Responses API transport backed by the official OpenAI SDK. LIVE execution requires a real
 * key (Not Executed here). Events are passed through as RawResponsesEvent (their `.type` already
 * matches the Responses API event names the normalizer expects).
 */
export async function createOpenAiTransport(apiKey: string): Promise<OpenAiResponsesTransport> {
  const mod = (await import('openai')) as unknown as { default: new (o: { apiKey: string }) => OpenAiLike };
  const client = new mod.default({ apiKey });
  return {
    async *streamRaw(payload: OpenAiResponsesPayload, signal?: AbortSignal): AsyncIterable<RawResponsesEvent> {
      const stream = client.responses.stream({ ...payload, ...(signal ? { signal } : {}) });
      for await (const ev of stream) {
        if (signal?.aborted) return;
        yield ev as unknown as RawResponsesEvent;
      }
    },
  };
}

export interface AiRuntimeConfig {
  enabled: boolean;
  provider: 'openai' | 'bedrock' | 'mock' | 'fake';
  isProduction: boolean;
  model: string;
  secret: AiSecretConfig;
  estimateCostMicros: (model: string, input: number, output: number) => number;
  /** AWS region for Bedrock (falls back to secret.region / AWS_REGION). Required when provider=bedrock. */
  bedrockRegion?: string;
}

export interface AiResolution {
  available: boolean;
  provider?: IAIStreamingProvider;
  kind: 'openai' | 'bedrock' | 'mock' | 'fake' | 'unavailable';
  reason?: string;
}

/**
 * Build a Bedrock Converse transport backed by the AWS SDK. Credentials come from the standard AWS
 * provider chain (instance role, or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY env on non-AWS hosts).
 * The package stays SDK-free; raw ConverseStream chunks are passed through unchanged.
 */
export async function createBedrockTransport(region: string): Promise<BedrockConverseTransport> {
  if (!region) throw new Error('fail-closed: AWS_REGION required for Bedrock');
  let mod: {
    BedrockRuntimeClient: new (c: { region: string }) => { send(cmd: unknown, opts?: { abortSignal?: AbortSignal }): Promise<{ stream?: AsyncIterable<BedrockStreamChunk> }> };
    ConverseStreamCommand: new (i: Record<string, unknown>) => unknown;
  };
  try {
    mod = (await import('@aws-sdk/client-bedrock-runtime')) as unknown as typeof mod;
  } catch {
    throw new Error('fail-closed: @aws-sdk/client-bedrock-runtime not installed');
  }
  const client = new mod.BedrockRuntimeClient({ region });
  return {
    async *streamConverse(payload: BedrockConversePayload, signal?: AbortSignal): AsyncIterable<BedrockStreamChunk> {
      const cmd = new mod.ConverseStreamCommand({
        modelId: payload.modelId,
        system: payload.system,
        messages: payload.messages,
        toolConfig: payload.toolConfig,
        inferenceConfig: payload.inferenceConfig,
      });
      const res = await client.send(cmd, signal ? { abortSignal: signal } : undefined);
      if (!res.stream) return;
      for await (const item of res.stream) {
        if (signal?.aborted) return;
        yield item;
      }
    },
  };
}

/**
 * Resolve the active AI provider. openai/bedrock → real (fail-closed if SDK/secret/region missing →
 * UNAVAILABLE, not mock). mock → MockReplayProvider (dev/e2e). Disabled → unavailable.
 */
export async function resolveAiProvider(cfg: AiRuntimeConfig): Promise<AiResolution> {
  if (!cfg.enabled) return { available: false, kind: 'unavailable', reason: 'AI disabled' };
  if (cfg.provider === 'mock' || cfg.provider === 'fake') {
    return { available: true, provider: new MockReplayProvider(cfg.model), kind: 'mock' };
  }
  if (cfg.provider === 'bedrock') {
    try {
      const region = cfg.bedrockRegion || cfg.secret.region || '';
      const transport = await createBedrockTransport(region);
      return { available: true, provider: new BedrockConverseProvider(transport, { model: cfg.model, estimateCostMicros: cfg.estimateCostMicros }), kind: 'bedrock' };
    } catch (e) {
      // FAIL-CLOSED: never silently fall back to mock.
      return { available: false, kind: 'unavailable', reason: (e as Error).message };
    }
  }
  // openai
  try {
    const apiKey = await loadOpenAiApiKey(cfg.secret);
    const transport = await createOpenAiTransport(apiKey);
    return { available: true, provider: new OpenAIResponsesProvider(transport, { model: cfg.model, estimateCostMicros: cfg.estimateCostMicros }), kind: 'openai' };
  } catch (e) {
    // FAIL-CLOSED: do NOT silently use mock in production. Surface unavailable.
    return { available: false, kind: 'unavailable', reason: (e as Error).message };
  }
}
