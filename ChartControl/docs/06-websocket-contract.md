# 06 — WebSocket / SSE Event Contract

Two **strictly separated** channels. Public market data and private account data never share a
channel or cache (security + backpressure isolation).

## Transport
- Browser ↔ BFF: **SSE** for market-data fan-out (simple, proxy-friendly, auto-reconnect) and AI
  streaming; optional WebSocket upgrade path documented for bidirectional needs.
- BFF ↔ BitMart: **WebSocket** (server side only), managed by the market-data ingestion module.

## Public market-data channel  `GET /api/stream/market` (SSE)
Query: `?symbols=BTCUSDT,ETHUSDT&channels=candle:15m,book:50,trade`
Server batches market-data messages every **50–100ms** (configurable). Envelope:
```jsonc
{ "seq": 12841, "type": "candle"|"book"|"trade"|"ticker"|"status",
  "symbol": "BTCUSDT", "ts": 1730000000000, "data": { ... } }
```
- `candle` data: `{ timeframe, open, high, low, close, volume, closed:boolean }`.
  Client rule: same `time` → replace; newer `time` → append; older `time` → ignore.
- `book` data: `{ sequence, bids:[[p,s]], asks:[[p,s]], isSnapshot }`.
  Client rule: apply incremental if `sequence == lastSeq+1`; on gap → request snapshot resync.
- `trade` data: `{ id, price, size, side, ts }`. Client dedups by `id`; bounded ring buffer.
- `status` data: connection state (see below). Sent immediately, **not** batched/delayed.

## Private account channel  `GET /api/stream/account` (SSE, auth required)
Order/fill/position/balance events. **Never batched or delayed.** Envelope:
```jsonc
{ "type": "order"|"fill"|"position"|"balance", "ts": ..., "data": { ... } }
```
Phase 1: emits simulated events from the mock order engine.

## Connection states (both channels surface these)
`CONNECTING → LIVE → DEGRADED → RECONNECTING → STALE → OFFLINE → FALLBACK → RATE_LIMITED`
- Reconnect: exponential backoff + jitter, capped; circuit breaker after N failures.
- After reconnect on market channel: REST **gap fill** for missed candles before resuming live.
- `STALE`: no message within staleness window → UI shows stale badge (non-color-only indicator).

## Subscription deduplication
Client-side: one logical subscription per (symbol,channel) shared across all widgets.
Server-side: one upstream BitMart subscription per (symbol,channel) fanned out to all clients.
