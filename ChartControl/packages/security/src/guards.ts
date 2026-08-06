/**
 * App-level security guards (Phase 6 §3), each a pure/testable function mapped to an OWASP risk.
 */

/** Open Redirect: only allow relative same-site paths (no scheme, no protocol-relative, no backslashes). */
export function isSafeRedirect(target: string): boolean {
  if (typeof target !== 'string' || target.length === 0) return false;
  if (!target.startsWith('/')) return false; // must be relative
  if (target.startsWith('//')) return false; // protocol-relative → external
  if (target.includes('\\')) return false; // backslash tricks
  if (/^\/[a-z][a-z0-9+.-]*:/i.test(target)) return false; // /javascript: etc.
  return true;
}

/** SSRF: outbound URL must be https and host must be in the allowlist (no internal/link-local). */
export function isAllowedOutboundUrl(url: string, allowHosts: string[]): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '169.254.169.254') return false; // metadata / loopback
  if (/^(10\.|127\.|192\.168\.|169\.254\.|::1|fd)/.test(host)) return false; // private ranges
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  return allowHosts.includes(host);
}

/** Host header injection: the request Host must match an expected allowlist. */
export function isAllowedHost(hostHeader: string | undefined, allowHosts: string[]): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.split(':')[0]!.toLowerCase();
  return allowHosts.map((h) => h.toLowerCase()).includes(host);
}

/** CORS: exact-origin allowlist (never reflect arbitrary Origin, never '*' with credentials). */
export function corsOriginAllowed(origin: string | undefined, allowlist: string[]): boolean {
  return !!origin && allowlist.includes(origin);
}

/** Prototype Pollution: strip dangerous keys from parsed JSON before use. */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export function sanitizePrototype<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => sanitizePrototype(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (DANGEROUS_KEYS.has(k)) continue;
      out[k] = sanitizePrototype(v);
    }
    return out as unknown as T;
  }
  return value;
}

/** Mass Assignment: keep only allowlisted fields from an input object. */
export function pickAllowed<T extends Record<string, unknown>>(input: T, allowed: readonly string[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of allowed) if (Object.prototype.hasOwnProperty.call(input, k)) out[k as keyof T] = input[k as keyof T];
  return out;
}

/** WebSocket auth+origin: connection requires a valid session and an allowlisted Origin. */
export function wsConnectionAllowed(params: { origin: string | undefined; hasValidSession: boolean; allowlist: string[] }): { allowed: boolean; reason?: string } {
  if (!corsOriginAllowed(params.origin, params.allowlist)) return { allowed: false, reason: 'origin not allowed' };
  if (!params.hasValidSession) return { allowed: false, reason: 'unauthenticated' };
  return { allowed: true };
}

/** Duplicate-order defense: reject a client order id seen within the idempotency window. */
export class IdempotencyGuard {
  private seen = new Map<string, number>();
  constructor(private readonly ttlMs = 60_000, private readonly now: () => number = Date.now) {}
  checkAndRecord(clientOrderId: string): boolean {
    const t = this.now();
    for (const [k, exp] of this.seen) if (exp <= t) this.seen.delete(k);
    if (this.seen.has(clientOrderId)) return false; // duplicate
    this.seen.set(clientOrderId, t + this.ttlMs);
    return true;
  }
}
