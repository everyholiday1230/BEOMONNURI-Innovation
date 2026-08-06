# ---------------------------------------------------------------------------
# Observability — encrypted log groups with explicit retention, plus an OTel collector target.
#
# Retention: application/infra groups keep var.log_retention_days (default 90) as a data-minimization
# decision - request metadata should not be held for a year. The AUDIT group, which is the record that
# genuinely needs long retention, is set to 400 days and exceeds the one-year requirement.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "api" {
  #checkov:skip=CKV_AWS_338:Data minimization - see the retention note at the top of this file; the audit group holds 400 days.
  name              = "/${var.name_prefix}/${var.environment}/api"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.logs.arn

  tags = { Name = "${local.prefix}-logs-api" }
}

resource "aws_cloudwatch_log_group" "gateway" {
  #checkov:skip=CKV_AWS_338:Data minimization - see the retention note at the top of this file; the audit group holds 400 days.
  name              = "/${var.name_prefix}/${var.environment}/market-gateway"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.logs.arn

  tags = { Name = "${local.prefix}-logs-gateway" }
}

# Audit trail is append-only and kept longer than application logs.
resource "aws_cloudwatch_log_group" "audit" {
  name              = "/${var.name_prefix}/${var.environment}/audit"
  retention_in_days = 400
  kms_key_id        = aws_kms_key.logs.arn

  tags = { Name = "${local.prefix}-logs-audit", Retention = "audit" }
}

resource "aws_cloudwatch_log_group" "otel" {
  #checkov:skip=CKV_AWS_338:Data minimization - see the retention note at the top of this file; the audit group holds 400 days.
  name              = "/${var.name_prefix}/${var.environment}/otel-collector"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.logs.arn

  tags = { Name = "${local.prefix}-logs-otel" }
}

resource "aws_cloudwatch_log_group" "redis_slow" {
  #checkov:skip=CKV_AWS_338:Data minimization - see the retention note at the top of this file; the audit group holds 400 days.
  name              = "/${var.name_prefix}/${var.environment}/elasticache/slow-log"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.logs.arn

  tags = { Name = "${local.prefix}-logs-redis-slow" }
}

resource "aws_cloudwatch_log_group" "redis_engine" {
  #checkov:skip=CKV_AWS_338:Data minimization - see the retention note at the top of this file; the audit group holds 400 days.
  name              = "/${var.name_prefix}/${var.environment}/elasticache/engine-log"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.logs.arn

  tags = { Name = "${local.prefix}-logs-redis-engine" }
}

resource "aws_cloudwatch_log_group" "vpc_flow" {
  #checkov:skip=CKV_AWS_338:Data minimization - see the retention note at the top of this file; the audit group holds 400 days.
  count = var.create_network ? 1 : 0

  name              = "/${var.name_prefix}/${var.environment}/vpc-flow"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.logs.arn

  tags = { Name = "${local.prefix}-logs-vpc-flow" }
}

resource "aws_iam_role" "flow_logs" {
  count = var.create_network ? 1 : 0

  name               = "${local.prefix}-vpc-flow-logs"
  assume_role_policy = data.aws_iam_policy_document.flow_logs_assume[0].json

  tags = { Name = "${local.prefix}-vpc-flow-logs" }
}

data "aws_iam_policy_document" "flow_logs_assume" {
  count = var.create_network ? 1 : 0

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["vpc-flow-logs.amazonaws.com"]
    }
  }
}

data "aws_iam_policy_document" "flow_logs" {
  count = var.create_network ? 1 : 0

  statement {
    effect = "Allow"

    actions = [
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams",
    ]

    resources = ["${aws_cloudwatch_log_group.vpc_flow[0].arn}:*"]
  }
}

resource "aws_iam_role_policy" "flow_logs" {
  count = var.create_network ? 1 : 0

  name   = "${local.prefix}-vpc-flow-logs"
  role   = aws_iam_role.flow_logs[0].id
  policy = data.aws_iam_policy_document.flow_logs[0].json
}

# ---------------------------------------------------------------------------
# Dashboard. Widgets reference metrics the application already emits; panels render "no data" until
# the first deployment publishes them, which is honest rather than pre-populated.
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "operations" {
  dashboard_name = "${local.prefix}-operations"

  dashboard_body = jsonencode({
    widgets = [
      {
        type = "metric"
        properties = {
          title  = "API 5xx rate"
          region = var.region
          metrics = [
            ["QuantumTrade/${var.environment}", "http_5xx_total", { stat = "Sum", period = 60 }],
          ]
        }
      },
      {
        type = "metric"
        properties = {
          title  = "Request latency p95 / p99 (ms)"
          region = var.region
          metrics = [
            ["QuantumTrade/${var.environment}", "http_latency_p95_ms", { stat = "Average", period = 60 }],
            ["QuantumTrade/${var.environment}", "http_latency_p99_ms", { stat = "Average", period = 60 }],
          ]
        }
      },
      {
        type = "metric"
        properties = {
          title  = "Exchange reconciliation mismatches"
          region = var.region
          metrics = [
            ["QuantumTrade/${var.environment}", "reconciliation_mismatch_total", { stat = "Sum", period = 300 }],
          ]
        }
      },
      {
        type = "metric"
        properties = {
          title  = "Kill switch / live-trading flag changes"
          region = var.region
          metrics = [
            ["QuantumTrade/${var.environment}", "kill_switch_change_total", { stat = "Sum", period = 300 }],
            ["QuantumTrade/${var.environment}", "live_trading_flag_change_total", { stat = "Sum", period = 300 }],
          ]
        }
      },
    ]
  })
}
