# QuantumTrade AI — Stage 0 AWS Handoff

> Prompt 6/6 산출물. **미실행 초안** — AWS 담당자용 실행 명령·예상 증거. terraform plan/apply·AWS API·secret 조회는 이 문서 작성 중 실행하지 않았다.
> 선행 조건(Step -1): BL-01 PostgreSQL 0006~0009 DDL, BL-02 alerting.tf runbook 경로, SNS 수신처 주입.
> secret 증거는 describe-secret 메타데이터만 사용(값 조회 금지).

# Stage 0 인계 초안 — AWS 담당자용 실행 명령 및 예상 증거

**본 문서는 초안이며, 이 세션에서 아래 명령은 단 하나도 실행되지 않았다 (전부 NOT_EXECUTED).**
대상: `infrastructure/terraform/phase7` @ `7e22d2f`, branch `phase-7-production-launch`.

전제 조건: 리전 `ap-northeast-2`, MFA 적용된 owner 자격증명, `docs/PHASE7-02-AWS-RUNTIME-VALIDATION.md`
§7 "What is required to move Stage 0 to PASS" 및 `docs/PHASE7-03-SECRET-IAM-KMS.md`를 함께 참조.

---

## Step -1. apply 전 선행 수정 (코드 변경 필요)

| # | 항목 | 조치 | 근거 |
|---|---|---|---|
| P1 | 알람 runbook 경로 파손 | `docs/PHASE7-16-INCIDENT-RESPONSE.md`를 작성하거나 `alerting.tf:81` `runbook_base`를 기존 `docs/PHASE3-13-INCIDENT-RESPONSE.md`로 정정 | 21개 알람 description 전부가 없는 파일을 가리킴 |
| P2 | 알림 수신처 공백 | `alert_email_subscriptions` / `alert_https_subscriptions`(Slack/PagerDuty webhook URL)를 tfvars에 주입 | 두 변수 default `[]` → 알람이 아무에게도 도달하지 않음 |
| P2 | OTel collector | collector 사이드카/ADOT + OTLP exporter 정의 추가, 또는 `otel-collector` 로그 그룹 미사용을 인계서에 명시 | tf에 collector 리소스 없음 |
| P2 | ALB WAF | `enable_dns=true`로 공개 진입점을 켠다면 WAFv2 web ACL 부착 | `dns.tf:47` `CKV2_AWS_28` skip |

## Step 0. 상태 백엔드 준비 (Terraform 외부에서 1회)

```bash
export AWS_REGION=ap-northeast-2
export TF_STATE_BUCKET=quantumtrade-prod-tfstate-<accountid>

aws s3api create-bucket --bucket "$TF_STATE_BUCKET" \
  --region "$AWS_REGION" --create-bucket-configuration LocationConstraint="$AWS_REGION"
aws s3api put-bucket-versioning --bucket "$TF_STATE_BUCKET" \
  --versioning-configuration Status=Enabled
aws s3api put-public-access-block --bucket "$TF_STATE_BUCKET" \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket "$TF_STATE_BUCKET" \
  --server-side-encryption-configuration \
  '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"aws:kms"},"BucketKeyEnabled":true}]}'
aws dynamodb create-table --table-name quantumtrade-prod-tflock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH --billing-mode PAY_PER_REQUEST
```

예상 증거: `get-bucket-versioning` → `"Status": "Enabled"`; `get-public-access-block` → 4개 필드 전부
`true`; `get-bucket-encryption` → `"SSEAlgorithm": "aws:kms"`; `describe-table` → `"TableStatus": "ACTIVE"`.
`versions.tf` 주석이 요구하는 조건(SSE-KMS + versioned + public access 차단 + DynamoDB lock)과 일치해야 한다.

## Step 1. init + plan (아직 apply 아님)

```bash
cd infrastructure/terraform/phase7
cp terraform.tfvars.example terraform.tfvars   # 값 채우기 (secret 값은 절대 넣지 말 것)

terraform init \
  -backend-config="bucket=$TF_STATE_BUCKET" \
  -backend-config="key=phase7/terraform.tfstate" \
  -backend-config="region=$AWS_REGION" \
  -backend-config="dynamodb_table=quantumtrade-prod-tflock" \
  -backend-config="encrypt=true"

terraform plan -out=phase7.tfplan | tee /tmp/stage0-plan.log
terraform show -json phase7.tfplan > /tmp/stage0-plan.json
```

주의: `versions.tf`에 backend 블록이 없으므로 위 `-backend-config`만으로는 S3 backend가 붙지 않는다.
`backend "s3" {}` 블록을 추가하거나 `-backend-config=backend.hcl`과 함께 backend 선언을 넣어야 한다.

예상 증거 — plan JSON에서 계약 항목별 리소스 수를 세어 확인:

```bash
jq -r '.resource_changes[] | select(.change.actions[0]=="create") | .type' /tmp/stage0-plan.json \
  | sort | uniq -c | sort -rn
```

| 확인 항목 | 기대값 |
|---|---|
| `aws_secretsmanager_secret` | 7 |
| `aws_secretsmanager_secret_policy` | 7 |
| `aws_secretsmanager_secret_version` | **0** (값이 state에 들어가면 안 됨) |
| `aws_kms_key` / `aws_kms_alias` | 4 / 4 |
| `aws_cloudwatch_log_group` | 7 |
| `aws_cloudwatch_metric_alarm` | 21 |
| `aws_ecr_repository` | 2 (`image_tag_mutability = "IMMUTABLE"`) |
| `aws_db_instance` | 1 (`engine = "postgres"`, `storage_encrypted = true`) |
| `aws_elasticache_replication_group` | 1 (`transit_encryption_enabled = true`) |
| `aws_eip` / `aws_nat_gateway` | 1 / 1 |
| `aws_iam_role` | runtime / deployment 분리 확인 |
| `aws_lb`, `aws_acm_certificate` | `enable_dns=false`면 0 |
| `aws_ecs_*` | `deployment_target="external"`면 0 |

plan에 secret 값이 없음을 교차 확인:

```bash
jq -r '.resource_changes[] | select(.type=="aws_secretsmanager_secret_version")' /tmp/stage0-plan.json
# 기대: 빈 출력
grep -icE 'secret_string|accessKey"[[:space:]]*:[[:space:]]*"[^"]' /tmp/stage0-plan.json
# 기대: 0
```

## Step 2. apply (owner 승인 후)

```bash
terraform apply phase7.tfplan | tee /tmp/stage0-apply.log
terraform output -json > /tmp/stage0-outputs.json
```

예상 증거: `Apply complete! Resources: N added, 0 changed, 0 destroyed.` +
`/tmp/stage0-outputs.json`에 `secret_arns`(7), `kms_key_arns`(4), `ecr_repository_urls`(2),
`postgres_endpoint`, `redis_primary_endpoint`, `fixed_egress_ip`, `log_group_names`(7),
`alert_topic_arn`, `runtime_environment_template`. **출력에 credential 값이 없어야 한다**
(`outputs.tf` 설계상 ARN/endpoint만).

## Step 3. secret 값 주입 (owner 전용, Terraform 아님)

`infrastructure/terraform/phase7/README.md` §"Populating secret values" 절차를 그대로 사용
(`umask 077` + `/dev/shm` + `shred -u`). 7개 secret과 필드명:

| Secret | 필드 |
|---|---|
| `quantumtrade/prod/bitmart/trading-api` | `accessKey`, `secretKey`, `memo` |
| `quantumtrade/prod/openai/api` | `apiKey` (optional `projectId`, `organizationId`) |
| `quantumtrade/prod/app/session-csrf` | `csrfKey` (≥32 chars) |
| `quantumtrade/prod/db/postgres` | `username`, `password`, `database` (+`url`) |
| `quantumtrade/prod/redis` | `authToken` |
| `quantumtrade/prod/mfa/encryption-key` | `kek` (base64 32B) |
| `quantumtrade/prod/audit/integrity-key` | `integrityKey` |

예상 증거: 각 secret에 대해 **값이 아니라 메타데이터만** 기록한다.

```bash
aws secretsmanager describe-secret --secret-id <name> \
  --query '{Name:Name,KmsKeyId:KmsKeyId,Versions:VersionIdsToStages}'
```

→ `KmsKeyId`가 `kms_key_arns.secrets`와 일치, `AWSCURRENT` 버전 1개 존재.
**`get-secret-value` 출력은 증거로 저장하지 말 것.**

## Step 4. 계약 항목별 사후 검증 명령 (예상 증거)

| 계약 항목 | 명령 | 기대 증거 |
|---|---|---|
| 7 Secrets | `aws secretsmanager list-secrets --query 'length(SecretList[?starts_with(Name,`quantumtrade/prod`)])'` | `7` |
| 4 KMS CMK | `aws kms list-aliases --query "length(Aliases[?starts_with(AliasName,'alias/quantumtrade-prod')])"` + 각 키 `get-key-rotation-status` | `4`, 각 `"KeyRotationEnabled": true` |
| runtime IAM least privilege | `aws iam simulate-principal-policy --policy-source-arn <runtime_role_arn> --action-names secretsmanager:ListSecrets secretsmanager:PutSecretValue kms:Encrypt ecr:PutImage rds:ModifyDBInstance` | 전부 `"EvalDecision": "explicitDeny"` |
| runtime 허용 경로 | 동일 명령, `--action-names secretsmanager:GetSecretValue --resource-arns <bitmart secret arn>` | `"allowed"` |
| deployment IAM | `simulate-principal-policy` on deployment role: `secretsmanager:GetSecretValue`, `kms:Decrypt` | `explicitDeny`; `ecr:PutImage`는 `allowed` |
| RDS PostgreSQL | `aws rds describe-db-instances --query 'DBInstances[0].{E:Engine,Enc:StorageEncrypted,MAZ:MultiAZ,Pub:PubliclyAccessible,Del:DeletionProtection,Bak:BackupRetentionPeriod}'` | `postgres`, `true`, `true`, `false`, `true`, ≥7 |
| RDS TLS 강제 | `aws rds describe-db-parameters --db-parameter-group-name <pg> --query "Parameters[?ParameterName=='rds.force_ssl'].ParameterValue"` | `["1"]` |
| Redis TLS | `aws elasticache describe-replication-groups --query 'ReplicationGroups[0].{T:TransitEncryptionEnabled,A:AtRestEncryptionEnabled,F:AutomaticFailover,M:MultiAZ}'` | `true,true,enabled,enabled` |
| ECR immutable | `aws ecr describe-repositories --query 'repositories[].{N:repositoryName,M:imageTagMutability,S:imageScanningConfiguration.scanOnPush}'` | 2개 모두 `IMMUTABLE`, `true` |
| CloudWatch log groups | `aws logs describe-log-groups --log-group-name-prefix /quantumtrade/prod --query 'logGroups[].{N:logGroupName,R:retentionInDays,K:kmsKeyId}'` | 7개, 전부 `kmsKeyId` 비어있지 않음, audit=400 |
| 21 alarms | `aws cloudwatch describe-alarms --alarm-name-prefix quantumtrade-prod --query 'length(MetricAlarms)'` | `21` |
| 알람 수신처 | `aws cloudwatch describe-alarms --query 'MetricAlarms[?length(AlarmActions)==`0`].AlarmName'` | 빈 배열 |
| SNS + 암호화 | `aws sns get-topic-attributes --topic-arn <arn> --query 'Attributes.KmsMasterKeyId'` | logs CMK ARN |
| Slack/PagerDuty 구독 | `aws sns list-subscriptions-by-topic --topic-arn <arn> --query 'Subscriptions[].{P:Protocol,C:SubscriptionArn}'` | `https` 구독이 `PendingConfirmation`이 아니어야 함 |
| 알람 → SNS 실전달 | `aws cloudwatch set-alarm-state --alarm-name quantumtrade-prod-kill_switch_change --state-value ALARM --state-reason "stage0 handoff drill"` | Slack/PagerDuty에 실제 수신 확인 (drill 후 `set-alarm-state ... OK`) |
| NAT 고정 egress | `aws ec2 describe-addresses --query 'Addresses[?Tags[?Value==`fixed-egress-ip`]].PublicIp'` | 주소 1개, `terraform output fixed_egress_ip`와 일치 |
| egress IP 런타임 확인 | 런타임 컨테이너에서 `curl -s https://checkip.amazonaws.com` | 위 EIP와 동일 |
| BitMart IP allowlist | BitMart 대시보드에서 위 EIP 등록 (수동) 후 public endpoint로 서명 확인 | 등록 스크린샷 + `bitmart_auth_failure` 알람 0건. **private API 호출은 owner 승인 전 금지** |
| DNS/ACM/TLS (`enable_dns=true` 시) | `aws acm describe-certificate --query 'Certificate.Status'`; `aws elbv2 describe-listeners --query 'Listeners[].{P:Port,S:SslPolicy}'`; `curl -sI https://<domain>` | `ISSUED`; 443=`ELBSecurityPolicy-TLS13-1-2-2021-06`; 80 → `HTTP/1.1 301` |
| OTel | collector 배포 후 `aws logs describe-log-streams --log-group-name /quantumtrade/prod/otel-collector` | 스트림 ≥1 + trace/metric 수신 로그. 현재 코드로는 **증거 생성 불가** |

## Step 5. 운영 절차 리허설 (증거 필수)

| 절차 | 문서 | 예상 증거 |
|---|---|---|
| backup / restore | `docs/PHASE6-07-BACKUP-RESTORE.md` | `restore-db-instance-to-point-in-time`로 별도 인스턴스 복원 → 스키마·행수 검증 → 삭제. `LatestRestorableTime` 기록 |
| secret rotation | `docs/PHASE7-03-SECRET-IAM-KMS.md` §8 | 1개 secret 수동 회전 후 `describe-secret`의 새 `AWSCURRENT` 버전 ID + 앱 무중단 확인. 자동 rotation은 의도적 미적용이므로 **캘린더 기반 수동 주기**를 인계서에 못박을 것 |
| rollback | `docs/PHASE6-11-DEPLOYMENT-ROLLBACK.md` | 직전 digest로 롤백 → ECS circuit breaker(`rollback=true`) 동작 로그 또는 수동 롤백 소요시간 |
| incident response | **선행 수정 후** `docs/PHASE7-16-…` 또는 `docs/PHASE3-13-INCIDENT-RESPONSE.md` | 알람 → 페이지 → 문서 도달까지 링크 클릭 가능 확인 |
| controlled live-order approval | `docs/PHASE3-12-OPERATIONS-RUNBOOK.md` §Enabling modes, `docs/PHASE3-07-LIVE-TRADING-GATES.md` §6 | READ_ONLY → SHADOW 순차 승격 증거. Controlled Live는 owner 서면 승인 + dual control(LIVE flag + kill switch) 기록 후에만. 기본값은 fail-closed 유지 |

## Step 6. Stage 0 → PASS 판정 기준

아래 전부가 실제 출력 증거로 충족될 때만 PASS. exit code 0 단독으로는 판정하지 않으며,
NOT_EXECUTED 항목은 PASS로 승격하지 않는다.

1. Step -1의 P1(runbook 경로) 해소
2. Step 4의 모든 행이 기대 증거와 일치 (특히 secret 7 / KMS 4 / log group 7 / alarm 21 /
   ECR IMMUTABLE / RDS·Redis 암호화 / IAM explicitDeny)
3. `aws_secretsmanager_secret_version` 0개 및 state 내 secret 값 부재
4. 알람 → Slack/PagerDuty 실전달 drill 성공
5. 고정 egress IP == BitMart allowlist 등록 주소
6. Step 5의 5개 절차 리허설 증거 확보
7. 미충족 항목은 `docs/PHASE7-19-KNOWN-ISSUES.md`에 명시적으로 기록

미해결 상태로 남는 항목(OTel collector, ALB WAF 등)은 PASS 근거에서 제외하고
NOT_EXECUTED / Not implemented로 표기한다.
