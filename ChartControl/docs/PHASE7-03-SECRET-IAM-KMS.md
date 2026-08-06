# PHASE 7-03 — Secrets, IAM and KMS

**Status: BLOCKED.** No secret exists (or is observable) yet, and no IAM/KMS resource has been
created. This document defines the target design, the exact commands the account owner runs, and how
verification will be reported **without ever handling a secret value**.

## 1. Non-negotiable handling rules

1. A real Access Key, Secret Key, Memo, OpenAI key, session key, database password, Redis token, MFA
   key or audit key must never appear in code, chat, a CLI argument, Git history, a log line, a
   `.env` file, a Terraform variable, a plan file or Terraform state.
2. Values are written **directly** to Secrets Manager by the owner. This channel receives only
   existence and schema-validity.
3. Reporting format — nothing else:
   ```
   secretLoaded=true|false
   schemaValid=true|false
   kmsDecrypt=true|false
   iamRole=<role-name>
   region=<region>
   secretArnHash=<sha256-of-arn-or-masked>
   ```
4. No secret is returned to the browser. The BFF resolves credentials server-side only.
5. If a value is ever pasted into a shared channel, treat it as compromised: rotate at the provider
   first, then update Secrets Manager, then re-verify.

## 2. Seven separate secrets — never combined

| Purpose | Name | JSON field names (values never recorded) |
|---|---|---|
| BitMart production trading API | `quantumtrade/prod/bitmart/trading-api` | `accessKey`, `secretKey`, `memo` |
| OpenAI production API | `quantumtrade/prod/openai/api` | `apiKey` (optional `projectId`, `organizationId`) |
| Application session / CSRF signing key | `quantumtrade/prod/app/session-csrf` | `csrfKey` (≥32 chars) |
| Database credential | `quantumtrade/prod/db/postgres` | `username`, `password`, `database` (+ `url` if a DSN is consumed) |
| Redis credential | `quantumtrade/prod/redis` | `authToken` |
| MFA encryption key | `quantumtrade/prod/mfa/encryption-key` | `kek` (base64, 32 bytes) |
| Audit integrity key | `quantumtrade/prod/audit/integrity-key` | `integrityKey` |

Rationale for separation: a compromise or rotation of the exchange credential must not force rotation
of the session key or the audit integrity key, and the blast radius of any single read must be one
purpose. Terraform declares these as **containers only** (`secrets.tf`), with no
`aws_secretsmanager_secret_version` anywhere.

## 3. Owner procedure — creating and populating

Terraform creates the containers. The owner writes the values. Use a memory-backed file so the value
never reaches shell history or disk:

```bash
umask 077
cat > /dev/shm/bitmart.json        # {"accessKey":"...","secretKey":"...","memo":"..."}
aws secretsmanager put-secret-value --region ap-northeast-2 \
  --secret-id quantumtrade/prod/bitmart/trading-api \
  --secret-string fileb:///dev/shm/bitmart.json
shred -u /dev/shm/bitmart.json
```

Do **not** use `--secret-string '{"accessKey":"..."}'`: the value would land in shell history and in
the process table. Repeat for each of the seven secrets.

## 4. KMS design

Four customer-managed keys, all with rotation enabled:

| Alias | Purpose | Who may use it |
|---|---|---|
| `alias/quantumtrade-prod-secrets` | Secrets Manager envelope encryption + ECR image encryption | Secrets Manager (service principal, same-account condition); the **runtime role** has `kms:Decrypt` **only** via `kms:ViaService = secretsmanager.ap-northeast-2.amazonaws.com` |
| `alias/quantumtrade-prod-database` | RDS storage + snapshots + Performance Insights | `rds.amazonaws.com` on behalf of the account. **No application identity has Decrypt** |
| `alias/quantumtrade-prod-cache` | ElastiCache at rest | `elasticache.amazonaws.com` on behalf of the account |
| `alias/quantumtrade-prod-logs` | CloudWatch Logs + SNS topic | `logs.<region>.amazonaws.com` with an encryption-context condition |

The runtime never holds `kms:Encrypt`, `kms:CreateGrant`, `kms:PutKeyPolicy` or
`kms:ScheduleKeyDeletion` — these are on the explicit `Deny` list.

## 5. Runtime role — least privilege

`infrastructure/terraform/phase7/iam-runtime.tf`. Allow statements:

| Sid | Actions | Resource scope |
|---|---|---|
| `ReadNamedOperationalSecrets` | `secretsmanager:GetSecretValue`, `DescribeSecret` | The 7 named secret ARNs (`...:secret:<name>-*`, wildcarding only the random suffix AWS appends) |
| `DecryptSecretsKeyViaSecretsManager` | `kms:Decrypt` | The secrets key ARN, conditioned on `kms:ViaService = secretsmanager.<region>.amazonaws.com` |
| `WriteApplicationLogs` | `logs:CreateLogStream`, `PutLogEvents`, `DescribeLogStreams` | The three named log group ARNs |
| `PublishNamespacedMetrics` | `cloudwatch:PutMetricData` | `*` **conditioned** on `cloudwatch:namespace = QuantumTrade/<env>` (PutMetricData has no resource ARN) |
| `PullApprovedImages` | `ecr:BatchGetImage`, `GetDownloadUrlForLayer`, `BatchCheckLayerAvailability` | The two repository ARNs |
| `EcrAuthToken` | `ecr:GetAuthorizationToken` | `*` (no ARN exists for this action) |
| `PublishAlerts` | `sns:Publish` | The alert topic ARN |

Explicit `Deny` (cannot be overridden by any later Allow or attached managed policy):

```
secretsmanager:PutSecretValue, UpdateSecret, CreateSecret, DeleteSecret, RestoreSecret,
                ListSecrets, ListSecretVersionIds, TagResource
kms:Encrypt, CreateGrant, ScheduleKeyDeletion, PutKeyPolicy
ecr:PutImage, InitiateLayerUpload, UploadLayerPart, CompleteLayerUpload, DeleteRepository
rds:*, elasticache:*, route53:*, acm:*, iam:*
```

Prohibition compliance: no `Resource "*"` on a restrictable action, no `ListSecrets`, no
`PutSecretValue`, no `kms:*`, no data-store or DNS management, no ECR push.

### Why the runtime will never get `List*`

The Stage 0 preflight could not confirm secret existence because `DescribeSecret` was denied. The fix
is **not** to grant enumeration. The application resolves every secret by ARN from an environment
variable; it has no code path that lists secrets. Granting `ListSecrets` to make a preflight probe
succeed would be testing a permission production must not have. Existence verification instead uses
`DescribeSecret` **on the named ARNs only**, which the target policy already allows.

## 6. Deployment role — separate identity

`infrastructure/terraform/phase7/iam-deployment.tf`. It may push images and roll a deployment. It may
**not** read any secret value:

- Allowed: ECR push/pull on the two repositories, `GetAuthorizationToken`, ECS
  `RegisterTaskDefinition`/`UpdateService` (when ECS is the target), `iam:PassRole` restricted to the
  runtime + task-execution roles with `iam:PassedToService = ecs-tasks.amazonaws.com`, and
  `secretsmanager:DescribeSecret` on the named ARNs (deploy-time existence preflight).
- Explicitly denied: `secretsmanager:GetSecretValue`, `PutSecretValue`, `ListSecrets`, `kms:Decrypt`,
  `kms:Encrypt`, `rds:*`, `elasticache:*`, `route53:*`, `acm:*`, and IAM user/key/policy mutation.

Trust policy: either the account root **with MFA required**, or a CI OIDC provider constrained by
`aud` and a `sub` pattern. A build pipeline never needs a trading key, so it never gets one.

## 7. Operator access

There is no administrative inbound rule anywhere in the network configuration — no SSH port, no
operator CIDR allowlist. Break-glass shell access uses **SSM Session Manager**
(`AmazonSSMManagedInstanceCore` on the runtime role, `enable_ssm_session_manager = true`), which needs
no open port and is recorded in CloudTrail.

## 8. Rotation

Automatic rotation is deliberately **not** enabled on the seven secrets:

| Secret | Rotation method | Cadence |
|---|---|---|
| BitMart trading API | Manual: create a new key in the BitMart dashboard with the IP allowlist and futures permission, `put-secret-value`, restart/roll, then revoke the old key | 90 days, or immediately on suspicion |
| OpenAI API | Manual: create a new key in the OpenAI dashboard, `put-secret-value`, roll, revoke old | 90 days |
| Session / CSRF key | Manual: generate 32+ random bytes, `put-secret-value`, roll. Invalidates issued CSRF tokens — schedule in a maintenance window | 180 days |
| Database credential | RDS-managed (`manage_master_user_password`) for the master; the application credential is rotated manually alongside a migration window | 90 days |
| Redis auth token | ElastiCache `ROTATE` strategy, token supplied out-of-band | 180 days |
| MFA encryption key | Requires re-encryption of stored MFA secrets — a migration, not a swap. Documented procedure required before rotating | on incident |
| Audit integrity key | Append-only chain: a new key starts a new segment; old segments stay verifiable with the retired key | 365 days |

A Lambda rotator was rejected because rotating the exchange and AI credentials requires an out-of-band
action in each provider's console; an automated rotator would fail and hide the real process. Rotation
failures raise the `secret_rotation_failure` alarm (`alerting.tf`).

## 9. Production administrator accounts

- No development seed account is created in production. Enforced in code and verified: see
  PHASE7-08 §2 and `scripts/phase7-seed-isolation-regression.sh` (R4, R5, R8).
- The production administrator is created separately, through an explicit operator procedure — never
  by a seed.
- First login must force a password change, and MFA enrolment is mandatory before any administrative
  action.
- The dev fixture identifiers (`*@qt.local`) can never be created in production without tripping the
  `DEV_SEED_ACCOUNT_DETECTED` start-up guard.

## 10. Current state

| Item | State |
|---|---|
| 7 secrets created | **BLOCKED** — `AccessDeniedException` on Describe; existence unknown |
| Secret values populated | **NOT_EXECUTED** — owner action, values never shared with this channel |
| KMS keys created | **NOT_EXECUTED** — no `kms` permission; no key observable |
| KMS Decrypt via `ViaService` verified | **NOT_EXECUTED / BLOCKED** — reachable only through `GetSecretValue`, which is denied |
| Runtime role created | **NOT_EXECUTED** — Terraform ready; current runtime uses `EC2-SessionManager-Seoul` |
| Deployment role created | **NOT_EXECUTED** — Terraform ready |
| Runtime/deployment separation | **Designed and statically validated**, not deployed |
| Production admin account | **NOT_EXECUTED** — requires the production database |
