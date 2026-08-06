import { buildKeyedHeaders } from './signature';

/**
 * BitMart API Broker rebate records.
 *
 * Reference: developer-pro.bitmart.com/en/broker/ → "Get Rebate Records (KEYED)".
 *
 *   GET https://api-cloud.bitmart.com/spot/v1/broker/rebate?start_time=&end_time=
 *   Auth: KEYED — `X-BM-KEY` only, no signature.
 *   Omitting both bounds returns the last 180 days.
 *
 * Three things about this endpoint drive the design here:
 *
 *  1. **It reports the operator's revenue, not a user's.** The rebate is credited to our own BitMart
 *     spot wallet, and the response is a daily total per currency with no user or order dimension. It
 *     therefore CANNOT be used to compute what an individual user earned — per-user payback has to be
 *     derived from our own fill records. Treating this as a per-user source would silently invent
 *     attribution that BitMart never provided.
 *  2. **It requires the operator's own API key**, not the end user's. Callers must supply the broker
 *     account's access key.
 *  3. **Only a spot endpoint is documented.** Whether futures fills are rebated at all is unconfirmed
 *     with BitMart as of 2026-08-02, and no futures rebate endpoint exists in the reference. So
 *     records carry an explicit `source`, and `'futures'` is modelled but deliberately not fetched:
 *     inventing an endpoint would produce plausible-looking numbers with nothing behind them.
 */

/** Documented host for the spot/broker endpoints. Note this is NOT the futures v2 host. */
export const BITMART_SPOT_REST_BASE = 'https://api-cloud.bitmart.com';

export const BROKER_REBATE_PATH = '/spot/v1/broker/rebate';

/** Which product line a rebate came from. `futures` is not fetchable yet — see file header. */
export type RebateSource = 'spot' | 'futures';

/** One day's rebate in one currency. Amount kept as a decimal string (no float money math). */
export interface RebateRecord {
  /** `YYYY-MM-DD` as returned by BitMart. */
  date: string;
  currency: string;
  /** Decimal string, e.g. "10.238". */
  amount: string;
  source: RebateSource;
}

export interface RebateQuery {
  /** Unix timestamp, SECONDS. Omit both bounds for the last 180 days. */
  startTime?: number;
  endTime?: number;
}

/**
 * BitMart's `code` field. `1000` is success; anything else is an application-level error delivered
 * with HTTP 200, so the status code alone cannot be trusted.
 */
export const BITMART_OK_CODE = 1000;

/** Error codes the broker section documents, mapped to actionable meanings. */
export const BROKER_ERROR_MEANINGS: Record<number, string> = {
  50000: 'bad request',
  50041: 'requested time range is out of the allowed window',
  53005: 'this API key has no broker-interface permission',
  57001: 'method not allowed',
  58001: 'unsupported media type',
  59002: 'BitMart internal error',
};

export class BrokerRebateError extends Error {
  constructor(
    message: string,
    /** HTTP status, or 0 when the failure happened before a response. */
    public readonly httpStatus: number,
    /** BitMart application code when present. */
    public readonly code?: number,
  ) {
    super(message);
    this.name = 'BrokerRebateError';
  }
}

/**
 * Shape of the documented response. Deliberately loose: the daily map has arbitrary date keys, and an
 * unknown extra field must not make the whole response unparseable.
 */
interface RawRebateResponse {
  code?: number;
  message?: string;
  data?: {
    rebates?: Record<string, { currency?: string; rebate_amount?: string }[]>;
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const DECIMAL_RE = /^-?\d+(\.\d+)?$/u;

/**
 * Flatten BitMart's `{ date: [{currency, rebate_amount}] }` map into a sorted record list.
 *
 * Entries that are not usable — missing currency, non-decimal amount, malformed date — are DROPPED
 * rather than coerced. A rebate figure is money: a silently zeroed or NaN row would corrupt a
 * reconciliation, and dropping it leaves a visible discrepancy against BitMart's own statement, which
 * is the failure mode we want.
 */
export function parseRebateRecords(raw: unknown, source: RebateSource = 'spot'): RebateRecord[] {
  const body = (raw ?? {}) as RawRebateResponse;
  const map = body.data?.rebates;
  if (!map || typeof map !== 'object') return [];

  const out: RebateRecord[] = [];
  for (const [date, entries] of Object.entries(map)) {
    if (!DATE_RE.test(date) || !Array.isArray(entries)) continue;
    for (const e of entries) {
      const currency = typeof e?.currency === 'string' ? e.currency.trim().toUpperCase() : '';
      const amount = typeof e?.rebate_amount === 'string' ? e.rebate_amount.trim() : '';
      if (!currency || !DECIMAL_RE.test(amount)) continue;
      out.push({ date, currency, amount, source });
    }
  }
  // Stable ordering: date, then currency. Makes diffing two statements meaningful.
  return out.sort((a, b) => (a.date === b.date ? a.currency.localeCompare(b.currency) : a.date.localeCompare(b.date)));
}

export interface RebateSummary {
  /** Total per currency, as a decimal string. */
  byCurrency: Record<string, string>;
  /** Per-source total per currency — keeps spot and futures separable. */
  bySource: Record<RebateSource, Record<string, string>>;
  currencies: string[];
  from: string | null;
  to: string | null;
  recordCount: number;
}

/** Sum decimal strings without floats: scale to integers on the longest fraction, add, rescale. */
function sumDecimalStrings(values: readonly string[]): string {
  if (values.length === 0) return '0';
  const scale = Math.max(...values.map((v) => (v.split('.')[1] ?? '').length));
  const total = values.reduce((acc, v) => {
    const [int = '0', frac = ''] = v.split('.');
    const scaled = `${int}${frac.padEnd(scale, '0')}`;
    return acc + BigInt(scaled);
  }, 0n);

  if (scale === 0) return total.toString();
  const neg = total < 0n;
  const digits = (neg ? -total : total).toString().padStart(scale + 1, '0');
  const int = digits.slice(0, -scale);
  const frac = digits.slice(-scale).replace(/0+$/u, '');
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`;
}

/**
 * Aggregate records per currency and per source.
 *
 * No fiat total is produced. Converting BMX/USDT/etc. into one number needs exchange rates we do not
 * have here, and a made-up total on a revenue dashboard is worse than no total.
 */
export function summarizeRebates(records: readonly RebateRecord[]): RebateSummary {
  const byCurrency: Record<string, string> = {};
  const bySource: Record<RebateSource, Record<string, string>> = { spot: {}, futures: {} };

  const group = (rs: readonly RebateRecord[]): Record<string, string> => {
    const buckets = new Map<string, string[]>();
    for (const r of rs) {
      const list = buckets.get(r.currency) ?? [];
      list.push(r.amount);
      buckets.set(r.currency, list);
    }
    return Object.fromEntries([...buckets].map(([c, vs]) => [c, sumDecimalStrings(vs)]));
  };

  Object.assign(byCurrency, group(records));
  bySource.spot = group(records.filter((r) => r.source === 'spot'));
  bySource.futures = group(records.filter((r) => r.source === 'futures'));

  const dates = records.map((r) => r.date).sort();
  return {
    byCurrency,
    bySource,
    currencies: Object.keys(byCurrency).sort(),
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    recordCount: records.length,
  };
}

export interface BrokerRebateClientConfig {
  /** Defaults to the documented spot host. */
  restBase?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Sent as `X-BM-BROKER-ID`; BitMart's sample includes it on KEYED requests too. */
  brokerId?: string;
}

/** The operator's own BitMart API key. Only the access key is needed — KEYED endpoints are unsigned. */
export interface BrokerAccessKey {
  accessKey: string;
}

export class BitMartBrokerRebateClient {
  private readonly restBase: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly cfg: BrokerRebateClientConfig = {}) {
    this.restBase = cfg.restBase ?? BITMART_SPOT_REST_BASE;
    this.fetchImpl = cfg.fetchImpl ?? globalThis.fetch;
    this.timeoutMs = cfg.timeoutMs ?? 10_000;
  }

  /**
   * Fetch spot rebate records for the operator's broker account.
   *
   * `startTime`/`endTime` are SECONDS. The reference documents the field as `long` and its curl
   * example uses `end_time=1683367993` — ten digits, i.e. seconds. (The same example's `start_time`
   * has eleven digits, which does not correspond to a plausible date in either unit and appears to be
   * a typo in the docs.) The unit is therefore inferred from the example rather than stated, and is
   * applied in this one place so it can be corrected centrally if BitMart clarifies otherwise.
   */
  async getSpotRebates(key: BrokerAccessKey, q: RebateQuery = {}): Promise<RebateRecord[]> {
    if (!key.accessKey) {
      throw new BrokerRebateError('operator access key is required for broker rebate queries', 0);
    }
    const params = new URLSearchParams();
    if (q.startTime !== undefined) params.set('start_time', String(Math.trunc(q.startTime)));
    if (q.endTime !== undefined) params.set('end_time', String(Math.trunc(q.endTime)));
    const qs = params.toString();
    const url = `${this.restBase}${BROKER_REBATE_PATH}${qs ? `?${qs}` : ''}`;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'GET',
        headers: buildKeyedHeaders(key.accessKey, this.cfg.brokerId) as unknown as Record<string, string>,
        signal: ac.signal,
      });
    } catch (e) {
      throw new BrokerRebateError(`rebate request failed: ${(e as Error).message}`, 0);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // 403 here most often means the key lacks broker-interface permission rather than a bad key.
      throw new BrokerRebateError(`rebate request http_${res.status}`, res.status);
    }

    const body = (await res.json()) as RawRebateResponse;
    if (body?.code !== undefined && body.code !== BITMART_OK_CODE) {
      const meaning = BROKER_ERROR_MEANINGS[body.code] ?? 'unknown broker error';
      throw new BrokerRebateError(`rebate error ${body.code}: ${meaning}`, res.status, body.code);
    }
    return parseRebateRecords(body, 'spot');
  }

  /**
   * Futures rebate records — NOT IMPLEMENTED.
   *
   * The Broker API reference documents no futures rebate endpoint, and whether futures fills are
   * rebated at all is an open question with BitMart (asked 2026-08-02, unanswered). This method exists
   * so callers can be written against the final shape, and throws rather than returning `[]`: an empty
   * array is indistinguishable from "no rebate earned" and would read as a real zero on a dashboard.
   */
  async getFuturesRebates(): Promise<never> {
    throw new BrokerRebateError(
      'futures rebate retrieval is not implemented: BitMart documents no futures rebate endpoint and eligibility is unconfirmed',
      0,
    );
  }
}
