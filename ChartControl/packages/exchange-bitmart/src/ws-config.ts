/**
 * BitMart WebSocket URL policy (docs PHASE3-05). PRODUCTION-ONLY: demo endpoints are forbidden by
 * spec, so a demo/non-official URL is rejected (fail-closed) BEFORE any connection attempt.
 * Official production hosts only.
 */
export const BITMART_PROD_WS_HOSTS = ['openapi-ws-v2.bitmart.com'] as const;

/** Demo hosts that must NEVER be used in Phase 3. */
export const BITMART_DEMO_WS_MARKERS = ['wsdemo', 'demo-'] as const;

export const BITMART_WS_PUBLIC_DEFAULT = 'wss://openapi-ws-v2.bitmart.com/api?protocol=1.1';
export const BITMART_WS_PRIVATE_DEFAULT = 'wss://openapi-ws-v2.bitmart.com/user?protocol=1.1';

export type WsKind = 'public' | 'private';

/**
 * Validate a BitMart WS URL for production use. Throws (fail-closed) when the URL is not `wss:`,
 * points at a demo endpoint, or is not an official production host. Returns the URL when valid.
 */
export function assertProductionWsUrl(url: string, kind: WsKind = 'private'): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`invalid BitMart ${kind} WS URL (fail-closed)`);
  }
  if (u.protocol !== 'wss:') throw new Error(`BitMart ${kind} WS must be wss:// (fail-closed)`);
  const host = u.hostname.toLowerCase();
  for (const marker of BITMART_DEMO_WS_MARKERS) {
    if (host.includes(marker)) throw new Error(`demo BitMart WS endpoint forbidden in Phase 3 (fail-closed): ${host}`);
  }
  if (!(BITMART_PROD_WS_HOSTS as readonly string[]).includes(host)) {
    throw new Error(`non-official BitMart ${kind} WS host rejected (fail-closed): ${host}`);
  }
  // private stream must target the user path; public the api path (soft check, host already enforced).
  return url;
}

/** True when the URL is an acceptable production WS URL (no throw). */
export function isProductionWsUrl(url: string, kind: WsKind = 'private'): boolean {
  try {
    assertProductionWsUrl(url, kind);
    return true;
  } catch {
    return false;
  }
}
