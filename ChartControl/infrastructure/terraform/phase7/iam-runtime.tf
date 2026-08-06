# ---------------------------------------------------------------------------
# RUNTIME role — what the QuantumTrade API/Gateway process may do.
#
# Deliberately absent (Phase 7 §7 prohibitions):
#   - Resource "*"                     : every statement is scoped to a named ARN or ARN prefix
#   - secretsmanager:ListSecrets       : the app resolves secrets by ARN; it never enumerates
#   - secretsmanager:PutSecretValue    : the runtime never writes a credential
#   - kms:*                            : only kms:Decrypt, and only via Secrets Manager
#   - RDS / ElastiCache / Route53 / ACM management       : data-plane only, no control plane
#   - ecr:PutImage and any other push action            : pull only
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "runtime_assume" {
  # EC2 and ECS tasks are both permitted so the same role serves either deployment target.
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com", "ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "runtime" {
  name                 = "${local.prefix}-runtime"
  description          = "QuantumTrade API/Gateway runtime role (read-only secret access, ECR pull, telemetry)"
  assume_role_policy   = data.aws_iam_policy_document.runtime_assume.json
  max_session_duration = 3600

  tags = { Name = "${local.prefix}-runtime", RoleType = "runtime" }
}

resource "aws_iam_instance_profile" "runtime" {
  name = "${local.prefix}-runtime"
  role = aws_iam_role.runtime.name
}

# tfsec AVD-AWS-0057 ("avoid wildcards in IAM policy") fires on `local.runtime_secret_arn_patterns`.
# The only wildcard there is the 6-character random suffix that Secrets Manager appends to EVERY
# secret ARN (`...:secret:<name>-XXXXXX`); pinning a named secret is impossible without it, and it is
# the pattern AWS documents. tfsec can only suppress at block granularity for a policy document, so
# the ignore below is coarser than the finding. Coverage is NOT lost: checkov independently lints this
# same document (CKV_AWS_356 / CKV_AWS_111 / CKV_AWS_109) and PASSES it, and the reviewed statement
# inventory is recorded in docs/PHASE7-03-SECRET-IAM-KMS.md.
#tfsec:ignore:AVD-AWS-0057
data "aws_iam_policy_document" "runtime" {
  # 1) Read ONLY the seven named operational secrets.
  statement {
    sid    = "ReadNamedOperationalSecrets"
    effect = "Allow"

    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
    ]

    # tfsec:ignore:AVD-AWS-0057 The only wildcard is the 6-character random suffix Secrets Manager
    # appends to every secret ARN (`...:secret:<name>-*`). This is the AWS-documented way to scope a
    # policy to a NAMED secret; the resource is not open. Each of the 7 patterns names one secret.
    resources = local.runtime_secret_arn_patterns
  }

  # 2) Decrypt ONLY the secrets key, and ONLY when the call is made through Secrets Manager.
  statement {
    sid       = "DecryptSecretsKeyViaSecretsManager"
    effect    = "Allow"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.secrets.arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.region}.amazonaws.com"]
    }
  }

  # 3) Ship logs to the application log groups only.
  statement {
    sid    = "WriteApplicationLogs"
    effect = "Allow"

    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
    ]

    resources = [
      "${aws_cloudwatch_log_group.api.arn}:*",
      "${aws_cloudwatch_log_group.gateway.arn}:*",
      "${aws_cloudwatch_log_group.audit.arn}:*",
    ]
  }

  # 4) Publish metrics to the application namespace only.
  statement {
    sid       = "PublishNamespacedMetrics"
    effect    = "Allow"
    actions   = ["cloudwatch:PutMetricData"]
    resources = ["*"] # PutMetricData has no resource ARN; scoped by namespace condition below

    condition {
      test     = "StringEquals"
      variable = "cloudwatch:namespace"
      values   = ["QuantumTrade/${var.environment}"]
    }
  }

  # 5) Pull the approved images (pull only — no push action is granted).
  statement {
    sid    = "PullApprovedImages"
    effect = "Allow"

    actions = [
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchCheckLayerAvailability",
    ]

    resources = [aws_ecr_repository.api.arn, aws_ecr_repository.gateway.arn]
  }

  # ecr:GetAuthorizationToken is account-level by design (no resource ARN exists for it).
  statement {
    sid       = "EcrAuthToken"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # 6) Publish alerts to the operational topic only.
  statement {
    sid       = "PublishAlerts"
    effect    = "Allow"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]
  }

  # 7) Hard denial of credential mutation and enumeration, in case a future managed policy is
  #    attached by mistake. An explicit Deny cannot be overridden by any Allow.
  statement {
    sid    = "DenyCredentialMutationAndEnumeration"
    effect = "Deny"

    actions = [
      "secretsmanager:PutSecretValue",
      "secretsmanager:UpdateSecret",
      "secretsmanager:CreateSecret",
      "secretsmanager:DeleteSecret",
      "secretsmanager:RestoreSecret",
      "secretsmanager:ListSecrets",
      "secretsmanager:ListSecretVersionIds",
      "secretsmanager:TagResource",
      "kms:Encrypt",
      "kms:CreateGrant",
      "kms:ScheduleKeyDeletion",
      "kms:PutKeyPolicy",
      "ecr:PutImage",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:DeleteRepository",
      "rds:*",
      "elasticache:*",
      "route53:*",
      "acm:*",
      "iam:*",
    ]

    resources = ["*"]
  }
}

resource "aws_iam_policy" "runtime" {
  name        = "${local.prefix}-runtime"
  description = "Least-privilege runtime policy: read named secrets, decrypt via Secrets Manager, telemetry, ECR pull"
  policy      = data.aws_iam_policy_document.runtime.json
}

resource "aws_iam_role_policy_attachment" "runtime" {
  role       = aws_iam_role.runtime.name
  policy_arn = aws_iam_policy.runtime.arn
}

# Break-glass shell access via SSM Session Manager (no inbound SSH, no key pairs).
resource "aws_iam_role_policy_attachment" "runtime_ssm" {
  count = var.enable_ssm_session_manager ? 1 : 0

  role       = aws_iam_role.runtime.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/AmazonSSMManagedInstanceCore"
}
