import { describe, it, expect } from 'vitest';
import { loadOpenAiApiKey, resolveAiProvider } from '../ai/production-ai';

describe('Phase 4 production AI wiring (fail-closed)', () => {
  it('loadOpenAiApiKey requires secret ARN + region (fail-closed)', async () => {
    await expect(loadOpenAiApiKey({ isProduction: true })).rejects.toThrow(/OPENAI_SECRET_ARN|fail-closed/i);
    await expect(loadOpenAiApiKey({ isProduction: true, secretArn: 'arn:...' })).rejects.toThrow(/AWS_REGION|fail-closed/i);
  });

  it('loads OpenAI key via injected Secrets Manager client (raw + JSON) without leaking it', async () => {
    const raw = { async send() { return { SecretString: 'sk-test-RAW' }; } };
    expect(await loadOpenAiApiKey({ isProduction: true, secretArn: 'arn', region: 'ap-northeast-2', smClientFactory: async () => raw })).toBe('sk-test-RAW');
    const json = { async send() { return { SecretString: JSON.stringify({ apiKey: 'sk-test-JSON' }) }; } };
    expect(await loadOpenAiApiKey({ isProduction: true, secretArn: 'arn', region: 'ap-northeast-2', smClientFactory: async () => json })).toBe('sk-test-JSON');
  });

  it('SM error is fail-closed and does NOT echo the secret', async () => {
    const bad = { async send() { throw Object.assign(new Error('sk-should-not-leak'), { name: 'AccessDeniedException' }); } };
    let msg = '';
    await loadOpenAiApiKey({ isProduction: true, secretArn: 'arn', region: 'r', smClientFactory: async () => bad }).catch((e) => { msg = (e as Error).message; });
    expect(msg).toContain('AccessDeniedException');
    expect(msg).not.toContain('sk-should-not-leak');
  });

  it('resolveAiProvider: disabled → unavailable; mock → available; openai without secret → UNAVAILABLE (no silent mock)', async () => {
    const est = () => 0;
    expect((await resolveAiProvider({ enabled: false, provider: 'mock', isProduction: false, model: 'm', secret: { isProduction: false }, estimateCostMicros: est })).available).toBe(false);
    const mock = await resolveAiProvider({ enabled: true, provider: 'mock', isProduction: false, model: 'm', secret: { isProduction: false }, estimateCostMicros: est });
    expect(mock.available).toBe(true);
    expect(mock.kind).toBe('mock');
    const openaiNoSecret = await resolveAiProvider({ enabled: true, provider: 'openai', isProduction: true, model: 'm', secret: { isProduction: true }, estimateCostMicros: est });
    expect(openaiNoSecret.available).toBe(false);
    expect(openaiNoSecret.kind).toBe('unavailable'); // fail-closed, NOT mock
  });
});
