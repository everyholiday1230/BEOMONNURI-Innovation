# 07 — Core Schemas (ChartCommand, SignalObject, Widget, Layout)

Canonical definitions live in `packages/schemas` (Zod). This doc is the human-readable contract.
Every schema carries a `schemaVersion` for migration. External/API/AI payloads are validated at
runtime; invalid payloads are rejected (never trusted).

## Widget contract (`WidgetSchema`)
Required: `id, type, title, visible, locked, x, y, width, height, minWidth, minHeight,
maxWidth, maxHeight, settings, permissions, dataDependencies, schemaVersion`.
`type` ∈ 18 registered widget types (symbolHeader, marketWatch, chart, secondaryChart,
multiChart, orderBook, recentTrades, orderEntry, positions, openOrders, orderHistory, assets,
aiCopilot, signalProposal, alerts, news, riskMonitor, connectionStatus).
Grid units: x/width in columns (0..24), y/height in 40px rows.

## Layout (`LayoutSchema`)
`{ schemaVersion, id, name, presetId?, cols:24, version:int, widgets: Widget[] }`.
`version` = optimistic-concurrency token. Migration functions map older `schemaVersion` → current;
corrupted/unparseable data → recover to preset default (never crash trading).

## ChartCommand (`ChartCommandSchema`) — AI is allowlisted to THESE ONLY
Discriminated union on `command`:
`createTrendLine, createHorizontalLine, createEntryZone, createStopLoss, createTakeProfit,
createMarker, updateOverlay, removeOverlay, lockOverlay, hideOverlay, approveSignal,
rejectSignal, createOrderDraft`.
- The LLM cannot emit arbitrary JS/HTML/Canvas. Anything not in this union fails validation.
- `createOrderDraft` produces a **draft only**; it does not and cannot submit an order.
- Each command carries typed, bounded params (prices are numeric strings for Decimal safety).

## SignalObject (`SignalObjectSchema`)
```
{ schemaVersion, id, symbol, marketType, timeframe, direction: 'long'|'short',
  generatedAt, dataAsOf, analysis, evidence[], confidence(0..100),
  invalidationCondition, entryZone:[Decimal,Decimal], stopLoss:Decimal,
  takeProfits:Decimal[], riskReward:Decimal, assumptions[], warnings[],
  aiGenerated:true, status: SignalState }
```
Prices carried as numeric strings and computed with `Decimal`. `status` follows the signal state
machine (see `08-order-state-machine.md`).

## OrderDraft / Order (`OrderDraftSchema`, `OrderSchema`)
Draft: `{ symbol, marketType, side, positionAction, orderType, price?, quantity, leverage,
marginMode, reduceOnly, stopLoss?, takeProfit?, clientOrderId, aiGenerated, isSimulated:true }`.
Validated against symbol `market_metadata` (pricePrecision, quantityPrecision, tickSize, stepSize,
minQty). Order adds `id, status, createdAt, events[]`.
