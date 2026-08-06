# PHASE 5-16 — Admin Bundle Analysis

Measured from `apps/admin/dist` (vite 5 production build; `pnpm --filter @quantumtrade/admin build`).
Real numbers — no estimates.

## Initial JS (entry `index-*.js`)
- raw: **156,884 bytes** (156.9 kB)
- gzip: **~51.0 kB** (measured `gzip -c` = 51,027 bytes)
- CSS `index-*.css`: 1.02 kB raw / 0.55 kB gzip
- 45 modules transformed

Largest dependency: React + React-DOM (18.3.1) dominate the initial chunk; the app has no heavy chart/
data libs (klinecharts etc. are NOT in the admin bundle).

## Route chunks (code-split via React.lazy — loaded on demand, not in initial JS)
| Chunk | raw | gzip |
|---|---|---|
| Users | 3.18 kB | 1.37 kB |
| Incidents | 2.49 kB | 1.13 kB |
| KillSwitches | 1.82 kB | 0.92 kB |
| ReleaseGates | 1.68 kB | 0.82 kB |
| Audit | 1.66 kB | 0.84 kB |
| FeatureFlags | 1.46 kB | 0.72 kB |
| Overview | 1.39 kB | 0.72 kB |
| OrdersPositions | 1.32 kB | 0.57 kB |
| AiOps | 0.84 kB | 0.49 kB |
| Exchange | 0.77 kB | 0.48 kB |

> Closure delta (2026-07-29): the initial entry chunk is **unchanged** at 156.89 kB raw / 51.31 kB gz
> after the closure additions — the incident transition control (Incidents 1.96→2.49 kB) and audit
> action filter (Audit 1.28→1.66 kB) only grew their own lazily-loaded route chunks.

## Isolation from the user /trade bundle
`grep -rliE "admin-domain|/api/admin|createAdminRouter|KillSwitch|ReleaseGate" apps/web/dist` → **0
matches**. The admin app is a separate Vite app/entry; none of its code (or the admin domain/API
client) is included in the `/trade` (apps/web) initial bundle.

## Behaviors verified
- **Route lazy loading**: confirmed — each screen emits a separate on-demand chunk (list above).
- **Search debounce**: users search is submit-driven (no per-keystroke request storm).
- **Pagination**: admin list APIs are bounded (limit ≤ 200) and the UI requests a bounded page.

## Not measured (recorded honestly — not marked Passed)
- 1,000-row table virtualization throughput and full-dashboard re-render profiling under load were NOT
  measured in this pass (no large seeded dataset / profiler run) — BETA follow-up. Current tables use
  bounded pagination rather than virtualization.
- API request de-duplication across concurrent widgets is not instrumented/measured.
