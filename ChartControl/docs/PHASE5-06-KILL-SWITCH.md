# PHASE 5 — Kill Switch & Feature Flags

## Kill switch scopes
global_live_trading, bitmart_live_trading, new_positions, user, credential, symbol, ai_provider,
ai_signal_generation, ai_order_draft.

## Requirements enforced
- Server-enforced (UI cannot bypass); ADMIN/SUPER_ADMIN only (`admin.kill_switch.write`).
- Change requires: current-state re-check (optimistic `version` → 409 on concurrent edit), a **reason**,
  and a **step-up re-auth flag** (`reauth:true`, else 403). Approver structure + auto-expiry columns present.
- Audited (before/after value, changed_by, correlation id) in `kill_switch_history` + `admin_actions`.
- **Fail-closed**: when the store is unavailable, live-trading scopes (global/bitmart/new_positions)
  default to ACTIVE/blocked (`killSwitchDefaultOnError`). Seeded ACTIVE by default at startup.
- Cache invalidation / multi-node propagation: single-node in this build (documented; distributed
  propagation is a PROD gate).

Live-trading defaults preserved: `LIVE_TRADING_ENABLED=false`, `EMERGENCY_KILL_SWITCH=true`. Phase 5
tests do not enable live trading.

## Feature flags
`feature_flags` + `feature_flag_history`; change requires write permission + reason + optimistic
version; history preserved. Seeded: `ai_enabled` (from env), `bitmart_live_trading_enabled=false`.
