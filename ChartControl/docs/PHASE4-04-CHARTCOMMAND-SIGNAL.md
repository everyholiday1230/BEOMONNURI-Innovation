# PHASE 4 — ChartCommand & SignalObject

## AiChartCommand (schemaVersion 2)
Allowlisted commands: createTrendLine, createHorizontalLevel, createSupportResistance, createEntryZone,
createStopLoss, createTakeProfit, createLongMarker, createShortMarker, createInvalidationLevel,
updateOverlay, hideOverlay, deleteOverlay, createSignalProposal, createOrderDraftProposal.
Common required fields: schemaVersion, commandId, conversationId, userId, symbol, marketType,
timeframe, createdAt, expiresAt, source, confidence, reasoningSummary (summary only), dataSnapshotId,
aiGenerated. Per-command args validated by strict schemas (`validateChartCommandArgs`).

`validateProposedChartCommand()` enforces: schema, ownership (userId match), expiry, per-command args,
and symbol/timeframe match. A mismatch is **not auto-applied** — the user is asked to confirm.
`createOrderDraftProposal` yields a DRAFT proposal only; it can never submit an order.

## AiSignalObject (schemaVersion 2)
Fields: signalId, schemaVersion, symbol, marketType, timeframe, direction, entryZone, stopLoss,
takeProfits, invalidationLevel, confidence, riskReward, thesis, supportingEvidence,
contradictingEvidence, assumptions, dataTimestamp, expiresAt, aiGenerated, model, promptVersion,
dataSnapshotId, userEdited, status. Refinement: entryZone must be [lo,hi] with lo≤hi.

## State machine
`DRAFT → PROPOSED → USER_REVIEW → (APPROVED | EDITED | REJECTED | EXPIRED)`, `EDITED → USER_REVIEW`,
`APPROVED → ORDER_DRAFT_CREATED`. Creating an order DRAFT is terminal for the signal; **signal approval
and order submission stay separate** (submission remains the Phase 3 human-confirmation gate).
