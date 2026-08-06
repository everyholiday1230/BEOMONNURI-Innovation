# 05 — API Contract (BFF)

Base: `${VITE_API_BASE_URL}` (default `http://127.0.0.1:8787`). All responses JSON.
Every response validated client-side with Zod (`@quantumtrade/schemas`). Errors use a uniform
envelope. Times are ISO-8601 UTC. Public market-data routes require no auth in Phase 1;
account/order routes are simulation-only and (in a real deployment) require an authenticated
session cookie.

## Error envelope
```jsonc
{ "error": { "code": "RATE_LIMITED", "message": "…", "correlationId": "…", "retryAfterMs": 1200 } }
```
`code` ∈ `BAD_REQUEST | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | RATE_LIMITED | UPSTREAM_TIMEOUT | UPSTREAM_ERROR | VALIDATION_FAILED | INTERNAL`.

## Health / readiness
- `GET /health` → `{ "status": "ok", "uptimeMs": n }` (liveness)
- `GET /ready` → `{ "status": "ok"|"degraded", "dataMode": "...", "tradingMode": "...", "checks": {...} }`

## Config
- `GET /api/config` → `{ dataMode, tradingMode, liveOrdersEnabled:false, defaultSymbol, timeframes:[...] }`

## Market data (public)
- `GET /api/market/symbols` → `Symbol[]` (id, base, quote, pricePrecision, quantityPrecision, tickSize, stepSize, minQty, contractType)
- `GET /api/market/candles?symbol=BTCUSDT&timeframe=15m&limit=500&before=<ms>` → `{ symbol, timeframe, candles: Candle[], source: "bitmart_public"|"mock_replay" }`
  - server-side: cached by (symbol,tf,range), request coalescing, latest-request-wins, stale fallback.
- `GET /api/market/orderbook?symbol=BTCUSDT&depth=50` → `{ symbol, sequence, bids:[[price,size]], asks:[[price,size]], asOf }`
- `GET /api/market/trades?symbol=BTCUSDT&limit=50` → `{ symbol, trades: Trade[] }`
- `GET /api/market/ticker?symbol=BTCUSDT` → `{ symbol, last, changePct, markPrice, indexPrice, fundingRate, nextFundingAt, high24h, low24h, vol24h }`

## AI (orchestrator boundary)
- `POST /api/ai/analyze` (SSE) — body `{ conversationId?, symbol, marketType, timeframe, prompt, dataAsOf }`
  - streams `event: token`, `event: command` (validated ChartCommand), `event: signal` (validated SignalObject), `event: done`, `event: error`.
  - server enforces: per-user rate limit, max concurrent, timeout, abort on disconnect, token budget, schema validation, permission check. **AI output can never include an order submission.**
- `POST /api/ai/abort` → `{ ok: true }` (cancel in-flight request by id)

## Trading (simulation only in Phase 1)
- `POST /api/sim/order-drafts` — body `OrderDraft` → validated, risk-checked → `{ draftId, preview: OrderPreview }`
  - `preview` includes positionValue, estFee, estLiquidationPrice, riskReward, maxEstLoss, aiGenerated, isSimulated:true.
- `POST /api/sim/orders/confirm` — body `{ draftId, clientOrderId, confirmationToken }` → `{ order: Order }`
  - **requires** a `confirmationToken` issued only after explicit user final-confirm; without it → `FORBIDDEN`.
  - idempotent by `clientOrderId`; duplicate returns the existing order (no double submit).
- `GET /api/sim/orders` / `GET /api/sim/positions` / `GET /api/sim/balances` → simulated state.

## Layout (server-sync interface; localStorage is the Phase 1 store)
- `GET /api/layouts` / `PUT /api/layouts/:id` (body carries `version` for optimistic concurrency; mismatch → `409`).
