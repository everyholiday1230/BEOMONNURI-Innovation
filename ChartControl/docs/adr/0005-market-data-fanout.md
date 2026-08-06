# ADR-0005 — Central market-data ingestion & fan-out; channel separation

Status: Accepted · Date: 2026-07-28

## Context
Per-browser BitMart connections would explode connection counts, breach rate limits, duplicate
data, and risk exposing credentials. Public and private data have different latency/security needs.

## Decision
All market data flows through: `BitMart → central ingestion → normalize → validate → sequence/gap
check → cache → internal pub/sub → SSE/WS fan-out → browser`. Subscriptions are deduplicated on
both client and server (one upstream sub per symbol/channel). Public market data and private
account data use **separate channels and caches**; market data is batched 50–100ms while
order/account events are never delayed. Phase 1 ships this as an in-memory single-node
implementation behind a pub/sub interface; a Redis-backed multi-node version is a later swap.

## Consequences
+ Fewer upstream connections, rate-limit protection, efficient fan-out, central reconnect handling.
− A stateful ingestion process is required (not an edge Worker); reflected in deployment plan.
