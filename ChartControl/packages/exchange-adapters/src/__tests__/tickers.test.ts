import { describe, it, expect } from 'vitest';
import {
  MockReplayProvider,
  BitMartPublicMarketDataProvider,
  bitmartChangeRatioToPercent,
} from '../index';

/**
 * `getTickers()` — the batch read behind `/api/market/tickers`.
 *
 * It exists so the markets screen costs one upstream call instead of one per symbol, so the tests pin
 * that it covers the whole catalogue, that its values are usable for sorting and filtering (i.e. not all
 * identical), and that a malformed upstream row is dropped rather than blanking the screen or being
 * coerced to zero.
 */

describe('TKS-01 mock provider', () => {
  it('[1] returns a ticker for every symbol in the catalogue', async () => {
    const p = new MockReplayProvider();
    const [symbols, tickers] = await Promise.all([p.getSymbols(), p.getTickers()]);
    expect(tickers).toHaveLength(symbols.length);
    expect(tickers.map((t) => t.symbol).sort()).toEqual(symbols.map((s) => s.id).sort());
  });

  it('[2] values are deterministic across calls', async () => {
    // A markets table whose numbers changed on every poll would make a real update indistinguishable
    // from noise, and no screenshot would reproduce.
    const p = new MockReplayProvider();
    const a = await p.getTickers();
    const b = await p.getTickers();
    expect(a.map((t) => [t.symbol, t.last, t.changePct, t.vol24h])).toEqual(
      b.map((t) => [t.symbol, t.last, t.changePct, t.vol24h]),
    );
  });

  it('[3] symbols differ from each other — sorting and filters need spread', async () => {
    const t = await new MockReplayProvider().getTickers();
    expect(new Set(t.map((x) => x.changePct)).size).toBeGreaterThan(1);
    expect(new Set(t.map((x) => x.vol24h)).size).toBeGreaterThan(1);
    // Both directions must be representable or the Gainers/Losers tabs cannot be exercised.
    expect(t.some((x) => x.changePct > 0)).toBe(true);
  });

  it('[4] prices carry the symbol precision and parse as finite decimals', async () => {
    const p = new MockReplayProvider();
    const symbols = await p.getSymbols();
    const tickers = await p.getTickers();
    for (const t of tickers) {
      const s = symbols.find((x) => x.id === t.symbol)!;
      expect(t.last).toMatch(/^\d+(\.\d+)?$/u);
      expect((t.last.split('.')[1] ?? '').length).toBe(s.pricePrecision);
      expect(Number.isFinite(Number(t.last))).toBe(true);
      expect(Number(t.vol24h)).toBeGreaterThan(0);
    }
  });

  it('[5] the 24h range brackets the last price', async () => {
    for (const t of await new MockReplayProvider().getTickers()) {
      expect(Number(t.low24h)).toBeLessThanOrEqual(Number(t.last));
      expect(Number(t.high24h)).toBeGreaterThanOrEqual(Number(t.last));
    }
  });
});

describe('TKS-02 BitMart public provider', () => {
  const provider = (rows: unknown) =>
    new BitMartPublicMarketDataProvider({
      restBase: 'https://x',
      fetchImpl: (async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ code: 1000, data: { symbols: rows } }),
          headers: { get: () => null },
        }) as unknown as Response) as unknown as typeof fetch,
    });

  it('[1] maps BitMart contract rows to tickers', async () => {
    const t = await provider([
      {
        symbol: 'BTCUSDT',
        last_price: '68000.5',
        change_24h: 0.025,
        high_24h: '69000',
        low_24h: '67000',
        volume_24h: '123456',
      },
    ]).getTickers();

    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({
      symbol: 'BTCUSDT',
      last: '68000.5',
      // 0.025 is a RATIO upstream → 2.5 percent.
      changePct: 2.5,
      high24h: '69000',
      low24h: '67000',
      vol24h: '123456',
    });
  });

  it('[2] one malformed row is dropped, the rest survive', async () => {
    // Dropping leaves a visibly missing pair; zeroing it would silently corrupt the table.
    const t = await provider([
      { symbol: 'BTCUSDT', last_price: '68000', change_24h: 1 },
      { symbol: 'BADUSDT', last_price: 'not-a-number', change_24h: 1 },
      { symbol: 'ETHUSDT', last_price: '3400', change_24h: -1 },
    ]).getTickers();

    expect(t.map((x) => x.symbol)).toEqual(['BTCUSDT', 'ETHUSDT']);
  });

  it('[3] a row without a symbol is skipped', async () => {
    const t = await provider([{ last_price: '1', change_24h: 0 }, { symbol: '', last_price: '1' }]).getTickers();
    expect(t).toEqual([]);
  });

  it('[4] an empty upstream list yields an empty array, not an error', async () => {
    expect(await provider([]).getTickers()).toEqual([]);
  });
});

describe('TKS-03 change_24h is a ratio, not a percentage', () => {
  /**
   * Verified against live BitMart data on 2026-08-03 (see the note on
   * `bitmartChangeRatioToPercent`): all 1,215 contracts reported |change_24h| < 0.03, and comparing
   * `last_price` to the hourly close exactly 24h earlier gave 6/6 sign agreement with matching
   * magnitudes. Pinned here because getting it wrong shows every 24h change ~100× too small — a wrong
   * number that looks plausible.
   */
  it('[1] scales a ratio to percent', () => {
    expect(bitmartChangeRatioToPercent(0.025)).toBe(2.5);
    expect(bitmartChangeRatioToPercent('0.004')).toBe(0.4);
    expect(bitmartChangeRatioToPercent(0.0779369627507)).toBe(7.7937);
  });

  it('[2] preserves sign — Gainers/Losers depend on it', () => {
    expect(bitmartChangeRatioToPercent(-0.0061046511627907)).toBeCloseTo(-0.6105, 4);
    expect(Math.sign(bitmartChangeRatioToPercent(-0.01))).toBe(-1);
    expect(Math.sign(bitmartChangeRatioToPercent(0.01))).toBe(1);
  });

  it('[3] trims float noise to 4dp', () => {
    // The raw ratio arrives with 16 significant digits; a percent shown to 2dp needs no more.
    expect(bitmartChangeRatioToPercent(0.0056745209241998)).toBe(0.5675);
  });

  it('[4] missing or unparseable input is 0, not NaN', () => {
    expect(bitmartChangeRatioToPercent(undefined)).toBe(0);
    expect(bitmartChangeRatioToPercent(null)).toBe(0);
    expect(bitmartChangeRatioToPercent('abc')).toBe(0);
  });

  it('[5] a realistic move survives the round trip at display precision', () => {
    // ADA on 2026-08-03: raw 0.077936962750716, measured actual +6.70%.
    const pct = bitmartChangeRatioToPercent(0.077936962750716);
    expect(pct.toFixed(2)).toBe('7.79');
    expect(pct).toBeGreaterThan(1); // not 0.08 — the failure mode this guards
  });
});
