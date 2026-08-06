# ---------------------------------------------------------------------------
# Customer-managed KMS keys.
#
# Three separate keys so a compromise or rotation of one does not affect the others, and so the
# runtime role can be granted Decrypt on the secrets key ONLY (never on the data-at-rest keys, which
# the managed services use on the service's behalf).
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "kms_secrets" {
  #checkov:skip=CKV_AWS_109:KMS key policies attach to the key itself; AWS requires resources = ["*"]
  #to mean "this key". Not an account-wide grant. Identity policies (iam-runtime.tf,
  #iam-deployment.tf) are ARN-scoped and pass these checks.
  #checkov:skip=CKV_AWS_111:Same reason - the resource scope of a key policy IS the key.
  #checkov:skip=CKV_AWS_356:Same reason.
  # Key administration stays with the account root / dedicated admins — NOT with the runtime role.
  statement {
    sid       = "KeyAdministration"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
    }
  }

  # Secrets Manager may use the key on behalf of a caller that is itself authorized.
  statement {
    sid    = "AllowSecretsManagerUse"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:Encrypt",
      "kms:GenerateDataKey",
      "kms:DescribeKey",
    ]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["secretsmanager.${var.region}.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "kms:CallerAccount"
      values   = [local.account_id]
    }
  }
}

resource "aws_kms_key" "secrets" {
  description             = "${local.prefix} operational secrets (Secrets Manager envelope encryption)"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.kms_secrets.json

  tags = { Name = "${local.prefix}-kms-secrets", Purpose = "secrets-manager" }
}

resource "aws_kms_alias" "secrets" {
  name          = "alias/${local.prefix}-secrets"
  target_key_id = aws_kms_key.secrets.key_id
}

resource "aws_kms_key" "database" {
  description             = "${local.prefix} RDS PostgreSQL storage + snapshot encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.kms_service_key["rds"].json

  tags = { Name = "${local.prefix}-kms-database", Purpose = "rds" }
}

resource "aws_kms_alias" "database" {
  name          = "alias/${local.prefix}-database"
  target_key_id = aws_kms_key.database.key_id
}

resource "aws_kms_key" "cache" {
  description             = "${local.prefix} ElastiCache at-rest encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.kms_service_key["elasticache"].json

  tags = { Name = "${local.prefix}-kms-cache", Purpose = "elasticache" }
}

resource "aws_kms_alias" "cache" {
  name          = "alias/${local.prefix}-cache"
  target_key_id = aws_kms_key.cache.key_id
}

resource "aws_kms_key" "logs" {
  description             = "${local.prefix} CloudWatch Logs encryption"
  deletion_window_in_days = 30
  enable_key_rotation     = true
  policy                  = data.aws_iam_policy_document.kms_logs.json

  tags = { Name = "${local.prefix}-kms-logs", Purpose = "cloudwatch-logs" }
}

data "aws_iam_policy_document" "kms_logs" {
  #checkov:skip=CKV_AWS_109:Key policy - see the note on kms_secrets.
  #checkov:skip=CKV_AWS_111:Key policy - see the note on kms_secrets.
  #checkov:skip=CKV_AWS_356:Key policy - see the note on kms_secrets.
  statement {
    sid       = "KeyAdministration"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
    }
  }

  # CloudWatch Logs must be able to encrypt/decrypt log group data.
  statement {
    sid    = "AllowCloudWatchLogs"
    effect = "Allow"
    actions = [
      "kms:Encrypt*",
      "kms:Decrypt*",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:Describe*",
    ]
    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["logs.${var.region}.amazonaws.com"]
    }

    condition {
      test     = "ArnLike"
      variable = "kms:EncryptionContext:aws:logs:arn"
      values   = ["arn:${local.partition}:logs:${var.region}:${local.account_id}:log-group:*"]
    }
  }
}

resource "aws_kms_alias" "logs" {
  name          = "alias/${local.prefix}-logs"
  target_key_id = aws_kms_key.logs.key_id
}

# ---------------------------------------------------------------------------
# Explicit key policies for the data-at-rest keys. The runtime role is deliberately NOT a principal:
# RDS and ElastiCache use these keys on the service's behalf, so no application identity needs Decrypt.
# ---------------------------------------------------------------------------

data "aws_iam_policy_document" "kms_service_key" {
  #checkov:skip=CKV_AWS_109:Key policy - resource scope of a key policy IS the key.
  #checkov:skip=CKV_AWS_111:Key policy - see above.
  #checkov:skip=CKV_AWS_356:Key policy - see above.
  for_each = toset(["rds", "elasticache"])

  statement {
    sid       = "KeyAdministration"
    effect    = "Allow"
    actions   = ["kms:*"]
    resources = ["*"]

    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
    }
  }

  statement {
    sid    = "AllowServiceUseOnBehalfOfAccount"
    effect = "Allow"

    actions = [
      "kms:Encrypt",
      "kms:Decrypt",
      "kms:ReEncrypt*",
      "kms:GenerateDataKey*",
      "kms:CreateGrant",
      "kms:DescribeKey",
    ]

    resources = ["*"]

    principals {
      type        = "Service"
      identifiers = ["${each.value}.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "kms:CallerAccount"
      values   = [local.account_id]
    }
  }
}
