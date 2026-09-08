import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAiMarketContext, AI_CONTEXT_FRESHNESS_MS, type AiContextDeps } from '../ai/market-context';

/**
 * B9 — AI market context and provider boundary.
 *
 * The behaviour being pinned is a refusal. Previously an analysis with no price silently became an
 * analysis of 68000, and the price came from the request body. Both are now failures, and the tests
 * assert the failure rather than the happy path alone.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const NOW = 1_800_000_000_000;

function deps(over: Partial<AiContextDeps> = {}): AiContextDeps {
  return {
    getTicker: async () => ({ last: '65000.5', markPrice: '65001.0', ts: NOW }),
    getPositions: () => [],
    getAvailableBalance: () => null,
    source: 'MOCK',
    tradingMode: 'MOCK',
    liveTradingEnabled: false,
    killSwitchActive: true,
    now: () => NOW,
    ...over,
  };
}

describe('B9 AI market context', () => {
  it('builds a context from a real ticker and keeps the price a decimal string', async () => {
    const r = await buildAiMarketContext({ symbol: 'BTCUSDT', timeframe: '15m' }, deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // A float round-trip here would change the level the model quotes back to the user.
    expect(r.context.lastPrice).toBe('65000.5');
    expect(r.context.markPrice).toBe('65001.0');
    expect(r.context.source).toBe('MOCK');
    expect(r.context.tradingMode).toBe('MOCK');
    expect(r.context.liveTradingEnabled).toBe(false);
    expect(r.context.killSwitchActive).toBe(true);
    expect(r.context.stale).toBe(false);
    expect(r.context.asOf).toBe(NOW);
  });

  it('refuses when the ticker carries no usable price', async () => {
    for (const bad of [undefined, null, '', '0', '-5', 'NaN']) {
      const r = await buildAiMarketContext(
        { symbol: 'BTCUSDT', timeframe: '15m' },
        deps({ getTicker: async () => ({ last: bad as string | undefined }) }),
      );
      expect(r.ok, `price ${String(bad)}`).toBe(false);
      if (!r.ok) expect(r.reason).toBe('NO_PRICE');
    }
  });

  it('refuses when the snapshot is older than the freshness window', async () => {
    const r = await buildAiMarketContext(
      { symbol: 'BTCUSDT', timeframe: '15m' },
      deps({ getTicker: async () => ({ last: '65000', ts: NOW - AI_CONTEXT_FRESHNESS_MS - 1 }) }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('STALE_PRICE');
  });

  it('reports a provider outage as an outage, never as a fallback price', async () => {
    const thrown = await buildAiMarketContext(
      { symbol: 'BTCUSDT', timeframe: '15m' },
      deps({
        getTicker: async () => {
          throw new Error('upstream down');
        },
      }),
    );
    expect(thrown.ok).toBe(false);
    if (!thrown.ok) expect(thrown.reason).toBe('PROVIDER_UNAVAILABLE');

    const missing = await buildAiMarketContext({ symbol: 'X', timeframe: '15m' }, deps({ getTicker: async () => null }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe('PROVIDER_UNAVAILABLE');
  });

  it('falls back to the mark price when last is absent, rather than to a constant', async () => {
    const r = await buildAiMarketContext(
      { symbol: 'BTCUSDT', timeframe: '15m' },
      deps({ getTicker: async () => ({ markPrice: '3400.25', ts: NOW }) }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.context.lastPrice).toBe('3400.25');
  });

  it('includes position and risk context and reports an unknown balance as null', async () => {
    const r = await buildAiMarketContext(
      { symbol: 'BTCUSDT', timeframe: '15m' },
      deps({
        getPositions: () => [{ symbol: 'BTCUSDT', side: 'long', size: '0.5', entryPrice: '64000' }],
        getAvailableBalance: () => null,
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.context.positions).toHaveLength(1);
    expect(r.context.risk.openPositionCount).toBe(1);
    // Zero would tell the model the account is empty, which is a different claim from "unknown".
    expect(r.context.risk.availableBalance).toBeNull();
  });

  it('contains no default price anywhere in the module source', () => {
    const src = readFileSync(join(HERE, '..', 'ai', 'market-context.ts'), 'utf8');
    // Strip comments: the file documents the removed constant, and that prose must not fail the check.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/68000/);
    // No `?? <number>` or `|| <number>` fallback on a price.
    expect(code).not.toMatch(/lastPrice\s*(\?\?|\|\|)\s*\d/);
  });
});


describe('B9 no live provider is reachable from this build', () => {
  it('the analyze path does not reference a live AI provider host', () => {
    const index = readFileSync(join(HERE, '..', 'index.ts'), 'utf8');
    const ctx = readFileSync(join(HERE, '..', 'ai', 'market-context.ts'), 'utf8');
    /* ★ mock-ai-provider.ts 는 /api/ai/analyze 와 함께 제거됐다(대본 신호 경로). */
    for (const [name, src] of [['index.ts', index], ['market-context.ts', ctx]] as const) {
      expect(src, name).not.toMatch(/api\.openai\.com/);
    }
  });

  it('the AI path never trusts a client-supplied price', () => {
    const src = readFileSync(join(HERE, '..', 'index.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // The old expression must not come back anywhere.
    expect(code).not.toMatch(/lastPrice:\s*body\.lastPrice/);
    /*
       ★ 검사 대상을 옮겼다. 예전에는 `/api/ai/analyze` 가 `Number(ctx.lastPrice)` 를
         쓰는지 봤는데, 그 라우트는 제거됐다(대본 응답 MockAIProvider 가 "항상 롱"
         신호를 내보내던 경로다). 지금 모델에게 시세를 넘기는 곳은 코파일럿이고,
         근거는 **서버가 만든 스냅샷**이어야 한다 — 화면이 보낸 값을 그대로 쓰면
         조작된 요청이 모델의 판단 근거를 바꾼다.
    */
    const routes = readFileSync(join(HERE, '..', 'ai-routes.ts'), 'utf8');
    const rcode = routes.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(rcode, '서버가 만든 근거를 넘기지 않는다').toMatch(/marketData:\s*grounded\?\.marketData/);
    expect(rcode, '화면이 보낸 시세를 근거로 쓴다').not.toMatch(/marketData:\s*body\./);
  });
});
