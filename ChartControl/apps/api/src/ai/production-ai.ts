import {
  MockReplayProvider,
  OpenAIResponsesProvider,
  type IAIStreamingProvider,
  type OpenAiResponsesTransport,
  type OpenAiResponsesPayload,
  type RawResponsesEvent,
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
  /** test-only: inject a Secrets Manager client (never a real secret). */
  smClientFactory?: () => Promise<{ send(cmd: unknown): Promise<{ SecretString?: string }> }>;
}

/** Load the OpenAI API key from Secrets Manager (fail-closed; redaction-safe errors). */
export async function loadOpenAiApiKey(cfg: AiSecretConfig): Promise<string> {
  if (!cfg.secretArn) throw new Error('fail-closed: OPENAI_SECRET_ARN required');
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
  provider: 'openai' | 'mock' | 'fake';
  isProduction: boolean;
  model: string;
  secret: AiSecretConfig;
  estimateCostMicros: (model: string, input: number, output: number) => number;
}

export interface AiResolution {
  available: boolean;
  provider?: IAIStreamingProvider;
  kind: 'openai' | 'mock' | 'fake' | 'unavailable';
  reason?: string;
}

/**
 * Resolve the active AI provider. openai → real (fail-closed if secret/SDK missing → UNAVAILABLE, not
 * mock). mock → MockReplayProvider (dev/e2e). Disabled → unavailable.
 */
export async function resolveAiProvider(cfg: AiRuntimeConfig): Promise<AiResolution> {
  if (!cfg.enabled) return { available: false, kind: 'unavailable', reason: 'AI disabled' };
  if (cfg.provider === 'mock' || cfg.provider === 'fake') {
    return { available: true, provider: new MockReplayProvider(cfg.model), kind: 'mock' };
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
