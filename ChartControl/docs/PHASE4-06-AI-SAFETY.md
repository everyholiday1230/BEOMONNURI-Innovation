# PHASE 4 — AI Safety

`SafetyPolicy` screens three surfaces:
- **User input**: prompt-injection patterns block the request; auto-trade *requests* are flagged
  (allowed as a question, refused as an action).
- **Tool output** (UNTRUSTED): injection patterns flagged/neutralized; never executed.
- **Model output**: profit-guarantee, unsourced-price (a current-price claim with no market tool
  result), auto-trade intent, and stale-data-signal are rejected; markdown is sanitized (XSS).

Enforced invariants (docs §12):
- AI does not assume live prices; a current-price claim without a market tool result is blocked.
- Signals on stale market data are blocked.
- No fabricated symbols/prices/positions or made-up win-rates/backtests; no profit guarantees.
- AI signal ≠ order submission; Risk Engine cannot be bypassed; no auto-trade; no action without user
  confirmation; risk disclosure shown.
- Prompt injection cannot escalate tool permissions; cross-user data access is impossible (server
  scopes every read/write by session userId; cross-user returns 404).

`sanitizeMarkdown()` strips `<script>`/iframe/handlers and neutralizes `javascript:`/`data:` in both
HTML attributes and markdown link/image targets (defense-in-depth; the client also hard-sanitizes).
