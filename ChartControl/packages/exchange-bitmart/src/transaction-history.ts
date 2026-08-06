/**
 * BitMart futures transaction history (`/contract/private/transaction-history`).
 *
 * This is the honest replacement for the prototype's `/wallet/transactions` ledger (gap G5). We are
 * non-custodial: there is no QuantumTrade ledger, no deposit addresses and no withdrawal queue. What DOES
 * exist — and what a user actually wants on that screen — is the money movement on their own exchange
 * futures account, readable with the Read-only permission they already granted.
 *
 * Documented flow types (`flow_type`):
 *   1 Transfer · 2 Realized PNL · 3 Funding Fee · 4 Commission Fee · 5 Liquidation Clearance
 *
 * Two properties of the upstream response drive the parsing below:
 *
 *  - `amount` is a **signed decimal string** ("-0.37500000"). Fees and losses arrive negative, so the sign
 *    must be preserved rather than normalised into a separate direction field.
 *  - `time` is a **string** holding epoch milliseconds ("1570608000000"), unlike the kline `ts` which is
 *    seconds. Treating it as seconds would place every row in 1970.
 */

/** Upstream flow types, as documented. */
export const TRANSACTION_FLOW_TYPES = {
  1: 'TRANSFER',
  2: 'REALIZED_PNL',
  3: 'FUNDING_FEE',
  4: 'COMMISSION_FEE',
  5: 'LIQUIDATION_CLEARANCE',
} as const;

export type TransactionKind =
  | (typeof TRANSACTION_FLOW_TYPES)[keyof typeof TRANSACTION_FLOW_TYPES]
  | 'UNKNOWN';

/** Maps the upstream `type` string onto our kind. The response carries the label, not the numeric code. */
const LABEL_TO_KIND: Record<string, TransactionKind> = {
  Transfer: 'TRANSFER',
  'Realized PNL': 'REALIZED_PNL',
  'Funding Fee': 'FUNDING_FEE',
  'Commission Fee': 'COMMISSION_FEE',
  'Liquidation Clearance': 'LIQUIDATION_CLEARANCE',
};

export interface ExchangeTransaction {
  id: string;
  kind: TransactionKind;
  /** Present for symbol-scoped rows; transfers carry an empty symbol upstream, normalised to null. */
  symbol: string | null;
  /** SIGNED decimal string. Negative for fees and losses. */
  amount: string;
  asset: string;
  /** Epoch milliseconds. */
  time: number;
  /** `futures` or `copy_trading`. */
  account: string | null;
  /** Upstream label, kept verbatim so an unmapped type is still legible. */
  rawType: string;
}

/**
 * Query parameters we accept.
 *
 * Kept as a plain interface: this package has no zod dependency, and per ADR the request schema lives in
 * `@quantumtrade/schemas` (`ExchangeTransactionQuerySchema`) where the API validates it.
 */
export interface ExchangeTransactionQuery {
  symbol?: string;
  /** Upstream flow_type. 0 or omitted = all. */
  flowType?: number;
  /** Epoch MILLISECONDS (this endpoint differs from the kline endpoints, which use seconds). */
  startTime?: number;
  endTime?: number;
  pageSize?: number;
}

function str(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/**
 * Parses the upstream payload.
 *
 * Rows that cannot be understood are DROPPED rather than coerced. A transaction with a zero amount or an
 * epoch of 0 would appear on a money screen as a real event that never happened.
 */
export function parseExchangeTransactions(body: unknown): ExchangeTransaction[] {
  const rows = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const out: ExchangeTransaction[] = [];
  for (const r of rows) {
    if (r === null || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;

    const amount = str(o.amount);
    const asset = str(o.asset);
    // `time` is a STRING of epoch milliseconds here, not seconds.
    const timeRaw = str(o.time);
    const time = timeRaw === null ? NaN : Number(timeRaw);
    if (amount === null || asset === null || !Number.isFinite(time) || time <= 0) continue;
    if (!Number.isFinite(Number(amount))) continue;

    const rawType = str(o.type) ?? '';
    const symbol = str(o.symbol);
    out.push({
      // `tran_id` is the upstream identifier; it is not guaranteed unique across types, so the fallback
      // composes one rather than emitting an empty key that would collapse React list identity.
      id: str(o.tran_id) ?? `${time}-${rawType}-${amount}`,
      kind: LABEL_TO_KIND[rawType] ?? 'UNKNOWN',
      symbol,
      amount,
      asset,
      time: Math.round(time),
      account: str(o.account),
      rawType,
    });
  }
  // Newest first: a ledger read top-down should start at the most recent movement.
  return out.sort((a, b) => b.time - a.time);
}

/**
 * Per-asset, per-kind decimal totals.
 *
 * Summed with BigInt on scaled integers, never floats: `-0.00027 + 0.00027` must be exactly `0`, and a
 * float sum of fee rows drifts visibly once there are a few hundred of them.
 */
export function summarizeTransactions(
  txs: readonly ExchangeTransaction[],
): { asset: string; kind: TransactionKind; total: string; count: number }[] {
  const groups = new Map<string, { asset: string; kind: TransactionKind; rows: string[] }>();
  for (const t of txs) {
    const k = `${t.asset}|${t.kind}`;
    let g = groups.get(k);
    if (!g) { g = { asset: t.asset, kind: t.kind, rows: [] }; groups.set(k, g); }
    g.rows.push(t.amount);
  }
  return [...groups.values()]
    .map((g) => ({ asset: g.asset, kind: g.kind, total: sumDecimals(g.rows), count: g.rows.length }))
    .sort((a, b) => a.asset.localeCompare(b.asset) || a.kind.localeCompare(b.kind));
}

/** Exact decimal sum of signed decimal strings. */
export function sumDecimals(values: readonly string[]): string {
  let scale = 0;
  for (const v of values) {
    const dot = v.indexOf('.');
    if (dot !== -1) scale = Math.max(scale, v.length - dot - 1);
  }
  let total = 0n;
  for (const v of values) {
    const neg = v.startsWith('-');
    const body = neg ? v.slice(1) : v.replace(/^\+/u, '');
    const dot = body.indexOf('.');
    const intPart = dot === -1 ? body : body.slice(0, dot);
    const fracPart = dot === -1 ? '' : body.slice(dot + 1);
    const digits = `${intPart || '0'}${fracPart.padEnd(scale, '0')}`;
    if (!/^\d+$/u.test(digits)) continue;
    const n = BigInt(digits);
    total += neg ? -n : n;
  }
  if (scale === 0) return total.toString();
  const neg = total < 0n;
  const abs = (neg ? -total : total).toString().padStart(scale + 1, '0');
  const int = abs.slice(0, abs.length - scale);
  const frac = abs.slice(abs.length - scale);
  return `${neg ? '-' : ''}${int}.${frac}`;
}

/** Upstream query parameters. `flow_type` 0 means all and is omitted rather than sent. */
export function buildTransactionParams(q: ExchangeTransactionQuery): Record<string, string | number | undefined> {
  return {
    ...(q.symbol ? { symbol: q.symbol } : {}),
    ...(q.flowType !== undefined && q.flowType !== 0 ? { flow_type: q.flowType } : {}),
    // Milliseconds, per the endpoint's own documentation — unlike the kline endpoints.
    ...(q.startTime !== undefined ? { start_time: q.startTime } : {}),
    ...(q.endTime !== undefined ? { end_time: q.endTime } : {}),
    ...(q.pageSize !== undefined ? { page_size: q.pageSize } : {}),
  };
}

export const TRANSACTION_HISTORY_PATH = '/contract/private/transaction-history';

/**
 * Constraints stated by the upstream documentation, surfaced so the UI can explain a truncated result
 * instead of presenting it as complete.
 */
export const TRANSACTION_HISTORY_LIMITS = {
  /** With no explicit range, only the last 7 days are returned. */
  defaultWindowDays: 7,
  /** Rate limit: 6 requests / 2s per API key. */
  rateLimitPer2s: 6,
  maxPageSize: 1000,
  defaultPageSize: 100,
} as const;
