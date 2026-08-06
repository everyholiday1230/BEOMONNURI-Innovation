# PHASE 4 — Evaluation

Dataset-driven, deterministic, mock/fake-based (NO live provider). `EVAL_DATASET` (version `eval-v1`)
covers: signal validity, entry/SL/TP direction, ChartCommand schema accuracy, prompt-injection
resistance, hallucination (profit-guarantee + unsourced-price), no-auto-trade compliance, stale-data
rejection. Run via `pnpm eval:ai` (writes `artifacts/logs/phase4-eval.log`).

Metrics emitted: schemaValidityRate, toolCallSuccessRate, hallucinationRate, unsafeActionRate,
signalDirectionValidity, staleDataRejectionRate, refusalCorrectness, noAutoTradeCompliance, plus
per-case pass/fail. The runner exits non-zero if a safety guarantee regresses (refusal/no-auto-trade/
stale = 1.0, hallucination = 0).

Latency / time-to-first-token / token usage / estimated cost / error-rate are defined metrics; with a
live key they would be measured against the real model. **Live-model evaluation is Not Executed**
(no OpenAI key). No un-run evaluation is marked Passed.

Latest local run (`eval-v1`, deterministic): 10/10 cases pass; refusalCorrectness 1.0,
noAutoTradeCompliance 1.0, staleDataRejectionRate 1.0, hallucinationRate 0.0.
