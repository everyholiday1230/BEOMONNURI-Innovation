import { describe, it, expect } from 'vitest';
import {
  securityHeaders, buildContentSecurityPolicy,
  isSafeRedirect, isAllowedOutboundUrl, isAllowedHost, corsOriginAllowed,
  sanitizePrototype, pickAllowed, wsConnectionAllowed, IdempotencyGuard,
} from '../index';

describe('security headers (OWASP: XSS/CSP, clickjacking, cache leakage)', () => {
  it('emits the required headers with a strict CSP', () => {
    const h = securityHeaders({ hsts: true, sensitive: true, connectSrc: ['wss://gw.example'] });
    expect(h['Content-Security-Policy']).toContain("default-src 'self'");
    expect(h['Content-Security-Policy']).toContain("frame-ancestors 'none'"); // clickjacking
    expect(h['Content-Security-Policy']).toContain('connect-src '); // ws gateway
    expect(h['Strict-Transport-Security']).toContain('max-age=');
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Permissions-Policy']).toContain('camera=()');
    expect(h['X-Frame-Options']).toBe('DENY');
    expect(h['Cache-Control']).toContain('no-store'); // sensitive → no cache leakage
  });
  it('omits HSTS when not requested', () => {
    expect(securityHeaders()['Strict-Transport-Security']).toBeUndefined();
    expect(buildContentSecurityPolicy(['wss://x'])).toContain('wss://x');
  });
});

describe('open redirect', () => {
  it('allows relative same-site paths only', () => {
    expect(isSafeRedirect('/dashboard')).toBe(true);
    expect(isSafeRedirect('//evil.com')).toBe(false);
    expect(isSafeRedirect('https://evil.com')).toBe(false);
    expect(isSafeRedirect('/\\evil.com')).toBe(false);
    expect(isSafeRedirect('/javascript:alert(1)')).toBe(false);
    expect(isSafeRedirect('')).toBe(false);
  });
});

describe('SSRF outbound allowlist', () => {
  it('permits only https allowlisted public hosts', () => {
    const allow = ['api-cloud-v2.bitmart.com', 'api.openai.com'];
    expect(isAllowedOutboundUrl('https://api-cloud-v2.bitmart.com/x', allow)).toBe(true);
    expect(isAllowedOutboundUrl('http://api-cloud-v2.bitmart.com/x', allow)).toBe(false); // not https
    expect(isAllowedOutboundUrl('https://169.254.169.254/latest/meta-data', allow)).toBe(false); // metadata
    expect(isAllowedOutboundUrl('https://10.0.0.5/x', allow)).toBe(false); // private
    expect(isAllowedOutboundUrl('https://evil.com/x', allow)).toBe(false); // not allowlisted
  });
});

describe('host header + CORS', () => {
  it('validates host header and cors origin exactly', () => {
    expect(isAllowedHost('app.qt.local:443', ['app.qt.local'])).toBe(true);
    expect(isAllowedHost('evil.com', ['app.qt.local'])).toBe(false);
    expect(isAllowedHost(undefined, ['app.qt.local'])).toBe(false);
    expect(corsOriginAllowed('https://app.qt.local', ['https://app.qt.local'])).toBe(true);
    expect(corsOriginAllowed('https://evil.com', ['https://app.qt.local'])).toBe(false);
  });
});

describe('prototype pollution + mass assignment', () => {
  it('strips dangerous keys', () => {
    const dirty = JSON.parse('{"a":1,"__proto__":{"admin":true},"nested":{"constructor":{"x":1},"ok":2}}');
    const clean = sanitizePrototype(dirty) as Record<string, any>;
    expect(clean.a).toBe(1);
    expect(clean.__proto__ === Object.prototype || clean.__proto__ === undefined).toBe(true);
    expect(clean.nested.constructor).toBe(Object); // dangerous key not copied as own prop
    expect(clean.nested.ok).toBe(2);
    expect(({} as any).admin).toBeUndefined(); // global proto not polluted
  });
  it('keeps only allowlisted fields', () => {
    const input = { email: 'a@b.c', role: 'SUPER_ADMIN', isAdmin: true } as Record<string, unknown>;
    expect(pickAllowed(input, ['email'])).toEqual({ email: 'a@b.c' });
  });
});

describe('websocket auth+origin + duplicate order', () => {
  it('requires allowlisted origin AND a valid session', () => {
    const allowlist = ['https://app.qt.local'];
    expect(wsConnectionAllowed({ origin: 'https://app.qt.local', hasValidSession: true, allowlist }).allowed).toBe(true);
    expect(wsConnectionAllowed({ origin: 'https://evil.com', hasValidSession: true, allowlist }).reason).toMatch(/origin/);
    expect(wsConnectionAllowed({ origin: 'https://app.qt.local', hasValidSession: false, allowlist }).reason).toMatch(/unauth/);
  });
  it('rejects duplicate client order ids within the window', () => {
    let now = 0;
    const g = new IdempotencyGuard(1000, () => now);
    expect(g.checkAndRecord('order-1')).toBe(true);
    expect(g.checkAndRecord('order-1')).toBe(false); // duplicate
    now = 2000;
    expect(g.checkAndRecord('order-1')).toBe(true); // window expired
  });
});
