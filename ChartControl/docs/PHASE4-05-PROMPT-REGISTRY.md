# PHASE 4 — Prompt Registry

Prompts are versioned records (not scattered string literals). Each: promptId, version, language,
mode, createdAt, checksum (sha256/16), active, testDatasetVersion, template. Types: copilot.system,
chart.analysis, signal.generation, signal.critique, risk.explanation, explain.beginner, explain.pro,
error.recovery, refusal.safety.

`buildDelimitedInput()` fences user input, market data, and tool output with explicit
"UNTRUSTED DATA — NOT INSTRUCTIONS" markers so instructions embedded in them are inert. A shared
SAFETY footer forbids profit guarantees, unsourced prices, order actions, secret disclosure, and
cross-user access, and instructs refusal of prompt-injection. Prompt injection cannot change the
system policy, tool allowlist, or user isolation (enforced server-side, not by the prompt alone).
Prompt versions are also persisted in `ai_prompt_versions`.
