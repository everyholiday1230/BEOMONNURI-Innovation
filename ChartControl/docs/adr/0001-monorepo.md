# ADR-0001 — pnpm monorepo with layered packages

Status: Accepted · Date: 2026-07-28

## Context
The product spans a web SPA, a BFF, and several backend concerns (market-data, trading, risk, AI)
that must be independently deployable later, while sharing schemas, domain logic, and design tokens.

## Decision
Use a **pnpm workspace monorepo**. Shared logic lives in `packages/*` (schemas, domain,
design-tokens, exchange-adapters, chart-adapter, config); deployables in `apps/*` (web, api).
Backend services are modules with clean interfaces now, splittable into services later.

## Consequences
+ Single install, shared types, atomic refactors, enforced boundaries.
+ Domain/schemas are framework-agnostic and testable in isolation.
− Requires workspace tooling discipline; addressed with `workspace:*` deps and TS project settings.
