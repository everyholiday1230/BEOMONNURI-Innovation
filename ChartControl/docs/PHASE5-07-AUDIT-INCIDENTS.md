# PHASE 5 — Audit & Incidents

## Audit
`admin_actions` is APPEND-ONLY — the app exposes no update/delete route for it (immutable to any
admin). Records: actor, actor role, action, resource, resource id, target user, result, risk level,
IP, correlation id, before/after (redacted), reason, timestamp. Searchable by actor/user/action/
resource/date/result (parameterized). Secrets/password/session/CSRF/full auth headers are stripped via
`redact()` before persistence + response. CSV/JSON export requires a separate permission
(`admin.audit.export`), is itself audited, is row-limited (≤10k), and CSV output is `csvSafe()`
(formula-injection neutralized).

## Incidents
`incidents` + `incident_events`. States `OPEN → INVESTIGATING → MITIGATED → RESOLVED → CLOSED`
(`canTransitionIncident`; illegal transition → 409). Severities SEV1–SEV4 (SEV1/SEV2 surfaced with a
top banner + kill-switch state in the UI). Fields: severity, title, description, service, detectedAt,
owner, timeline (events), impact, rootCause, mitigation, resolution, related correlation IDs, related
release, related kill switch, postmortem link. Optimistic `version` prevents concurrent-edit clobber.
