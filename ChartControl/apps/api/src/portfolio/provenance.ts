/**
 * Data provenance envelope (Prompt 5 §7/§8/§9).
 *
 * Every read model and every validation result carries where its numbers came from. Without this a
 * simulated position and a real one are indistinguishable in the response, which is exactly the
 * failure mode the "no fake data" rule exists to prevent.
 */

export type DataSource = 'MOCK' | 'SNAPSHOT' | 'LIVE';

/** Deployment-level trading posture. Read from env at mount time, never from the request. */
export interface TradingPosture {
  source: DataSource;
  tradingMode: string;
  liveTradingEnabled: boolean;
  killSwitchActive: boolean;
}

export interface Provenance extends TradingPosture {
  /** Timestamp of the newest underlying record, or null when the result set is empty. */
  asOf: number | null;
  /** When this response was produced. Distinct from `asOf`: serving time is not data freshness. */
  servedAt: number;
  stale: boolean;
  /**
   * Why `stale` has the value it has. `NOT_APPLICABLE` is used for stores of immutable records
   * (orders, fills): a settled fill from last week is not "stale", it is simply old. Reporting
   * `stale: true` there would train the UI to ignore the flag on the feeds where it does matter.
   */
  freshness: 'FRESH' | 'STALE' | 'EMPTY' | 'NOT_APPLICABLE';
}

export interface ProvenanceInput {
  posture: TradingPosture;
  /** Newest record timestamp in the result set (ms epoch), or null when empty. */
  asOf: number | null;
  now: number;
  /**
   * Age beyond which the data is stale, in ms. `null` means staleness does not apply to this
   * contract because the underlying store holds records rather than a live feed.
   */
  freshnessMs: number | null;
}

export function buildProvenance(input: ProvenanceInput): Provenance {
  const { posture, asOf, now, freshnessMs } = input;
  let freshness: Provenance['freshness'];
  if (freshnessMs === null) freshness = 'NOT_APPLICABLE';
  else if (asOf === null) freshness = 'EMPTY';
  else freshness = now - asOf > freshnessMs ? 'STALE' : 'FRESH';

  return {
    ...posture,
    asOf,
    servedAt: now,
    // Only a real, measurable age produces `stale: true`. An empty result set is reported as EMPTY
    // rather than STALE so the UI can tell "you have no positions" from "we cannot see your positions".
    stale: freshness === 'STALE',
    freshness,
  };
}

/** Mark-price / balance snapshots older than this are reported stale. */
export const MARK_PRICE_FRESHNESS_MS = 15_000;
