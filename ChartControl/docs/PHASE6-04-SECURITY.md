# PHASE 6-04 — Security Hardening

Package: `@quantumtrade/security` (9 tests) + existing `admin-api` OWASP scenarios (14) via
`pnpm test:security` (23 total). Plus dependency audit.

## App-level controls implemented + verified
| OWASP / risk | Control | Test |
|---|---|---|
| XSS / CSP, Clickjacking | `securityHeaders()` — strict CSP incl. `frame-ancestors 'none'`, X-Frame-Options DENY | headers test |
| HSTS | `Strict-Transport-Security` (prod) | headers test |
| MIME sniffing | `X-Content-Type-Options: nosniff` | headers test |
| Referrer / Permissions-Policy | strict-origin + locked features | headers test |
| Cache leakage | `Cache-Control: no-store` on sensitive responses | headers test |
| Open Redirect | `isSafeRedirect` (relative same-site only) | 6 cases |
| SSRF | `isAllowedOutboundUrl` (https + host allowlist, blocks metadata/private) | 5 cases |
| Host Header Injection | `isAllowedHost` allowlist | test |
| CORS | exact-origin allowlist (no reflect/`*`+creds) | test |
| Prototype Pollution | `sanitizePrototype` strips `__proto__/constructor/prototype` | test |
| Mass Assignment | `pickAllowed` field allowlist | test |
| WebSocket auth+origin | `wsConnectionAllowed` (valid session AND allowlisted origin) | test |
| Duplicate Order | `IdempotencyGuard` (client-order-id window) | test |
| IDOR/BOLA, Broken RBAC, CSRF, SQLi, session, secret exposure, fake-gate, audit-immutability | admin-api suite (Phase 5) | 14 tests |
| Log Injection | `sanitizeLogText` (observability) | PHASE6-05 |
| CSV Injection | `csvSafe` (admin-domain) | Phase 5 |
| Prompt Injection / AI tool priv-esc | Phase 4 AI safety (delimited input, read-only tools, loop guard) | Phase 4 |

## Security headers (to be mounted by the API adapter)
`Content-Security-Policy` (default-src 'self'; frame-ancestors 'none'; connect-src 'self' + WS gateway),
`Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`,
`X-Frame-Options: DENY`, `Cross-Origin-Opener/Resource-Policy`, safe `Cache-Control`.

## Dependency & scanning
- `pnpm audit` (`npm audit` needs a package-lock, absent in this pnpm workspace → ENOLOCK): **59 findings
  (3 low / 42 moderate / 12 high / 2 critical)**, predominantly transitive **dev-tooling** deps
  (eslint → minimatch → brace-expansion, GHSA-mh99-v99m-4gvg). Remediation (bump/override) tracked as a
  follow-up; runtime-only re-audit recommended. Log: `artifacts/logs/phase6-dep-audit.log`.
- Container SBOM (CycloneDX+SPDX) + container vulnerability scan (trivy 0.72.0): **Executed** →
  0 Critical / 0 High (PHASE6-20). SAST (semgrep), secret scan (gitleaks), OSV (osv-scanner):
  **binaries ABSENT → Not Executed** (recorded, not simulated).

## Not Executed
Request-smuggling edge (needs a real reverse-proxy chain), multinode session-theft across hosts, and the
SAST/secret/OSV scanners above → **Not Executed / Production Release Gate**.
