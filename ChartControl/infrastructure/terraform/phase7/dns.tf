# ---------------------------------------------------------------------------
# OPTIONAL DNS / TLS module. Disabled by default (enable_dns = false) so `terraform validate` and the
# static scans run without a hosted zone or a real domain.
#
# When enabled this provisions: an ACM certificate with DNS validation, the validation records, an
# internet-facing HTTPS load balancer with a modern TLS policy, and the alias record.
# ---------------------------------------------------------------------------

resource "aws_acm_certificate" "main" {
  count = var.enable_dns ? 1 : 0

  domain_name       = var.domain_name
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = { Name = "${local.prefix}-cert" }
}

resource "aws_route53_record" "cert_validation" {
  for_each = var.enable_dns ? {
    for dvo in aws_acm_certificate.main[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  zone_id         = var.route53_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "main" {
  count = var.enable_dns ? 1 : 0

  certificate_arn         = aws_acm_certificate.main[0].arn
  validation_record_fqdns = [for r in aws_route53_record.cert_validation : r.fqdn]
}

resource "aws_lb" "main" {
  #checkov:skip=CKV2_AWS_28: No WAF web ACL is attached in this module. The public entry point only
  #exists when enable_dns = true, which is off for the Phase 7 Stage 0 baseline. Attaching a WAF is
  #tracked as a Phase 7 Stage 4 item in docs/PHASE7-19-KNOWN-ISSUES.md.
  count = var.enable_dns ? 1 : 0

  name                       = "${local.prefix}-alb"
  internal                   = false
  load_balancer_type         = "application"
  security_groups            = [aws_security_group.alb[0].id]
  subnets                    = [for s in aws_subnet.public : s.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = true

  # Access logs are required evidence for the Stage 4 live security checks (TLS, headers, injection
  # attempts) and for incident reconstruction.
  access_logs {
    bucket  = aws_s3_bucket.alb_logs[0].id
    prefix  = "alb"
    enabled = true
  }

  tags = { Name = "${local.prefix}-alb" }
}

# ---------------------------------------------------------------------------
# ALB access-log bucket. Encrypted, versioned, public access fully blocked, lifecycle-expired.
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "alb_logs" {
  #checkov:skip=CKV_AWS_145:ELB access-log delivery cannot write to a bucket encrypted with a
  #customer-managed KMS key — AWS supports SSE-S3 (AES256) only for this log type. SSE-S3 IS enabled
  #in aws_s3_bucket_server_side_encryption_configuration.alb_logs below.
  #checkov:skip=CKV_AWS_18:This IS the access-log bucket. Enabling server access logging on it would
  #create a self-referential log loop; the bucket is the sink, not a data bucket.
  #checkov:skip=CKV_AWS_144:Cross-region replication is not warranted for load-balancer access logs:
  #they are operational telemetry with a 400-day lifecycle, not a system of record. The audit trail
  #that does need durability lives in the audit CloudWatch log group and PostgreSQL.
  #checkov:skip=CKV2_AWS_62:Event notifications are unnecessary — nothing consumes these objects on
  #write. Analysis is on-demand (Athena/manual) during an investigation.
  count = var.enable_dns ? 1 : 0

  bucket        = "${local.prefix}-alb-logs-${local.account_id}"
  force_destroy = false

  tags = { Name = "${local.prefix}-alb-logs" }
}

resource "aws_s3_bucket_public_access_block" "alb_logs" {
  count = var.enable_dns ? 1 : 0

  bucket                  = aws_s3_bucket.alb_logs[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "alb_logs" {
  count = var.enable_dns ? 1 : 0

  bucket = aws_s3_bucket.alb_logs[0].id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "alb_logs" {
  count = var.enable_dns ? 1 : 0

  bucket = aws_s3_bucket.alb_logs[0].id

  rule {
    apply_server_side_encryption_by_default {
      # ELB access-log delivery supports SSE-S3 (AES256) only; it cannot use a customer-managed key.
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "alb_logs" {
  count = var.enable_dns ? 1 : 0

  bucket = aws_s3_bucket.alb_logs[0].id

  rule {
    id     = "expire-access-logs"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    expiration {
      days = 400
    }
  }
}

data "aws_elb_service_account" "main" {
  count = var.enable_dns ? 1 : 0
}

data "aws_iam_policy_document" "alb_logs" {
  count = var.enable_dns ? 1 : 0

  statement {
    sid    = "AllowELBLogDelivery"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = [data.aws_elb_service_account.main[0].arn]
    }

    actions   = ["s3:PutObject"]
    resources = ["${aws_s3_bucket.alb_logs[0].arn}/alb/AWSLogs/${local.account_id}/*"]
  }

  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "AWS"
      identifiers = ["*"]
    }

    actions   = ["s3:*"]
    resources = [aws_s3_bucket.alb_logs[0].arn, "${aws_s3_bucket.alb_logs[0].arn}/*"]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "alb_logs" {
  count = var.enable_dns ? 1 : 0

  bucket = aws_s3_bucket.alb_logs[0].id
  policy = data.aws_iam_policy_document.alb_logs[0].json
}

resource "aws_lb_target_group" "api" {
  count = var.enable_dns ? 1 : 0

  name        = "${local.prefix}-api-tg"
  port        = var.api_container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = local.vpc_id

  health_check {
    path                = "/health/ready"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  deregistration_delay = 30

  tags = { Name = "${local.prefix}-api-tg" }
}

resource "aws_lb_listener" "https" {
  count = var.enable_dns ? 1 : 0

  load_balancer_arn = aws_lb.main[0].arn
  port              = 443
  protocol          = "HTTPS"
  # TLS 1.2+ only, forward secrecy.
  ssl_policy      = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn = aws_acm_certificate_validation.main[0].certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api[0].arn
  }
}

# Plain HTTP exists only to redirect; it never serves application traffic.
resource "aws_lb_listener" "http_redirect" {
  count = var.enable_dns ? 1 : 0

  load_balancer_arn = aws_lb.main[0].arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_route53_record" "app" {
  count = var.enable_dns ? 1 : 0

  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_lb.main[0].dns_name
    zone_id                = aws_lb.main[0].zone_id
    evaluate_target_health = true
  }
}
