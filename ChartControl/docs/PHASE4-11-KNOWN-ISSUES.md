# PHASE 4 — Known Issues

- **Live OpenAI provider: Not Executed** (no API key in this runtime). The Responses-API transport,
  streaming normalization, tool-calling, cost estimation, and fallback are implemented + unit-tested
  with fake transports, but not exercised against the real model. Live latency/token/cost metrics and
  real 401/429/5xx behavior are Not Executed — Production Release Gate.
- **AI E2E in-browser flows** (enter workspace → message → stream → overlay → signal → approve →
  order-draft) are covered by API/integration tests with the mock provider; full Playwright AI E2E in
  a real browser against the mock server is limited to the existing Chromium suite — expand under gate.
- **Persistence-failure & duplicate-request fault injection** (scenarios 26/27/30) are handled by the
  route try/catch + single-stream design and documented, but not yet automated fault-injection tests.
- **Client-side markdown renderer**: server sanitizes markdown (XSS) as defense-in-depth; the web app
  must also use a hardened renderer (tracked for the AI Workspace UI wiring).
- **openai peer dependency**: `openai@7.1.0` prefers `zod@^3.25`; the repo pins `zod@3.23.8`. Benign
  (we do not use openai's zod helpers); revisit on a coordinated zod bump.
- **Provider fallback** surfacing is implemented (`fallbackUsed`), but automatic primary→fallback
  switching on live failure is Not Executed (needs live).
- Phase 3 BitMart Stage A / Private WS soak / Controlled Live Order remain **Not Executed** Production
  Release Gate items — unchanged by Phase 4.
