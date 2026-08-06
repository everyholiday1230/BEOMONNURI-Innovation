# 02 — Functional Requirement Matrix

IDs are referenced by tests and the final status matrix (`docs/README`/final report).
Status uses the legend from `00-architecture.md`.

## A. Desktop main trading
| ID | Requirement | Phase 1 status |
|---|---|---|
| FR-A1 | /trade route with widget grid shell | 🟡 |
| FR-A2 | Symbol header (price, change, mark/index/funding) | 🟡 (mock/public) |
| FR-A3 | Persistent SIMULATION stripe + data-mode indicator | 🟡 |
| FR-A4 | Connection state cluster (8 states) | 🟡 |

## B. AI workspace
| ID | Requirement | Status |
|---|---|---|
| FR-B1 | /trade/ai route, copilot panel | 🟡 |
| FR-B2 | SSE streaming from BFF mock AI provider | 🟡 |
| FR-B3 | Allowlisted ChartCommand generation + Zod validation | ✅ |
| FR-B4 | SignalObject proposal card + user edit | 🟡 |
| FR-B5 | AI failure boundary (chart/trade keep working) | 🟡 |

## C. Layout edit mode
| ID | Requirement | Status |
|---|---|---|
| FR-C1 | /trade/layout drag/resize/hide/restore/lock/duplicate | 🟡 |
| FR-C2 | 24-col collision + snap + min/max | ✅ (engine unit-tested) |
| FR-C3 | Undo/redo, save/load (localStorage), reset | 🟡 |
| FR-C4 | 7 presets + import/export JSON | 🟡 |
| FR-C5 | Versioned schema + migration + corrupted-data recovery | ✅ (migration tested) |
| FR-C6 | Optimistic concurrency version + server-sync interface | 🔌 |

## D. Design system
| ID | Requirement | Status |
|---|---|---|
| FR-D1 | 3-layer tokens (brand/semantic/component) | ✅ |
| FR-D2 | Theme/density/brand/longshort switch | 🟡 |
| FR-D3 | /design-system gallery + all component states | 🟡 |

## E. Widget system
| ID | Requirement | Status |
|---|---|---|
| FR-E1 | Common Widget Contract (all required props) | ✅ (schema) |
| FR-E2 | Per-widget error boundary | 🟡 |
| FR-E3 | loading/empty/error/reconnecting/stale states | 🟡 |
| FR-E4 | 18 widget types registered | 🟡 (subset live, rest placeholder) |

## F. KLineChart integration
| ID | Requirement | Status |
|---|---|---|
| FR-F1 | KLineChart via adapter (pinned npm) | 🔌/🟡 |
| FR-F2 | setSymbol/setPeriod/setDataLoader/subscribeBar/unsubscribeBar | 🟡 |
| FR-F3 | subscription+listener cleanup on symbol/tf change | 🟡 |
| FR-F4 | indicators MA/EMA/BOLL/MACD/RSI/Volume | 🔌 (adapter exposes) |

## G. BitMart public market data
| ID | Requirement | Status |
|---|---|---|
| FR-G1 | REST historical candles + normalization | 🌐/🟡 |
| FR-G2 | candle dedup / out-of-order / OHLC validation | ✅ |
| FR-G3 | WS realtime candle (append/replace/ignore rules) | 🟡 |
| FR-G4 | order book snapshot+incremental, sequence/gap resync | ✅ (logic tested) |
| FR-G5 | recent trades dedup + bounded buffer | ✅ |
| FR-G6 | rate limit token-bucket + backoff config | 🟡 |

## H. Mock/simulation account & order flow
| ID | Requirement | Status |
|---|---|---|
| FR-H1 | Order state machine (12 states) | ✅ |
| FR-H2 | Decimal order math (value/fee/liq/RR/max-loss) | ✅ |
| FR-H3 | Order types market/limit/stop/TP-SL, long/short, reduce-only | ✅ (draft validation) |
| FR-H4 | symbol precision/tick/step/min validation | ✅ |
| FR-H5 | Simulated fill lifecycle | 🧪 |

## I. Auth & DB foundation
| ID | Requirement | Status |
|---|---|---|
| FR-I1 | Auth/session interface + secure cookie policy | 🔌/📄 |
| FR-I2 | DB schema proposal (26 domains) | 📄 |

## J. Reliability states
| ID | Requirement | Status |
|---|---|---|
| FR-J1 | reconnect w/ backoff+jitter | 🟡 |
| FR-J2 | stale detection, offline, tab-resume | 🟡 |

## K. Automated tests
| ID | Requirement | Status |
|---|---|---|
| FR-K1 | unit + schema + domain + normalization tests | ✅ |
| FR-K2 | E2E flows A–E (Playwright) | 📄 (scripts, not executed) |
| FR-K3 | load profiles (k6) | 📄 (scripts, not executed) |

## L. Deployment
| ID | Requirement | Status |
|---|---|---|
| FR-L1 | local dev (pnpm) | 🟡 |
| FR-L2 | preview/build | 🟡 |
| FR-L3 | Cloudflare/AWS split | 📄 |
