/**
 * Security response headers (Phase 6 §3). Pure builder → header map, applied by a thin framework
 * adapter. Covers CSP (incl. frame-ancestors for clickjacking), HSTS, X-Content-Type-Options,
 * Referrer-Policy, Permissions-Policy, X-Frame-Options, and safe Cache-Control for sensitive routes.
 */
export interface SecurityHeaderOptions {
  /** Extra CSP connect-src origins (e.g. the WS gateway) beyond 'self'. */
  connectSrc?: string[];
  /** Enable HSTS (only meaningful over HTTPS/production). */
  hsts?: boolean;
  /** Mark the response as sensitive → no-store (prevents cache leakage of PII/secrets). */
  sensitive?: boolean;
}

export function buildContentSecurityPolicy(connectSrc: string[] = []): string {
  const connect = ["'self'", ...connectSrc].join(' ');
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'", // clickjacking defense
    "form-action 'self'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self'",
    `connect-src ${connect}`,
    "font-src 'self'",
    "worker-src 'self' blob:",
    'upgrade-insecure-requests',
  ].join('; ');
}

export function securityHeaders(opts: SecurityHeaderOptions = {}): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Security-Policy': buildContentSecurityPolicy(opts.connectSrc),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Permitted-Cross-Domain-Policies': 'none',
  };
  if (opts.hsts) h['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains; preload';
  if (opts.sensitive) h['Cache-Control'] = 'no-store, no-cache, must-revalidate, private';
  return h;
}
