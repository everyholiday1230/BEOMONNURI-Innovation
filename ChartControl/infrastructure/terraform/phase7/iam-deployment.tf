# ---------------------------------------------------------------------------
# DEPLOYMENT role — the CI/CD pipeline identity. Strictly separate from the runtime role.
#
# It may push images and roll a deployment. It may NOT read any operational secret value: a build
# pipeline never needs the BitMart or OpenAI credential, and keeping that boundary means a compromised
# pipeline cannot exfiltrate trading keys.
# ---------------------------------------------------------------------------

variable "deployment_oidc_provider_arn" {
  description = <<-EOT
    IAM OIDC provider ARN for the CI system (e.g. GitHub Actions token.actions.githubusercontent.com).
    Empty means the deployment role trusts the account root instead, for operator-driven deploys.
  EOT
  type        = string
  default     = ""
}

variable "deployment_oidc_subject" {
  description = "OIDC subject condition, e.g. repo:ORG/quantumtrade-ai:ref:refs/heads/main."
  type        = string
  default     = ""
}

data "aws_iam_policy_document" "deployment_assume" {
  dynamic "statement" {
    for_each = var.deployment_oidc_provider_arn == "" ? [1] : []

    content {
      sid     = "OperatorAssume"
      effect  = "Allow"
      actions = ["sts:AssumeRole"]

      principals {
        type        = "AWS"
        identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
      }

      # Human-driven deploys must be MFA-authenticated.
      condition {
        test     = "Bool"
        variable = "aws:MultiFactorAuthPresent"
        values   = ["true"]
      }
    }
  }

  dynamic "statement" {
    for_each = var.deployment_oidc_provider_arn == "" ? [] : [1]

    content {
      sid     = "CiOidcAssume"
      effect  = "Allow"
      actions = ["sts:AssumeRoleWithWebIdentity"]

      principals {
        type        = "Federated"
        identifiers = [var.deployment_oidc_provider_arn]
      }

      condition {
        test     = "StringEquals"
        variable = "token.actions.githubusercontent.com:aud"
        values   = ["sts.amazonaws.com"]
      }

      condition {
        test     = "StringLike"
        variable = "token.actions.githubusercontent.com:sub"
        values   = [var.deployment_oidc_subject]
      }
    }
  }
}

resource "aws_iam_role" "deployment" {
  name                 = "${local.prefix}-deployment"
  description          = "CI/CD deployment role: image push + rollout. No operational secret access."
  assume_role_policy   = data.aws_iam_policy_document.deployment_assume.json
  max_session_duration = 3600

  tags = { Name = "${local.prefix}-deployment", RoleType = "deployment" }
}

# tfsec AVD-AWS-0057 ("avoid wildcards in IAM policy") fires on `local.runtime_secret_arn_patterns`.
# The only wildcard there is the 6-character random suffix that Secrets Manager appends to EVERY
# secret ARN (`...:secret:<name>-XXXXXX`); pinning a named secret is impossible without it, and it is
# the pattern AWS documents. tfsec can only suppress at block granularity for a policy document, so
# the ignore below is coarser than the finding. Coverage is NOT lost: checkov independently lints this
# same document (CKV_AWS_356 / CKV_AWS_111 / CKV_AWS_109) and PASSES it, and the reviewed statement
# inventory is recorded in docs/PHASE7-03-SECRET-IAM-KMS.md.
#tfsec:ignore:AVD-AWS-0057
data "aws_iam_policy_document" "deployment" {
  statement {
    sid    = "PushApprovedImages"
    effect = "Allow"

    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:DescribeImages",
      "ecr:DescribeRepositories",
      "ecr:ListImages",
    ]

    resources = [aws_ecr_repository.api.arn, aws_ecr_repository.gateway.arn]
  }

  statement {
    sid       = "EcrAuthToken"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  # Roll out a new task definition revision (only when ECS is the deployment target).
  dynamic "statement" {
    for_each = var.deployment_target == "ecs_fargate" ? [1] : []

    content {
      sid    = "RollDeployment"
      effect = "Allow"

      actions = [
        "ecs:RegisterTaskDefinition",
        "ecs:DescribeTaskDefinition",
        "ecs:DescribeServices",
        "ecs:UpdateService",
        "ecs:ListTasks",
        "ecs:DescribeTasks",
      ]

      resources = ["*"] # ECS RegisterTaskDefinition is account-scoped; UpdateService is narrowed below
    }
  }

  dynamic "statement" {
    for_each = var.deployment_target == "ecs_fargate" ? [1] : []

    content {
      sid       = "PassOnlyRuntimeRoles"
      effect    = "Allow"
      actions   = ["iam:PassRole"]
      resources = [aws_iam_role.runtime.arn, aws_iam_role.task_execution[0].arn]

      condition {
        test     = "StringEquals"
        variable = "iam:PassedToService"
        values   = ["ecs-tasks.amazonaws.com"]
      }
    }
  }

  # The pipeline may confirm a secret EXISTS (deploy-time preflight) but never read a value.
  statement {
    sid    = "DescribeSecretsWithoutReading"
    effect = "Allow"
    # tfsec:ignore:AVD-AWS-0057 The only wildcard is the 6-character random suffix Secrets Manager
    # appends to every secret ARN (`...:secret:<name>-*`). This is the AWS-documented way to scope a
    # policy to a NAMED secret; the resource is not open. Each of the 7 patterns names one secret.
    actions   = ["secretsmanager:DescribeSecret"]
    resources = local.runtime_secret_arn_patterns
  }

  statement {
    sid    = "DenySecretValueAccessAndInfraControl"
    effect = "Deny"

    actions = [
      "secretsmanager:GetSecretValue",
      "secretsmanager:PutSecretValue",
      "secretsmanager:ListSecrets",
      "kms:Decrypt",
      "kms:Encrypt",
      "rds:*",
      "elasticache:*",
      "route53:*",
      "acm:*",
      "iam:CreateUser",
      "iam:CreateAccessKey",
      "iam:AttachRolePolicy",
      "iam:PutRolePolicy",
    ]

    resources = ["*"]
  }
}

resource "aws_iam_policy" "deployment" {
  name        = "${local.prefix}-deployment"
  description = "Image push + rollout only; explicit deny on secret value access and infra control plane"
  policy      = data.aws_iam_policy_document.deployment.json
}

resource "aws_iam_role_policy_attachment" "deployment" {
  role       = aws_iam_role.deployment.name
  policy_arn = aws_iam_policy.deployment.arn
}

# ---------------------------------------------------------------------------
# ECS task execution role (image pull + log write only) — used when deployment_target = ecs_fargate.
# Separate from the TASK role (aws_iam_role.runtime) which holds the application's own permissions.
# ---------------------------------------------------------------------------

resource "aws_iam_role" "task_execution" {
  count = var.deployment_target == "ecs_fargate" ? 1 : 0

  name               = "${local.prefix}-task-execution"
  description        = "ECS agent: pull the image and write container logs"
  assume_role_policy = data.aws_iam_policy_document.task_execution_assume[0].json

  tags = { Name = "${local.prefix}-task-execution", RoleType = "task-execution" }
}

data "aws_iam_policy_document" "task_execution_assume" {
  count = var.deployment_target == "ecs_fargate" ? 1 : 0

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  count = var.deployment_target == "ecs_fargate" ? 1 : 0

  role       = aws_iam_role.task_execution[0].name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}
