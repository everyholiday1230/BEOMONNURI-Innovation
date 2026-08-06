import type { DataSource } from '../portfolio/provenance';

/**
 * B9 — server-side assembly of the market context handed to an AI provider.
 *
 * Two defects are closed here.
 *
 * 1. `lastPrice: body.lastPrice ?? 68000`. The fallback made every analysis of an unpriced symbol read
 *    as a confident Bitcoin analysis. A price the system does not have must stop the analysis, not be
 *    replaced by a number that looks plausible.
 *
 * 2. The price was taken from the REQUEST BODY. Even setting the constant aside, that means the caller
 *    chooses the number the model reasons about — so a client could obtain an "AI analysis" of a price
 *    that never existed and screenshot it. The price is now read server-side from the same market
 *    provider that serves `/api/market/ticker`, and a client-supplied price is ignored entirely.
 *
 * The context also carries its own provenance (`source` / `asOf` / `stale`), so a model answer derived
 * from a mock replay can be labelled as such downstream instead of being indistinguishable from a live
 * one.
 */

/** Age beyond which a ticker snapshot is too old to base an analysis on. */
export const AI_CONTEXT_FRESHNESS_MS = 30_000;

export interface AiMarketContext {
  symbol: string;
  timeframe: string;
  /** Decimal STRING. Never a float: the model quotes this back verbatim in entry/stop levels. */
  lastPrice: string;
  markPrice: string | null;
  asOf: number;
  ageMs: number;
  stale: boolean;
  source: DataSource | string;
  tradingMode: string;
  liveTradingEnabled: boolean;
  killSwitchActive: boolean;
  /** Advisory only. Present so the model can reason about exposure; never a licence to act on it. */
  positions: { symbol: string; side: string; size: string; entryPrice: string | null }[];
  risk: {
    openPositionCount: number;
    /** Null when there is no balance snapshot — not zero. */
    availableBalance: string | null;
  };
}

export type AiContextResult =
  | { ok: true; context: AiMarketContext }
  | { ok: false; reason: 'NO_PRICE' | 'STALE_PRICE' | 'PROVIDER_UNAVAILABLE'; detail: string; ageMs: number | null };

export interface TickerLike {
  last?: string | number;
  markPrice?: string | number;
  /** Provider timestamp when available. */
  ts?: number;
}

export interface AiContextDeps {
  getTicker: (symbol: string) => Promise<TickerLike | null>;
  /** User-scoped exposure. Omitted (empty) for an anonymous caller. */
  getPositions: () => { symbol: string; side: string; size: string; entryPrice: string | null }[];
  getAvailableBalance: () => string | null;
  source: DataSource | string;
  tradingMode: string;
  liveTradingEnabled: boolean;
  killSwitchActive: boolean;
  now?: () => number;
}

/**
 * Build the context, or explain why it cannot be built.
 *
 * Every failure path returns `ok: false`. There is no branch in this function that produces a context
 * with an invented price, and there is no default value for `lastPrice` anywhere in this file.
 */
export async function buildAiMarketContext(
  input: { symbol: string; timeframe: string },
  d: AiContextDeps,
): Promise<AiContextResult> {
  const now = (d.now ?? Date.now)();
  let ticker: TickerLike | null;
  try {
    ticker = await d.getTicker(input.symbol);
  } catch (e) {
    // A provider outage is reported as an outage. Falling back to a constant is what made the previous
    // behaviour dangerous rather than merely wrong.
    return { ok: false, reason: 'PROVIDER_UNAVAILABLE', detail: (e as Error).message, ageMs: null };
  }
  if (!ticker) {
    return { ok: false, reason: 'PROVIDER_UNAVAILABLE', detail: 'no ticker for symbol', ageMs: null };
  }

  const raw = ticker.last ?? ticker.markPrice;
  const price = raw === undefined || raw === null ? '' : String(raw);
  if (price.length === 0 || !Number.isFinite(Number(price)) || Number(price) <= 0) {
    return { ok: false, reason: 'NO_PRICE', detail: 'ticker carried no usable price', ageMs: null };
  }

  // Absent a provider timestamp the snapshot is treated as taken now: it was just fetched. This is the
  // only inference made here, and it cannot make a stale price look fresh — the fetch really did happen.
  const asOf = typeof ticker.ts === 'number' ? ticker.ts : now;
  const ageMs = Math.max(0, now - asOf);
  if (ageMs > AI_CONTEXT_FRESHNESS_MS) {
    return { ok: false, reason: 'STALE_PRICE', detail: `snapshot is ${ageMs}ms old`, ageMs };
  }

  const positions = d.getPositions();
  return {
    ok: true,
    context: {
      symbol: input.symbol,
      timeframe: input.timeframe,
      lastPrice: price,
      markPrice: ticker.markPrice === undefined || ticker.markPrice === null ? null : String(ticker.markPrice),
      asOf,
      ageMs,
      stale: false,
      source: d.source,
      tradingMode: d.tradingMode,
      liveTradingEnabled: d.liveTradingEnabled,
      killSwitchActive: d.killSwitchActive,
      positions,
      risk: {
        openPositionCount: positions.length,
        availableBalance: d.getAvailableBalance(),
      },
    },
  };
}
