# ADR-0002 — Adapter interfaces isolate exchange & chart vendors

Status: Accepted · Date: 2026-07-28

## Context
BitMart's public API shapes and any future official BitMart Chart SDK / commercial license may
change. KLineChart must not be coupled to business logic. The prototype used a Canvas mock and
CDN scripts — unacceptable for production.

## Decision
Define narrow interfaces and program against them:
`IMarketDataProvider`, `IExchangeTradingAdapter`, `IOrderBookAdapter`, `IAccountDataAdapter`,
`IChartRenderer`. Concrete implementations: `BitMartPublicMarketDataProvider`, `MockReplayProvider`,
`KLineChartAdapter`. KLineChart is an **npm dependency, pinned**, used only behind
`KLineChartAdapter` (`setSymbol/setPeriod/setDataLoader/getBars/subscribeBar/unsubscribeBar`).
BitMart endpoint bases + rate limits are configuration, not hardcoded.

## Consequences
+ Vendor swap = new adapter, no caller changes. Testable with mocks.
+ Rate-limit/normalization logic centralized.
− Slight indirection overhead; justified by swappability + safety.
