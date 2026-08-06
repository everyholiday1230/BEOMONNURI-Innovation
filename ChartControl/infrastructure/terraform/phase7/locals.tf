data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  prefix     = "${var.name_prefix}-${var.environment}"

  # Secrets Manager path prefix. Each purpose gets its OWN secret — never a combined blob.
  secret_prefix = "${var.name_prefix}/${var.environment}"

  # The seven operational secrets required by Phase 7 §4. `key` is the map key used by Terraform;
  # `name` is the Secrets Manager name the application resolves by ARN.
  secrets = {
    bitmart = {
      name        = "${local.secret_prefix}/bitmart/trading-api"
      description = "BitMart production trading API credential (fields: accessKey, secretKey, memo)"
      fields      = ["accessKey", "secretKey", "memo"]
    }
    openai = {
      name        = "${local.secret_prefix}/openai/api"
      description = "OpenAI production API credential (fields: apiKey, optional projectId/organizationId)"
      fields      = ["apiKey"]
    }
    session_csrf = {
      name        = "${local.secret_prefix}/app/session-csrf"
      description = "Application session + CSRF signing key (field: csrfKey)"
      fields      = ["csrfKey"]
    }
    postgres = {
      name        = "${local.secret_prefix}/db/postgres"
      description = "Managed PostgreSQL application credential (fields: username, password, database)"
      fields      = ["username", "password", "database"]
    }
    redis = {
      name        = "${local.secret_prefix}/redis"
      description = "ElastiCache auth token (field: authToken)"
      fields      = ["authToken"]
    }
    mfa = {
      name        = "${local.secret_prefix}/mfa/encryption-key"
      description = "MFA secret encryption key (field: kek, base64 32 bytes)"
      fields      = ["kek"]
    }
    audit = {
      name        = "${local.secret_prefix}/audit/integrity-key"
      description = "Audit log integrity (HMAC) key (field: integrityKey)"
      fields      = ["integrityKey"]
    }
  }

  vpc_id             = var.create_network ? aws_vpc.main[0].id : var.existing_vpc_id
  private_subnet_ids = var.create_network ? [for s in aws_subnet.private : s.id] : var.existing_private_subnet_ids

  # Secret ARNs carry a random 6-character suffix. Runtime IAM statements therefore use a
  # `<arn>-*` wildcard on the SUFFIX ONLY — this is resource-scoped, not a blanket `*`.
  runtime_secret_arn_patterns = [for k, v in local.secrets : "arn:${local.partition}:secretsmanager:${var.region}:${local.account_id}:secret:${v.name}-*"]
}
