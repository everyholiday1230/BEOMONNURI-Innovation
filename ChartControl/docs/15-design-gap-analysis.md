# 15 — Design v1.0 vs Implementation: Screen-by-Screen Gap Analysis

Source of truth: `BeomOnNuri_Hompage/design_handoff_quantumtrade_ai/` (README.md,
design-system.html, developer-handoff.html, `src/*`). This document compares each screen/region
against the current implementation, lists missing components / states / flows / design tokens, and
records what was **fixed now** vs **documented for future** (Phase 1 scope).

Legend: ✅ matched · 🔧 gap fixed in this pass · 📝 documented (out of Phase-1 scope) · ⚠ partial.

## Design "Critical Contracts (Do Not Violate)" — compliance

| # | Contract | Status | Evidence |
|---|---|---|---|
| C1 | Simulation stripe always visible | ✅ | `SimulationStripe` in `.app-shell` (all non-auth routes) |
| C2 | Approve Signal ≠ Submit Order (risk + final confirm gate) | ✅ | `OrderPreviewConfirm` gate; server 403 without `userConfirmed`; e2e flow-c |
| C3 | Directional glyph + color (no color-only) | 🔧 | SymbolHeader had ▲/▼; **added ▲/▼ to Recent Trades**; `.dir-*` tokens exist |
| C4 | Tabular numerals on all numbers | ✅ | `font-variant-numeric: tabular-nums` global in base.css + `.tnum` |
| C5 | AI vs User overlay distinction (dashed + AI badge) | 📝 | KLineChart overlay layer not yet rendering AI overlays (see Chart gaps) |
| C6 | Invalidation Banner always shown in Signal Card | 🔧 | **AICopilotWidget now renders `.invalidation-banner`**; e2e flow-b asserts it |
| C7 | Focus-visible ring on all interactive elements | ✅ | base.css `:focus-visible` for button/a/input/select/[tabindex] |
| C8 | Reduced-motion neutralizes all motion | 🔧 | tokens.css zeroed duration vars; **added global `*` animation/transition guard** in base.css |

## Screen-by-screen

### 1. Simulation Stripe — ✅
Diagonal warning hatch, SIMULATION pill, mono uppercase copy. Implemented in `app.css .sim-stripe`
verbatim from spec (repeating-linear-gradient -45deg, warning token). Right cluster (session id /
seed) is 📝 (static copy only).

### 2. App Header — ⚠
- ✅ Brand mark (Q gradient), name, v1.0 chip, primary nav tabs (border-bottom active), theme
  toggle, language toggle, data-mode + connection cluster (dot states live/warn/err/offline).
- ⚠ Connection cluster shows mode + state; **latency (`↔ 34ms`) and freshness (`◷ 0s`) segments
  are not rendered** → 📝 (needs the fan-out latency signal; not in Phase-1 BFF).
- 📝 Market-type segmented control (현물/선물/모의), Deposit button, avatar monogram, bell/alerts.

### 3. Symbol Header (v2) — ✅ (core) / ⚠
- ✅ Identity (symbol, PERP chip, USDT-Margined line), price (24px tabular, colored), change with
  ▲/▼, Mark / Index / Funding / 24H Vol meta cells (live from ticker).
- ⚠ Funding cell is always `t-long` colored regardless of sign → 📝 minor (should follow sign).
- 📝 Group-4 action icons (bell/share/more), leverage badge, star-favorite, 24H high/low cells.

### 4. Trade Body (24-col grid) — ✅
`repeat(24,1fr)`, 40px rows, 6px gap, editing grid overlay. Matches spec.

### 5. Widgets (17 types)
| Widget | Status |
|---|---|
| Market Watch | ⚠ symbol list + PERP; no search/tabs/24h-change row → 📝 |
| Main Chart | ⚠ KLineChart via adapter (candles+VOL, TF/symbol/theme); toolbar/drawtools/overlays 📝 |
| Order Book | ✅ price/size, ask/bid color, sequence; depth-bar/precision/click-prefill 📝 |
| Recent Trades | 🔧 now ▲/▼ + color + size |
| Order Entry | ⚠ side/type/price/qty/leverage + preview; slider/TIF/post-only/reduce-only 📝 |
| Positions/Open/History | 📝 placeholders (no simulated positions until fills persisted) |
| Assets · Risk | ⚠ balances/PnL/margin ratio values (mock); margin-ratio bar/add-margin 📝 |
| AI Copilot | ✅ streaming, allowlisted commands, signal card, approve→draft→preview gate, 🔧 invalidation banner |
| Signal Proposal / Alerts / News / Multi-Chart / Connection / Symbol widgets | 📝 placeholders |

### 6. Layout Edit Mode — ✅ (core) / ⚠
- ✅ 7 presets (geometry verbatim from `mock-data.js LAYOUT_PRESETS`), preset switch, save/load
  (localStorage), undo/redo, reset, lock, hide/restore, unsaved-change guard, import/export JSON,
  schema-versioned layout + migration + corrupted-data recovery (domain pkg, unit-tested).
- ⚠ Drag/resize implemented via engine ops; the **pixel-level drag handles / ghost placeholder /
  widget-controls popover / hidden-widgets library drawer / preset mini-previews** are 📝 (engine
  supports the operations; the rich edit-mode chrome is not fully rendered).

### 7. Order Preview (multi-step) — ✅ (safety) / ⚠
- ✅ Create draft → preview (symbol/side/type/entry/qty/lev/value/fee/liq/RR/maxloss) → **explicit
  confirmation checkbox** → simulated submit; AI + SIMULATION badges. Server enforces the token.
- ⚠ The **7-step visual pipeline header** and the **9-gate Risk Checklist UI** are not rendered as
  a modal; the risk math + gate exist server-side/domain. → 📝 (visual pipeline is polish).

### 8. Tweaks / Settings — ⚠
- ✅ Theme / Brand / Density / Long-Short live switch (data-* attributes, no hardcoded colors).
- ⚠ Language toggle flips `locale` + header label but **strings are not extracted (no i18n)** — UI
  copy is Korean. → 📝 known limitation (interface present, catalog not built).
- 📝 Number-format (Standard/Compact), Beginner/Pro mode, floating draggable panel.

## Design tokens — ✅
3-layer OKLCH tokens (brand→semantic→component) copied verbatim into `packages/design-tokens`
(`tokens.css`, `base.css`, `components.css`, `widgets.css`), incl. 4 brand palettes, 3 long/short
pairings, dark+light, density scale, radii, shadows, motion vars, z-index, `.invalidation-banner`,
`.dir-*`, `.dot--live` pulse. Typed exports (THEMES/BRANDS/DENSITIES/LONGSHORT/LOCALES).

## Fixes applied in this pass
1. **C6 Invalidation Banner** — `AICopilotWidget` renders the always-visible red-hatched
   `.invalidation-banner` (was muted text). Verified by e2e `flow-b`.
2. **C3 Directional glyph** — Recent Trades rows now prefix ▲ (buy) / ▼ (sell) in addition to color.
3. **C8 Reduced motion** — global `@media (prefers-reduced-motion: reduce)` guard in base.css
   neutralizes hardcoded animation/transition durations (not just the token vars).

## Documented-for-future (not Phase-1 blocking)
Chart drawing toolbar + AI/user overlay rendering (C5), order-preview 7-step pipeline + 9-gate Risk
Checklist modal UI, full Market-Watch (search/tabs/24h), Order-Entry slider/TIF/flags, Positions/
Open-Orders/History tables with live fills, latency/freshness header segments, i18n string catalog
(ko/en), number-format + Beginner/Pro toggles, layout edit-mode rich chrome (ghost/controls/library
/mini-previews), market-type segmented control, deposit/avatar/alerts. All are visual/feature polish
on top of the correctness-critical core, tracked here and in the Mock/Real matrix.
