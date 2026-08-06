# ADR-0003 — Frontend stack: React 18 + TS strict + Vite + TanStack Query + Zustand + Zod

Status: Accepted · Date: 2026-07-28

## Context
The brief requests React, TypeScript strict, Vite, Hono BFF, TanStack Query, Zustand, Zod,
KLineChart, a layout engine, and warns against excess dependencies and against redesigning.

## Decision
- **React 18** (explicitly requested) although React 19 is published; revisit in Phase 2.
- **Vite** build, **TS strict** (+ `noUncheckedIndexedAccess`).
- **TanStack Query** for server state; **Zustand** for UI/streaming state; **Zod** at every
  external boundary.
- **KLineChart** for the trading chart (behind adapter). **Custom 24-col layout engine** ported
  from the prototype (rather than GridStack) to preserve exact preset geometry and behavior; the
  brief allows "GridStack.js or a sufficiently validated layout engine". Recorded as a deliberate
  deviation from the GridStack suggestion.
- Money computed with **decimal.js**, never JS floats.

## Consequences
+ Matches requested stack; minimal deps; exact design fidelity for layout.
− Custom layout engine must be well-tested (it is, in `packages/domain` + web layer).
