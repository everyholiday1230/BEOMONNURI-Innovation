# ---------------------------------------------------------------------------
# ElastiCache (Redis OSS / Valkey compatible) — TLS in transit, auth token, at-rest encryption.
#
# The auth token is NOT declared here: passing `auth_token` through Terraform would put the value in
# state. The replication group is created with transit encryption + an auth token supplied at
# creation time by the operator runbook, and Terraform ignores subsequent changes to it.
# ---------------------------------------------------------------------------

resource "aws_elasticache_subnet_group" "main" {
  name        = "${local.prefix}-cache-subnets"
  subnet_ids  = local.private_subnet_ids
  description = "Private subnets for the managed cache"
}

resource "aws_elasticache_parameter_group" "main" {
  name        = "${local.prefix}-redis71"
  family      = "redis7"
  description = "Eviction + keyspace notification policy for gateway fan-out"

  # The cache holds short-lived data only; business ledgers live in PostgreSQL.
  parameter {
    name  = "maxmemory-policy"
    value = "volatile-lru"
  }
}

resource "aws_elasticache_replication_group" "main" {
  #checkov:skip=CKV_AWS_31: transit_encryption_enabled and at_rest_encryption_enabled ARE set. The
  #auth_token is intentionally absent from Terraform: passing it here would persist the token in
  #Terraform state. It is set out-of-band by the runbook and stored in quantumtrade/<env>/redis.
  replication_group_id = "${local.prefix}-cache"
  description          = "QuantumTrade cache / pub-sub fan-out / rate limiting"

  engine         = "redis"
  engine_version = var.redis_engine_version
  node_type      = var.redis_node_type
  port           = 6379

  num_node_groups            = 1
  replicas_per_node_group    = var.redis_replica_count
  automatic_failover_enabled = true
  multi_az_enabled           = true

  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.cache.id]
  parameter_group_name = aws_elasticache_parameter_group.main.name

  # Encryption: in transit (TLS) and at rest (customer-managed KMS).
  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.cache.arn

  # AUTH is required. The token value is set out-of-band (runbook) and stored in
  # quantumtrade/<env>/redis; Terraform must never hold it.
  auth_token_update_strategy = "ROTATE"

  snapshot_retention_limit   = 7
  snapshot_window            = "16:00-17:00" # 01:00-02:00 KST
  maintenance_window         = "sun:19:30-sun:20:30"
  apply_immediately          = false
  auto_minor_version_upgrade = true

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis_slow.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis_engine.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "engine-log"
  }

  tags = { Name = "${local.prefix}-cache" }

  lifecycle {
    # auth_token is owned by the runbook, not by Terraform.
    ignore_changes = [auth_token, auth_token_update_strategy]
  }
}
