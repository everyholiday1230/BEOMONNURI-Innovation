import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAiMarketContext, AI_CONTEXT_FRESHNESS_MS, type AiContextDeps } from '../ai/market-context';
import { MockAIProvider } from '../ai/mock-ai-provider';

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

describe('B9 provider boundary', () => {
  it('refuses to analyse without a real price instead of substituting one', async () => {
    const p = new MockAIProvider();
    const events: string[] = [];
    for await (const ev of p.analyze(
      { symbol: 'BTCUSDT', timeframe: '15m', prompt: 'x', dataAsOf: NOW, lastPrice: 0 },
      new AbortController().signal,
    )) {
      events.push(ev.type);
      if (ev.type === 'error') expect(ev.message).toMatch(/no reference price/);
    }
    expect(events).toEqual(['error']);
  });

  it('is deterministic for the same price, apart from the generation timestamp', async () => {
    const run = async () => {
      const out: string[] = [];
      for await (const ev of new MockAIProvider().analyze(
        { symbol: 'BTCUSDT', timeframe: '15m', prompt: 'x', dataAsOf: NOW, lastPrice: 65000 },
        new AbortController().signal,
      )) {
        // `signal.generatedAt` is a wall clock reading and SHOULD differ between runs — it records when
        // the analysis was produced. Determinism is claimed for the analysis CONTENT, which is what makes
        // assertions about AI output stable; normalising the timestamp states that distinction instead of
        // pretending the whole payload is frozen.
        const normalised =
          ev.type === 'signal' ? { ...ev, signal: { ...ev.signal, generatedAt: 0 } } : ev;
        out.push(JSON.stringify(normalised));
      }
      return out;
    };
    expect(await run()).toEqual(await run());
  });

  it('derives every level from the supplied price, so a different price gives a different analysis', async () => {
    const levels = async (price: number) => {
      for await (const ev of new MockAIProvider().analyze(
        { symbol: 'BTCUSDT', timeframe: '15m', prompt: 'x', dataAsOf: NOW, lastPrice: price },
        new AbortController().signal,
      )) {
        if (ev.type === 'signal') return ev.signal.entryZone;
      }
      return null;
    };
    // If a constant were still in play, these would be equal — which is exactly the defect B9 removes.
    expect(await levels(65000)).not.toEqual(await levels(3400));
  });

  it('never emits an order submission event', async () => {
    const types = new Set<string>();
    for await (const ev of new MockAIProvider().analyze(
      { symbol: 'BTCUSDT', timeframe: '15m', prompt: 'submit a market buy now', dataAsOf: NOW, lastPrice: 65000 },
      new AbortController().signal,
    )) {
      types.add(ev.type);
      // Even when the prompt asks for it: the provider's event union has no order-submit member, and
      // this asserts the runtime shape agrees with the type.
      expect(['token', 'command', 'signal', 'error', 'done']).toContain(ev.type);
    }
    expect(types.has('signal')).toBe(true);
  });

  it('contains no default price in the provider source either', () => {
    const src = readFileSync(join(HERE, '..', 'ai', 'mock-ai-provider.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/lastPrice\s*(\?\?|\|\|)\s*\d/);
    expect(code).not.toMatch(/68000/);
  });
});

describe('B9 no live provider is reachable from this build', () => {
  it('the analyze path does not reference a live AI provider host', () => {
    const index = readFileSync(join(HERE, '..', 'index.ts'), 'utf8');
    const provider = readFileSync(join(HERE, '..', 'ai', 'mock-ai-provider.ts'), 'utf8');
    const ctx = readFileSync(join(HERE, '..', 'ai', 'market-context.ts'), 'utf8');
    for (const [name, src] of [['index.ts', index], ['mock-ai-provider.ts', provider], ['market-context.ts', ctx]] as const) {
      expect(src, name).not.toMatch(/api\.openai\.com/);
    }
  });

  it('the analyze route no longer trusts a client-supplied price', () => {
    const src = readFileSync(join(HERE, '..', 'index.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // The old expression must be gone from executable code.
    expect(code).not.toMatch(/lastPrice:\s*body\.lastPrice/);
    // And the price must come from the server-built context.
    expect(code).toMatch(/lastPrice:\s*Number\(ctx\.lastPrice\)/);
  });
});
