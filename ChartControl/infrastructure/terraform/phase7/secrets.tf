# ---------------------------------------------------------------------------
# Secrets Manager — SEVEN separate secrets, one per purpose (Phase 7 §4).
#
# CRITICAL: this configuration creates the secret CONTAINERS only. It deliberately declares no
# `aws_secretsmanager_secret_version`, so no secret value is ever passed through Terraform, written
# to a plan file, or persisted in Terraform state. The values are populated out-of-band by the
# account owner (see README.md §"Populating secret values") and Terraform ignores them thereafter.
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "operational" {
  #checkov:skip=CKV2_AWS_57: Automatic rotation is deliberately NOT enabled. Rotating the BitMart and
  #OpenAI credentials requires an out-of-band action in each provider dashboard, so a Lambda rotator
  #would fail and mask the real process; the DB master credential is rotated by RDS itself
  #(manage_master_user_password). Manual rotation procedure + cadence: docs/PHASE7-03-SECRET-IAM-KMS.md.
  #A rotation failure raises the secret_rotation_failure alarm.
  for_each = local.secrets

  name        = each.value.name
  description = each.value.description
  kms_key_id  = aws_kms_key.secrets.arn

  # Deleting a production credential must never be a one-command mistake.
  recovery_window_in_days = 30

  tags = {
    Name    = each.value.name
    Purpose = each.key
    # Documents the expected JSON shape for reviewers. Field NAMES only — never values.
    SchemaFields = join(",", each.value.fields)
  }
}

# The value lifecycle is owned outside Terraform. Guard against a future edit accidentally
# introducing a version resource: any `secret_string` handling belongs in the runbook, not here.
resource "aws_secretsmanager_secret_policy" "operational" {
  for_each = local.secrets

  secret_arn = aws_secretsmanager_secret.operational[each.key].arn
  policy     = data.aws_iam_policy_document.secret_resource_policy[each.key].json
}

data "aws_iam_policy_document" "secret_resource_policy" {
  for_each = local.secrets

  # Resource-side allowlist: only the runtime role may read the value. Defence in depth alongside the
  # identity policy in iam-runtime.tf — a mis-scoped identity policy alone cannot grant access.
  statement {
    sid    = "AllowRuntimeRoleRead"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.runtime.arn]
    }

    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = ["*"] # resource policy scope IS this secret; "*" here means "this secret"
  }

  # Explicitly deny value reads over a non-TLS transport.
  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "AWS"
      identifiers = ["*"]
    }

    actions   = ["secretsmanager:*"]
    resources = ["*"]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

# Rotation is intentionally NOT automated here: BitMart and OpenAI key rotation requires an
# out-of-band dashboard action, so a Lambda rotator would fail closed and mask the real process.
# The runbook (docs/PHASE7-03-SECRET-IAM-KMS.md) defines the manual rotation procedure and cadence.
