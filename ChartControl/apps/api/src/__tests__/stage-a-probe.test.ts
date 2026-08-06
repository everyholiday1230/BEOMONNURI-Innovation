import { describe, it, expect } from 'vitest';
import { runStageAReadOnly } from '../trading/stage-a-probe';
import type { SecretsManagerClientLike } from '../trading/credential-source';

describe('Stage A read-only probe — credential-source / AWS Secrets Manager only (items 6-8)', () => {
  it('is FAIL-CLOSED without a Secrets Manager id/region (no env/CLI/file secret fallback)', async () => {
    await expect(runStageAReadOnly({ restBase: 'https://x' })).rejects.toThrow(/fail-closed|BITMART_SECRET_ARN|region/i);
  });

  it('does NOT read the BitMart secret from process.env (env vars are ignored)', async () => {
    const prev = { ...process.env };
    process.env.BITMART_ACCESS_KEY = 'env-ak';
    process.env.BITMART_SECRET_KEY = 'env-sk';
    process.env.BITMART_MEMO = 'env-memo';
    try {
      // Still fails closed because no Secrets Manager id/region is provided — env is never consulted.
      await expect(runStageAReadOnly({ restBase: 'https://x' })).rejects.toThrow(/fail-closed|BITMART_SECRET_ARN|region/i);
    } finally {
      process.env = prev;
    }
  });

  it('loads credentials via the injected Secrets Manager client and returns schema-only results', async () => {
    // Injected SM client returns a secret JSON; adapter calls go to a stubbed fetch (schema only).
    const fakeSM: SecretsManagerClientLike = {
      async send() {
        return { SecretString: JSON.stringify({ accessKey: 'ak', secretKey: 'sk', memo: 'm' }) };
      },
    };
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({ status: 200, ok: true, json: async () => ({ code: 1000, data: [] }) })) as unknown as typeof fetch;
    try {
      const res = await runStageAReadOnly({ restBase: 'https://x', secretId: 'arn:...:bitmart', region: 'ap-northeast-2', clientFactory: async () => fakeSM });
      expect(res.map((r) => r.item)).toEqual(['assets/available-balance', 'positions', 'open-orders']);
      // schema-only: results carry array/keys, never raw values / secret / signature
      const blob = JSON.stringify(res);
      expect(blob).not.toContain('sk');
      expect(blob).not.toContain('X-BM-SIGN');
      for (const r of res) expect(r.ok).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  // Real live run only in a deployed env with Secrets Manager configured (never in normal CI).
  it.skipIf(!process.env.STAGE_A_LIVE)('live read-only against BitMart via Secrets Manager', async () => {
    const res = await runStageAReadOnly({
      restBase: process.env.BITMART_REST_BASE ?? 'https://api-cloud-v2.bitmart.com',
      secretId: process.env.BITMART_SECRET_ARN ?? process.env.BITMART_SECRET_ID,
      region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION,
    });
    for (const r of res) expect(r.ok).toBe(true);
  });
});
