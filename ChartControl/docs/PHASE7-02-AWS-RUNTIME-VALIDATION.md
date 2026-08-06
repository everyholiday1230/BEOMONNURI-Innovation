# PHASE 7-02 — AWS Runtime Validation (Stage 0)

**Verdict: BLOCKED / FAIL-CLOSED.** Stage 0 is not PASS and Stage 1 has not started.

Recorded 2026-07-30T04:33Z–04:35Z UTC from the runtime itself.

## 1. Runtime identity — what was actually verified

These four items are genuinely verified, from the instance metadata service and the runtime's own
network egress:

| Item | Result | Evidence |
|---|---|---|
| Runtime host/service | **EC2** — instance `i-0483d903c0925f690`, type `c8i.xlarge`, hostname `ip-10-0-1-98`, Ubuntu 24.04.4 LTS | IMDSv2 `/latest/meta-data/instance-id`, `instance-type`. Not ECS (`ECS_CONTAINER_METADATA_URI_V4` unset), not EKS (no service-account token, `AWS_WEB_IDENTITY_TOKEN_FILE` unset) |
| Region | **ap-northeast-2** | IMDSv2 `placement/region`; matches the requested region |
| IAM Role | **`EC2-SessionManager-Seoul`** | IMDSv2 `iam/security-credentials/`; STS assumed-role identity resolved, account `6517****07`, credential `Code: Success`, expiry `2026-07-30T10:08:08Z` |
| Fixed egress IP | **OK — `15.164.47.4`** | `curl https://checkip.amazonaws.com` from the runtime; matches the address to be registered in the exchange allowlist |
| System time sync | **OK** | `timedatectl`: `System clock synchronized: yes`, `NTP service: active`. Skew against the BitMart production server clock: **+21 ms** (local `1785386124285` vs `server_time 1785386124264`) |
| Outbound TLS to the exchange | **OK** | `GET https://api-cloud-v2.bitmart.com/system/time` → HTTP 200, `ssl_verify_result=0`, 61 ms. Public endpoint, no credential used |

The role in use is a **Session Manager** role, not a purpose-built application runtime role. Stage 1
must run under the dedicated runtime role defined in
`infrastructure/terraform/phase7/iam-runtime.tf`.

## 2. Management-plane probes — every one denied

A read-only capability probe was run through boto3 (the AWS CLI is not installed on this host; boto3
1.34.46 is). Results:

| API | Result |
|---|---|
| `sts:GetCallerIdentity` | OK |
| `secretsmanager:ListSecrets` | `AccessDeniedException` |
| `secretsmanager:DescribeSecret` (each of the 7 named secrets, individually) | `AccessDeniedException` |
| `secretsmanager:GetSecretValue` (bitmart, openai) | `AccessDeniedException` |
| `kms:ListAliases`, `kms:DescribeKey` | `AccessDeniedException` |
| `rds:DescribeDBInstances` | `AccessDenied` |
| `elasticache:DescribeCacheClusters` | `AccessDenied` |
| `ecr:DescribeRepositories`, `ecr:GetAuthorizationToken` | `AccessDeniedException` |
| `acm:ListCertificates` | `AccessDeniedException` |
| `route53:ListHostedZones` | `AccessDenied` |
| `logs:DescribeLogGroups` | `AccessDeniedException` |
| `cloudwatch:ListMetrics` | `AccessDenied` |
| `sns:ListTopics` | `AuthorizationError` |
| `iam:GetRole` | `AccessDenied` |
| `ec2:DescribeSecurityGroups` | Allowed (0 matching groups) |

### Interpretation — this is NOT a runtime fault

**A denied management List/Describe call is an authorization result, not a runtime failure.** The
instance is healthy, its credentials are valid, its clock is synchronized and its egress works. What is
missing is *permission* and, for most services, the *resources themselves*. Two consequences follow,
and both matter for how the gate is recorded:

1. `AccessDenied` on `ListSecrets`/`DescribeSecret` **cannot distinguish** "the secret does not exist"
   from "the secret exists but I may not see it". So the correct state for the secret gates is
   **BLOCKED**, not FAIL and not NOT_EXECUTED-by-choice.
2. **No broad `List` permission will be added to the runtime role to make these probes succeed.** The
   application resolves secrets by ARN and never enumerates them; `secretsmanager:ListSecrets` is on
   the explicit `Deny` list in the Phase 7 runtime policy. A preflight that needs enumeration would be
   testing a permission production must not have.

## 3. Corrected Stage 0 gate states

| Gate | State | Reason |
|---|---|---|
| Runtime host/service | **PASS** | EC2 `i-0483d903c0925f690`, verified via IMDSv2 |
| Region | **PASS** | ap-northeast-2 |
| IAM Role identity resolvable | **PASS** | `EC2-SessionManager-Seoul` (not the intended application role) |
| Fixed egress IP | **PASS** | 15.164.47.4 |
| System time synchronization | **PASS** | NTP active, +21 ms vs exchange server time |
| BitMart **GetSecretValue** | **BLOCKED — AccessDenied** | Runtime role has no `secretsmanager` permission; secret existence cannot be confirmed either way |
| OpenAI **GetSecretValue** | **BLOCKED — AccessDenied** | Same |
| **KMS Decrypt** | **NOT_EXECUTED / BLOCKED** | The `kms:ViaService = secretsmanager.ap-northeast-2.amazonaws.com` decrypt path can only be exercised *through* a `GetSecretValue` call. Because the secret read is denied, the real ViaService decrypt path was never reached, so there is nothing to report as pass or fail |
| Secret separation (7 distinct secrets) | **BLOCKED** | Cannot enumerate or describe; the intended layout is defined in Terraform and PHASE7-03 |
| **RDS** / managed PostgreSQL | **NOT_EXECUTED / BLOCKED** | `rds:DescribeDBInstances` denied **and** no production instance/endpoint was provided. A local dev PostgreSQL 16.14 exists on 127.0.0.1:5432/15432 but is **not** a managed instance and is not evidence for this gate. PITR / encryption / retention unverifiable |
| **ElastiCache** / managed Redis | **NOT_EXECUTED / BLOCKED** | `elasticache:DescribeCacheClusters` denied **and** no production endpoint provided. A local dev Redis answers `PONG` on 6379/16379 but reports `tls-port = 0` (TLS disabled) and has no AUTH — a dev instance, not evidence |
| **ECR** registry push/pull | **NOT_EXECUTED / BLOCKED** | `DescribeRepositories` and `GetAuthorizationToken` denied; no repository provided. Digest deployment and signing/attestation unverifiable |
| **DNS / TLS** (production domain, certificate expiry) | **NOT_EXECUTED / BLOCKED** | `acm:ListCertificates` and `route53:ListHostedZones` denied; **no production domain is configured anywhere in the repository** (repo-wide search: 0 matches). Outbound TLS from the runtime is separately confirmed working |
| **Observability collector** | **NOT_EXECUTED / BLOCKED** | `logs:DescribeLogGroups` and `cloudwatch:ListMetrics` denied; no OTel collector endpoint configured |
| **Alert delivery** | **NOT_EXECUTED / BLOCKED** | `sns:ListTopics` denied; no Slack/PagerDuty webhook configured; no dashboard or runbook link reachable |
| **Production seed blocked** | **PASS (code-enforced, re-verify against the real DB)** | See §4 — measured on a real process, and a defect in the approved artifact was found and fixed |
| Operator (owner) for secrets/IAM/data layer | **UNASSIGNED** | Needs to be named before Stage 1 |

## 4. Production development-account blocking — measured

This is the one Stage 0 sub-gate that could be fully exercised locally, and doing so exposed a defect
in the **approved** Phase 6 artifact.

### Behavioural verification (real process)

```
NODE_ENV=production ADMIN_SEED=true  →  no "DEV admin seed ready" log line (0 occurrences)
                                     →  0 rows written to users
NODE_ENV=production, no BITMART_SECRET_ARN
                                     →  [api] FAIL-CLOSED startup: BITMART_SECRET_ARN/BITMART_SECRET_ID
                                        required in production   (process exits, /health unreachable)
```

### Defect found: dev credentials WERE inside the approved production image

The approved image `quantumtrade-api:phase6-closure` contained, in `/app/dist/index.js`:

```
admin@qt.local · adminpass1234 · supportpass1234 · analystpass1234
userpass1234 · disablepass1234 · rolepass1234 · dev-insecure-csrf-key
```

one occurrence each. The **execution path** was correctly gated
(`ADMIN_SEED === 'true' && NODE_ENV !== 'production'`), so exploitability was low — but the Phase 7
requirement is that the strings are *absent from the artifact*, not merely unreachable. The Phase 6
container check missed it because `scripts/phase6-container-validate.sh:84` scanned only the image ENV
and `docker history`, never the bundle contents.

### Fixed in this commit

All eight strings are now **0 occurrences** in `apps/api/dist/index.js` and in the container
filesystem of the rebuilt image `quantumtrade-api:phase7-preflight`. Details in PHASE7-08.

## 5. Runtime environment template

Injection format is confirmed; the two ARNs cannot exist until the secrets are created.

```
AWS_REGION=ap-northeast-2                    # verified, matches IMDS
BITMART_SECRET_ARN=<NOT PROVISIONED>         # secret absent or unreadable (AccessDenied)
OPENAI_SECRET_ARN=<NOT PROVISIONED>          # secret absent or unreadable (AccessDenied)
BITMART_MODE=BITMART_LIVE_READ_ONLY          # matches the code default (env.ts pickEnum fallback)
BITMART_LIVE_TRADING_ENABLED=false           # baked into the image, verified
BITMART_EMERGENCY_KILL_SWITCH=true           # baked into the image, verified
NODE_ENV=production                          # baked into the image, verified
```

Secret ARNs are identifiers, not credentials; they are safe to inject as environment variables and to
record here once they exist. No `secretArnHash` is reported yet because no ARN was observable.

## 6. Infrastructure-as-Code status

The full Stage 0 target state is expressed in `infrastructure/terraform/phase7` (18 files) and
statically validated. Nothing was applied.

| Step | Tool | Version | Result |
|---|---|---|---|
| `terraform fmt -check -recursive` | terraform | 1.9.8 | **PASS** |
| `terraform init -backend=false` | terraform | 1.9.8 | **PASS** |
| `terraform validate` | terraform | 1.9.8 | **PASS** |
| `tflint --recursive` | tflint | 0.53.0 | **PASS** (0 issues) |
| `checkov -d . --framework terraform` | checkov | 3.3.8 | **PASS** — 297 passed / **0 failed** / 27 skipped |
| `tfsec .` | tfsec | 1.28.13 | **PASS** — 0 critical / 0 high / 0 medium / 0 low |
| `terraform plan` | terraform | 1.9.8 | **NOT_EXECUTED** — needs credentials with read access to the target account; the runtime role is denied on every service in the configuration |
| `terraform apply` | terraform | 1.9.8 | **NOT_EXECUTED** — out of scope by instruction; no AWS resource created, modified or deleted |

Runner: `scripts/phase7-iac-validate.sh`. Machine-readable summary:
`artifacts/logs/phase7/iac-validate-summary.tsv`. Full log: `artifacts/logs/phase7/iac-validate.log`.

### Tooling notes (installation attempts and outcomes)

- **terraform**: not present. Installed 1.9.8 from `releases.hashicorp.com` into `/home/test1/bin`.
- **tflint**: not present. Installed 0.53.0 from GitHub releases into `/home/test1/bin`.
- **checkov**: `pip3 install --user checkov` **failed** — Ubuntu 24.04 enforces PEP 668
  (externally-managed environment). Worked around with a virtualenv (`python3 -m venv /tmp/cvenv`),
  which installed checkov 3.3.8 successfully. In CI, install checkov in its own venv or container.
- **tfsec**: not present. Installed 1.28.13 binary from GitHub releases.

### Suppressions — all justified inline, none hiding a missing control

27 checkov skips and 1 tfsec ignore, each with the reason written at the point of suppression:

| Rule | Count | Justification |
|---|---|---|
| `CKV2_AWS_57` (secret auto-rotation) | 7 | Rotating BitMart/OpenAI credentials is an out-of-band dashboard action; a Lambda rotator would fail and mask the real process. The DB master password IS rotated, by RDS. Manual procedure in PHASE7-03; failures raise `secret_rotation_failure`. |
| `CKV_AWS_338` (365-day log retention) | 6 | Data minimization: application logs carry request metadata. Retention is 90 days by default; the **audit** log group is 400 days and exceeds the requirement. |
| `CKV_AWS_109/111/356` (IAM wildcard) | 9 | Only on **KMS key policies**, where AWS requires `resources = ["*"]` to mean "this key". The runtime and deployment identity policies are ARN-scoped and **pass** these checks. |
| `CKV_AWS_31` (ElastiCache auth token) | 1 | Transit + at-rest encryption ARE enabled. The auth token is deliberately not in Terraform, because that would persist it in state. |
| `CKV2_AWS_28` (WAF on public ALB) | 1 | The public entry point is disabled by default (`enable_dns = false`). WAF is tracked as an open Stage 4 item in PHASE7-19 — not silently closed. |
| `CKV2_AWS_19` (EIP attached to EC2) | 1 | The EIP is attached to the **NAT gateway**, which is what produces the single fixed egress address. |
| `CKV2_AWS_11` / `CKV2_AWS_12` (flow logs, default SG) | 2 | Both controls **are** implemented (`aws_flow_log.vpc` with `traffic_type = ALL`; `aws_default_security_group.main` with all rules revoked). Checkov's graph checks cannot resolve the `count`-indexed `aws_vpc.main[0]` reference — a tool limitation, verified by reading the resources. |
| `AVD-AWS-0057` (tfsec IAM wildcard) | 1 block-level | Fires on the Secrets Manager ARN suffix wildcard (`...:secret:<name>-*`), which is mandatory and AWS-documented. tfsec can only suppress per policy document; checkov independently lints the same documents and passes them. |

## 7. What is required to move Stage 0 to PASS

1. Create the dedicated **runtime role** with the policy in `iam-runtime.tf` and run the service under
   it. Do **not** add `List*` permissions to satisfy a preflight probe.
2. Owner populates the **seven secrets** out-of-band (procedure:
   `infrastructure/terraform/phase7/README.md` §"Populating secret values"). No value is ever shared
   through this channel.
3. Provision the data layer, registry, DNS/TLS, observability and alerting — the Terraform in this
   commit is ready for `plan` review.
4. Register egress IP **15.164.47.4** in the BitMart allowlist, then verify with an authenticated
   read-only call in Stage 2 Stage A.
5. Re-run the preflight under the new role. Report only:
   `secretLoaded` / `schemaValid` / `kmsDecrypt` / `iamRole` / `region` / `secretArnHash`.
6. Re-run `scripts/phase7-seed-isolation-regression.sh` against the real production database.
