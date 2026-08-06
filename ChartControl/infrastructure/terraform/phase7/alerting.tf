# ---------------------------------------------------------------------------
# Alerting — one encrypted SNS topic, subscriptions supplied by variable.
#
# Slack / PagerDuty integration keys are NOT stored here. Only the endpoint URL is passed in; the
# shared key belongs in Secrets Manager. An HTTPS subscription must be confirmed out-of-band.
# ---------------------------------------------------------------------------

resource "aws_sns_topic" "alerts" {
  name              = "${local.prefix}-alerts"
  display_name      = "QuantumTrade ${var.environment} alerts"
  kms_master_key_id = aws_kms_key.logs.arn

  tags = { Name = "${local.prefix}-alerts" }
}

data "aws_iam_policy_document" "alerts_topic" {
  statement {
    sid    = "AllowCloudWatchAlarmsPublish"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudwatch.amazonaws.com"]
    }

    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceOwner"
      values   = [local.account_id]
    }
  }

  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "AWS"
      identifiers = ["*"]
    }

    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.alerts.arn]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_sns_topic_policy" "alerts" {
  arn    = aws_sns_topic.alerts.arn
  policy = data.aws_iam_policy_document.alerts_topic.json
}

resource "aws_sns_topic_subscription" "alerts_email" {
  for_each = toset(var.alert_email_subscriptions)

  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = each.value
}

resource "aws_sns_topic_subscription" "alerts_https" {
  for_each = toset(var.alert_https_subscriptions)

  topic_arn              = aws_sns_topic.alerts.arn
  protocol               = "https"
  endpoint               = each.value
  endpoint_auto_confirms = false
}

# ---------------------------------------------------------------------------
# Alarms. Each alarm carries a runbook link in its description so the on-call engineer has the
# procedure in the notification itself. `treat_missing_data = "notBreaching"` is used only where an
# absent metric genuinely means "nothing happened" — never for availability signals.
# ---------------------------------------------------------------------------

locals {
  runbook_base = "docs/PHASE7-16-INCIDENT-RESPONSE.md"

  app_alarms = {
    api_5xx = {
      metric      = "http_5xx_total"
      statistic   = "Sum"
      threshold   = 10
      period      = 60
      evaluation  = 2
      description = "API 5xx responses elevated. Runbook: ${local.runbook_base}#api-5xx"
      missing     = "notBreaching"
    }
    auth_failures = {
      metric      = "auth_failure_total"
      statistic   = "Sum"
      threshold   = 50
      period      = 300
      evaluation  = 1
      description = "Authentication failures elevated (credential stuffing?). Runbook: ${local.runbook_base}#auth-failures"
      missing     = "notBreaching"
    }
    mfa_lockouts = {
      metric      = "mfa_lockout_total"
      statistic   = "Sum"
      threshold   = 5
      period      = 300
      evaluation  = 1
      description = "MFA lockouts elevated. Runbook: ${local.runbook_base}#mfa-lockout"
      missing     = "notBreaching"
    }
    db_pool_exhausted = {
      metric      = "db_pool_exhausted_total"
      statistic   = "Sum"
      threshold   = 1
      period      = 60
      evaluation  = 1
      description = "Database connection pool exhausted. Runbook: ${local.runbook_base}#db-pool"
      missing     = "notBreaching"
    }
    redis_connect_failures = {
      metric      = "redis_connect_failure_total"
      statistic   = "Sum"
      threshold   = 1
      period      = 60
      evaluation  = 2
      description = "Cache connection failures. Runbook: ${local.runbook_base}#redis"
      missing     = "notBreaching"
    }
    ws_reconnect_storm = {
      metric      = "ws_reconnect_total"
      statistic   = "Sum"
      threshold   = 500
      period      = 300
      evaluation  = 1
      description = "WebSocket reconnect storm. Runbook: ${local.runbook_base}#ws-reconnect"
      missing     = "notBreaching"
    }
    market_data_stale = {
      metric      = "market_data_stale_seconds"
      statistic   = "Maximum"
      threshold   = 30
      period      = 60
      evaluation  = 2
      description = "Market data stale. Runbook: ${local.runbook_base}#market-data-stale"
      missing     = "breaching"
    }
    reconciliation_mismatch = {
      metric      = "reconciliation_mismatch_total"
      statistic   = "Sum"
      threshold   = 1
      period      = 300
      evaluation  = 1
      description = "REST/WS reconciliation mismatch. Runbook: ${local.runbook_base}#reconciliation"
      missing     = "notBreaching"
    }
    bitmart_auth_failure = {
      metric      = "bitmart_auth_failure_total"
      statistic   = "Sum"
      threshold   = 1
      period      = 300
      evaluation  = 1
      description = "Exchange authentication failure (key/IP allowlist?). Runbook: ${local.runbook_base}#exchange-auth"
      missing     = "notBreaching"
    }
    openai_errors = {
      metric      = "openai_error_total"
      statistic   = "Sum"
      threshold   = 20
      period      = 300
      evaluation  = 1
      description = "AI provider errors elevated. Runbook: ${local.runbook_base}#ai-provider"
      missing     = "notBreaching"
    }
    ai_budget_exceeded = {
      metric      = "ai_budget_exceeded_total"
      statistic   = "Sum"
      threshold   = 1
      period      = 300
      evaluation  = 1
      description = "AI cost budget exceeded. Runbook: ${local.runbook_base}#ai-budget"
      missing     = "notBreaching"
    }
    queue_depth = {
      metric      = "queue_depth"
      statistic   = "Maximum"
      threshold   = 10000
      period      = 60
      evaluation  = 2
      description = "Fan-out queue depth growing. Runbook: ${local.runbook_base}#queue-depth"
      missing     = "notBreaching"
    }
    container_restarts = {
      metric      = "container_restart_total"
      statistic   = "Sum"
      threshold   = 3
      period      = 300
      evaluation  = 1
      description = "Container restart loop. Runbook: ${local.runbook_base}#restart-loop"
      missing     = "notBreaching"
    }
    kill_switch_change = {
      metric      = "kill_switch_change_total"
      statistic   = "Sum"
      threshold   = 1
      period      = 60
      evaluation  = 1
      description = "Kill switch state changed — always paged. Runbook: ${local.runbook_base}#kill-switch"
      missing     = "notBreaching"
    }
    live_trading_flag_change = {
      metric      = "live_trading_flag_change_total"
      statistic   = "Sum"
      threshold   = 1
      period      = 60
      evaluation  = 1
      description = "Live-trading flag changed — always paged. Runbook: ${local.runbook_base}#live-trading-flag"
      missing     = "notBreaching"
    }
    admin_role_change = {
      metric      = "admin_role_change_total"
      statistic   = "Sum"
      threshold   = 1
      period      = 300
      evaluation  = 1
      description = "Admin role changed. Runbook: ${local.runbook_base}#admin-role-change"
      missing     = "notBreaching"
    }
    secret_rotation_failure = {
      metric      = "secret_rotation_failure_total"
      statistic   = "Sum"
      threshold   = 1
      period      = 3600
      evaluation  = 1
      description = "Secret rotation failed. Runbook: ${local.runbook_base}#secret-rotation"
      missing     = "notBreaching"
    }
    release_gate_change = {
      metric      = "release_gate_change_total"
      statistic   = "Sum"
      threshold   = 1
      period      = 300
      evaluation  = 1
      description = "Release gate state changed. Runbook: ${local.runbook_base}#release-gate"
      missing     = "notBreaching"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "app" {
  for_each = local.app_alarms

  alarm_name          = "${local.prefix}-${each.key}"
  alarm_description   = each.value.description
  namespace           = "QuantumTrade/${var.environment}"
  metric_name         = each.value.metric
  statistic           = each.value.statistic
  period              = each.value.period
  evaluation_periods  = each.value.evaluation
  threshold           = each.value.threshold
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = each.value.missing

  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]

  tags = { Name = "${local.prefix}-${each.key}" }
}

# Infrastructure-side alarms sourced from AWS-published metrics.
resource "aws_cloudwatch_metric_alarm" "rds_free_storage" {
  alarm_name          = "${local.prefix}-rds-free-storage"
  alarm_description   = "RDS free storage low. Runbook: ${local.runbook_base}#rds-storage"
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 10737418240 # 10 GiB
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  dimensions    = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = { Name = "${local.prefix}-rds-free-storage" }
}

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${local.prefix}-rds-cpu"
  alarm_description   = "RDS CPU sustained high. Runbook: ${local.runbook_base}#rds-cpu"
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 85
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"

  dimensions    = { DBInstanceIdentifier = aws_db_instance.main.identifier }
  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = { Name = "${local.prefix}-rds-cpu" }
}

resource "aws_cloudwatch_metric_alarm" "redis_memory" {
  alarm_name          = "${local.prefix}-redis-memory"
  alarm_description   = "Cache memory pressure. Runbook: ${local.runbook_base}#redis-memory"
  namespace           = "AWS/ElastiCache"
  metric_name         = "DatabaseMemoryUsagePercentage"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 2
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "breaching"

  dimensions    = { ReplicationGroupId = aws_elasticache_replication_group.main.replication_group_id }
  alarm_actions = [aws_sns_topic.alerts.arn]

  tags = { Name = "${local.prefix}-redis-memory" }
}
