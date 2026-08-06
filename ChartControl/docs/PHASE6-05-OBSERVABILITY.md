# PHASE 6-05 — Observability

Package: `@quantumtrade/observability` (10 tests, `pnpm test:observability`).

## Structured logging
`StructuredLogger` emits JSON with the required common fields: `timestamp, level, message, service,
environment, version, gitSha, correlationId, traceId, spanId, userIdHash, route, durationMs, status,
errorCode`. Guarantees:
- `userId` is **hashed** (`userIdHash`, SHA-256/16) — raw id never emitted.
- Sensitive keys (password/secret/token/authorization/apiKey/openai/kms/cookie…) → `[REDACTED]` (recursive).
- Log-injection defense: CRLF/control chars neutralized (`sanitizeLogText`).
- `child()` pins per-request fields (correlationId/traceId).

## Tracing (OpenTelemetry-shaped adapter)
`Tracer` interface with W3C-style 16-byte trace / 8-byte span ids. `NoopTracer` (prod default until a
collector is configured) and `InMemoryTracer` (tests/offline export). Provider dependency isolated behind
the adapter — swap in an OTel exporter without touching call sites.

## Metrics
`MetricsRegistry` with counters, gauges, and histograms (p50/p95/p99) + Prometheus text exposition.
Covers the required series: HTTP RPS, latency percentiles, error rate, active sessions/WS,
connect/disconnect/reconnect, messages/sec, dropped messages, queue depth, cache hit rate, BitMart
REST/WS status, AI requests/tokens/cost, PG pool, Redis status, reconciliation, SUBMIT_UNKNOWN,
INCONSISTENT, kill-switch state, MFA failures, admin high-risk actions (as named metrics to be recorded
at call sites).

## Not Executed
Live OTel collector / Prometheus scrape / Grafana dashboards → **Not Executed** (no collector wired). The
in-process registry + exposition format are verified; export to a backend is a deployment step.
