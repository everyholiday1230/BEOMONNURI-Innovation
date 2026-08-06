# ---------------------------------------------------------------------------
# Container deployment target. Only provisioned when deployment_target = "ecs_fargate".
# The Stage 0 runtime was a plain EC2 host, so "external" is the default and this file is inert then.
#
# Secrets are injected by REFERENCE (valueFrom = secret ARN). No secret value passes through the task
# definition, the Terraform plan, or the state file.
# ---------------------------------------------------------------------------

resource "aws_ecs_cluster" "main" {
  count = var.deployment_target == "ecs_fargate" ? 1 : 0

  name = "${local.prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = { Name = "${local.prefix}-cluster" }
}

resource "aws_ecs_task_definition" "api" {
  count = var.deployment_target == "ecs_fargate" ? 1 : 0

  family                   = "${local.prefix}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = aws_iam_role.task_execution[0].arn
  task_role_arn            = aws_iam_role.runtime.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name = "api"
      # Digest-pinned at deploy time by the pipeline; the tag here is a placeholder that the rollout
      # replaces with `<repo>@sha256:...`. IMMUTABLE tags make the digest authoritative either way.
      image     = "${aws_ecr_repository.api.repository_url}:REPLACED_BY_DEPLOYMENT_WITH_DIGEST"
      essential = true

      portMappings = [{ containerPort = var.api_container_port, protocol = "tcp" }]

      readonlyRootFilesystem = true
      user                   = "10001:10001"

      linuxParameters = {
        initProcessEnabled = true
        capabilities       = { drop = ["ALL"] }
      }

      # Non-secret configuration only. Modes are pinned to the Phase 7 read-only posture.
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "AWS_REGION", value = var.region },
        { name = "API_HOST", value = "0.0.0.0" },
        { name = "API_PORT", value = tostring(var.api_container_port) },
        { name = "BITMART_MODE", value = "BITMART_LIVE_READ_ONLY" },
        { name = "BITMART_LIVE_TRADING_ENABLED", value = "false" },
        { name = "BITMART_EMERGENCY_KILL_SWITCH", value = "true" },
        { name = "BITMART_SECRET_ARN", value = aws_secretsmanager_secret.operational["bitmart"].arn },
        { name = "OPENAI_SECRET_ARN", value = aws_secretsmanager_secret.operational["openai"].arn },
      ]

      # Injected by reference — the values never appear in this document.
      secrets = [
        { name = "AUTH_CSRF_KEY", valueFrom = "${aws_secretsmanager_secret.operational["session_csrf"].arn}:csrfKey::" },
        { name = "DATABASE_URL", valueFrom = "${aws_secretsmanager_secret.operational["postgres"].arn}:url::" },
        { name = "REDIS_AUTH_TOKEN", valueFrom = "${aws_secretsmanager_secret.operational["redis"].arn}:authToken::" },
        { name = "MFA_KEK", valueFrom = "${aws_secretsmanager_secret.operational["mfa"].arn}:kek::" },
        { name = "AUDIT_INTEGRITY_KEY", valueFrom = "${aws_secretsmanager_secret.operational["audit"].arn}:integrityKey::" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "api"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:'+(process.env.API_PORT||8787)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 20
      }

      stopTimeout = 30
    }
  ])

  tags = { Name = "${local.prefix}-api-task" }
}

resource "aws_ecs_service" "api" {
  count = var.deployment_target == "ecs_fargate" ? 1 : 0

  name            = "${local.prefix}-api"
  cluster         = aws_ecs_cluster.main[0].id
  task_definition = aws_ecs_task_definition.api[0].arn
  desired_count   = 2
  launch_type     = "FARGATE"

  # Rolling deployment with circuit breaker + automatic rollback.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = local.private_subnet_ids
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  dynamic "load_balancer" {
    for_each = var.enable_dns ? [1] : []

    content {
      target_group_arn = aws_lb_target_group.api[0].arn
      container_name   = "api"
      container_port   = var.api_container_port
    }
  }

  enable_execute_command = false

  lifecycle {
    # The pipeline rolls new task definition revisions; Terraform must not fight it.
    ignore_changes = [task_definition, desired_count]
  }

  tags = { Name = "${local.prefix}-api-service" }
}
