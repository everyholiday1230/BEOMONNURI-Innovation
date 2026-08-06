# ---------------------------------------------------------------------------
# Outputs. ARNs and endpoints only — no secret value is ever an output.
# ---------------------------------------------------------------------------

output "region" {
  description = "Region all resources live in."
  value       = var.region
}

output "runtime_role_arn" {
  description = "IAM role the API/Gateway process assumes."
  value       = aws_iam_role.runtime.arn
}

output "runtime_instance_profile_name" {
  description = "Instance profile for an EC2-based runtime."
  value       = aws_iam_instance_profile.runtime.name
}

output "deployment_role_arn" {
  description = "IAM role the CI/CD pipeline assumes (push + rollout only)."
  value       = aws_iam_role.deployment.arn
}

output "secret_arns" {
  description = <<-EOT
    ARNs of the seven operational secrets, keyed by purpose. These are the values to inject as
    BITMART_SECRET_ARN / OPENAI_SECRET_ARN etc. ARNs are identifiers, not credentials.
  EOT
  value       = { for k, v in aws_secretsmanager_secret.operational : k => v.arn }
}

output "kms_key_arns" {
  description = "Customer-managed KMS keys by purpose."
  value = {
    secrets  = aws_kms_key.secrets.arn
    database = aws_kms_key.database.arn
    cache    = aws_kms_key.cache.arn
    logs     = aws_kms_key.logs.arn
  }
}

output "ecr_repository_urls" {
  description = "Registry URLs for digest-pinned deployment."
  value = {
    api     = aws_ecr_repository.api.repository_url
    gateway = aws_ecr_repository.gateway.repository_url
  }
}

output "postgres_endpoint" {
  description = "Managed PostgreSQL endpoint (host:port). Credentials come from Secrets Manager."
  value       = aws_db_instance.main.endpoint
}

output "postgres_master_secret_arn" {
  description = "RDS-managed master user secret ARN (managed by RDS, not by Terraform)."
  value       = try(aws_db_instance.main.master_user_secret[0].secret_arn, null)
}

output "postgres_pitr" {
  description = "Backup/PITR posture of the primary database."
  value = {
    backup_retention_days = aws_db_instance.main.backup_retention_period
    multi_az              = aws_db_instance.main.multi_az
    storage_encrypted     = aws_db_instance.main.storage_encrypted
    deletion_protection   = aws_db_instance.main.deletion_protection
  }
}

output "redis_primary_endpoint" {
  description = "ElastiCache primary endpoint (TLS required, AUTH required)."
  value       = aws_elasticache_replication_group.main.primary_endpoint_address
}

output "redis_reader_endpoint" {
  description = "ElastiCache reader endpoint."
  value       = aws_elasticache_replication_group.main.reader_endpoint_address
}

output "fixed_egress_ip" {
  description = "NAT Elastic IP — the address to register in the exchange IP allowlist."
  value       = var.create_network ? aws_eip.nat[0].public_ip : var.fixed_egress_ip
}

output "log_group_names" {
  description = "CloudWatch log groups."
  value = {
    api     = aws_cloudwatch_log_group.api.name
    gateway = aws_cloudwatch_log_group.gateway.name
    audit   = aws_cloudwatch_log_group.audit.name
    otel    = aws_cloudwatch_log_group.otel.name
  }
}

output "alert_topic_arn" {
  description = "SNS topic every alarm publishes to."
  value       = aws_sns_topic.alerts.arn
}

output "dashboard_name" {
  description = "Operations dashboard."
  value       = aws_cloudwatch_dashboard.operations.dashboard_name
}

output "runtime_environment_template" {
  description = <<-EOT
    Environment variables to inject into the runtime. ARNs and modes only — no secret values.
    Live trading stays disabled and the kill switch stays engaged at this stage.
  EOT
  value = {
    AWS_REGION                    = var.region
    NODE_ENV                      = "production"
    BITMART_SECRET_ARN            = aws_secretsmanager_secret.operational["bitmart"].arn
    OPENAI_SECRET_ARN             = aws_secretsmanager_secret.operational["openai"].arn
    BITMART_MODE                  = "BITMART_LIVE_READ_ONLY"
    BITMART_LIVE_TRADING_ENABLED  = "false"
    BITMART_EMERGENCY_KILL_SWITCH = "true"
  }
}
