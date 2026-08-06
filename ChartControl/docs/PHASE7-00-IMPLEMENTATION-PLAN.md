# PHASE 7-00 — Implementation Plan

**Baseline:** `phase-6-approved-v0.6.0` → `d63ee29c51ba00469b0f48bcf6c4f8848b8ddb4d`
**Branch:** `phase-7-production-launch` (created from the approval tag; no tag moved or recreated)
**Status:** Stage 0 **BLOCKED**. Stages 1–9 not started.

## 0. What Phase 7 is

Phase 7 is not feature work. It connects the Phase 1–6 implementation to real AWS, BitMart and OpenAI
production infrastructure and verifies every Production Release Gate. After Phase 7 the project moves
to a maintenance / bug-fix / product-improvement cycle rather than starting a new phase.

## 1. Baseline verification (executed)

| Check | Result |
|---|---|
| `git status --porcelain` | clean |
| `phase-6-approved-v0.6.0` exists | yes → `d63ee29c51ba00469b0f48bcf6c4f8848b8ddb4d` |
| `84b61e4` (Node 24 LTS) is an ancestor of the approval tag | yes (`merge-base --is-ancestor` exit 0) |
| Branch created from the approval tag | `phase-7-production-launch` |
| Existing tags | 15, all unchanged |

## 2. Absolute safety rules in force

- No real Access Key, Secret Key, Memo, OpenAI key or KMS key material in code, chat, CLI arguments,
  Git, logs or `.env`. Only existence and schema-validity are ever reported.
- Production secrets are read exclusively through AWS Secrets Manager with an IAM role.
- No secret reaches the browser.
- AI cannot submit an order. Administrators cannot create, modify or cancel a real order.
- **Controlled Live Order: BLOCKED — Explicit owner authorization not provided.**
- Defaults held: `BITMART_LIVE_TRADING_ENABLED=false`, `BITMART_EMERGENCY_KILL_SWITCH=true`.
- Nothing unverified is recorded as PASSED. Unrunnable items are `NOT_EXECUTED` or `BLOCKED` with the
  cause and the re-run method.
- No development seed account or fixed development password is created in production.
- Phase 8 is not started.

## 3. Stage status

| Stage | Scope | State |
|---|---|---|
| **0** | Production infrastructure preflight | **BLOCKED** — see PHASE7-02 |
| 1 | Container registry, staging deployment, multi-node | NOT_STARTED (depends on Stage 0) |
| 2 | BitMart production read-only validation + private WS soak | NOT_STARTED |
| 3 | Live OpenAI validation + live-model evaluation + live AI E2E | NOT_STARTED |
| 4 | Security final validation | NOT_STARTED (partially advanced — see below) |
| 5 | Performance & reliability (1,000 VU HTTP, 10,000 WS, soak) | NOT_STARTED |
| 6 | Backup, PITR & disaster recovery | NOT_STARTED |
| 7 | Observability & incident response | NOT_STARTED |
| 8 | Browser & accessibility final gate | NOT_STARTED |
| 9 | Release staging → … → general production | NOT_STARTED |

Stage 0 is the gate for everything else and stays BLOCKED until the operational infrastructure exists
and the runtime role can read its named secrets.

## 4. What this first Phase 7 commit actually delivers

Stage 0 could not be completed, but it surfaced a **real defect in the approved Phase 6 artifact**, and
that defect was fixable without any AWS access. This commit therefore delivers:

1. **Dev seed separated from the production entry point.** `apps/api/src/dev/seed.ts` +
   `seed-cli.ts` hold the only copy of the fixture credentials, are outside the production import
   graph, are absent from `dist`, and are absent from the container image. Verified by scanning the
   built artifact, not by assumption. (PHASE7-08 §1)
2. **Production database dev-seed detection, fail-closed.** SHA-256 digests only — no development
   e-mail or password exists in the production bundle. On detection the process exits with
   `DEV_SEED_ACCOUNT_DETECTED` and logs aggregate counts, never an identifier. (PHASE7-08 §2)
3. **Production signing-key requirement.** The hard-coded development CSRF key is gone; production
   requires `AUTH_CSRF_KEY` and fails closed without it, while dev generates an ephemeral key.
4. **Production artifact scanner.** `scripts/phase7-artifact-scan.sh` inspects `dist`, bundles,
   source maps, config, package metadata, the container filesystem export, image layers/history and
   image ENV — 13 rules, reporting path + rule id + count only. (PHASE7-08 §3)
5. **Regression coverage.** 31 unit tests + a 16-check process-level script covering all ten required
   scenarios. (PHASE7-08 §4)
6. **Terraform IaC for the whole Stage 0 target state**, statically validated, never applied.
   (PHASE7-03, `infrastructure/terraform/phase7/README.md`)

## 5. Stage 0 exit criteria (what unblocks Stage 1)

1. A dedicated **runtime IAM role** exists with the least-privilege policy from
   `infrastructure/terraform/phase7/iam-runtime.tf`, and the API/Gateway runs under it.
2. The **seven separate secrets** exist and hold schema-valid JSON, populated out-of-band by the
   owner. Verification reports `secretLoaded` / `schemaValid` / `kmsDecrypt` / `iamRole` / `region` /
   `secretArnHash` only.
3. **KMS Decrypt via `kms:ViaService = secretsmanager`** demonstrably works from the runtime.
4. **Managed PostgreSQL** reachable, encrypted, automated backup + PITR enabled, retention set.
5. **Managed Redis** reachable with TLS + AUTH, network-restricted.
6. **ECR** repositories exist with immutable tags; the runtime can pull by digest and the deployment
   role can push.
7. **Production domain, DNS and TLS certificate** exist with a recorded expiry date.
8. **OTel collector, log store, metric store and an alert channel** are reachable, with a dashboard
   and runbook links an operator can open.
9. **BitMart IP allowlist** contains the fixed egress IP `15.164.47.4`, verified by an authenticated
   read-only call (Stage 2 Stage A).
10. No development seed account exists in the production database — now enforced in code by the
    fail-closed guard, and re-verified against the real database.

## 6. Sequencing after Stage 0

Stage 1 → 2 → 3 run in order because each depends on real credentials from the previous one. Stage 4
(security) and Stage 7 (observability) run continuously once infrastructure exists. Stage 9's release
ladder is strictly ordered:

```
Internal Staging → Closed Beta → Production Read-Only → Production Shadow
→ Controlled Live Order → Limited Live Trading → General Production
```

Each step requires the previous step's gate to be PASSED. **General Production must not be approved
while Controlled Live Order is unexecuted.**

## 7. Explicit non-goals for this commit

- No AWS resource created, modified or deleted. No `terraform plan`, no `terraform apply`.
- No secret value handled, stored, printed or transmitted.
- Stage 0 is **not** marked PASS.
- Live trading not enabled; Controlled Live Order left BLOCKED.
- `phase-7-rc-v0.7.0` **not** created.
- Phase 6 approval baseline untouched.
