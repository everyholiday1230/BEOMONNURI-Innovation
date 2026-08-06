import { createHmac } from 'node:crypto';

/**
 * BitMart Production authentication (docs PHASE3-01). SIGNED endpoints use:
 *   signingPayload = `${timestamp}#${memo}#${requestPayload}`
 *   X-BM-SIGN      = HMAC_SHA256(secretKey, signingPayload)  (hex)
 * Headers: X-BM-KEY (access key), X-BM-SIGN, X-BM-TIMESTAMP (ms).
 * The `requestPayload` MUST be byte-identical to the request body/query actually sent.
 * Secrets/memo are NEVER logged; this module only returns headers.
 */
export interface BitMartCredential {
  accessKey: string;
  secretKey: string;
  memo: string;
}

export type EndpointAuth = 'NONE' | 'KEYED' | 'SIGNED';

export function sign(secretKey: string, signingPayload: string): string {
  return createHmac('sha256', secretKey).update(signingPayload).digest('hex');
}

export function buildSigningPayload(timestamp: string, memo: string, requestPayload: string): string {
  return `${timestamp}#${memo}#${requestPayload}`;
}

/** Deterministic query normalization for GET/DELETE (sorted keys, encoded). */
export function normalizeQuery(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, String(v)] as [string, string])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}

/** Deterministic JSON serialization for POST/PUT (stable key order). */
export function serializeBody(obj: Record<string, unknown>): string {
  return JSON.stringify(sortKeys(obj));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) out[k] = sortKeys((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

/**
 * API Broker attribution header. BitMart recognises an order as routed through a specific broker when
 * the request carries the user's API key together with the broker id
 * (developer-pro.bitmart.com/en/broker/, access process step 4).
 *
 * Deliberately NOT part of the signing payload. Both BitMart's own Java sample and the signature
 * examples in the API reference compute `X-BM-SIGN` from `timestamp#memo#queryString` only, so adding
 * this header cannot invalidate an otherwise-correct signature.
 */
export const BROKER_ID_HEADER = 'X-BM-BROKER-ID';

/** Present only when a broker id is configured. */
export interface BrokerHeader {
  'X-BM-BROKER-ID'?: string;
}

export interface SignedHeaders extends BrokerHeader {
  'X-BM-KEY': string;
  'X-BM-SIGN': string;
  'X-BM-TIMESTAMP': string;
}

/**
 * Attach the broker id, or leave it off entirely when none is configured.
 *
 * BitMart's sample sends `"X-BM-BROKER-ID", ""` because the value is a blank for the integrator to
 * fill in. An empty value attributes nothing, so transmitting it would add a header that carries no
 * information and make a misconfiguration look like a configuration. Omitting instead means an absent
 * broker id is visibly absent on the wire.
 */
function withBrokerId<T extends object>(headers: T, brokerId?: string): T & BrokerHeader {
  const id = brokerId?.trim();
  if (!id) return headers;
  return { ...headers, [BROKER_ID_HEADER]: id };
}

/**
 * Build signed headers for a SIGNED endpoint. `requestPayload` = exact query or body string.
 * `brokerId` is optional so that a caller with no broker relationship (or a test) is unaffected.
 */
export function buildSignedHeaders(
  cred: BitMartCredential,
  timestamp: string,
  requestPayload: string,
  brokerId?: string,
): SignedHeaders {
  const payload = buildSigningPayload(timestamp, cred.memo, requestPayload);
  return withBrokerId(
    {
      'X-BM-KEY': cred.accessKey,
      'X-BM-SIGN': sign(cred.secretKey, payload),
      'X-BM-TIMESTAMP': timestamp,
    },
    brokerId,
  );
}

/** KEYED endpoints only send the access key (no signature) — plus broker attribution when configured. */
export function buildKeyedHeaders(
  accessKey: string,
  brokerId?: string,
): { 'X-BM-KEY': string } & BrokerHeader {
  return withBrokerId({ 'X-BM-KEY': accessKey }, brokerId);
}

/** Detect clock drift between local time and the exchange server time (ms). */
export function timestampDriftMs(localNowMs: number, serverTimeMs: number): number {
  return localNowMs - serverTimeMs;
}

/** Whether drift is within an acceptable window (default ±5s) — else re-sync before signing. */
export function driftAcceptable(driftMs: number, toleranceMs = 5000): boolean {
  return Math.abs(driftMs) <= toleranceMs;
}
