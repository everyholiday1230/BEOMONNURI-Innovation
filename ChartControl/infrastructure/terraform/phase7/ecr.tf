# ---------------------------------------------------------------------------
# ECR — immutable tags so every deployment is pinned by digest.
# ---------------------------------------------------------------------------

# image_tag_mutability comes from var.ecr_image_tag_mutability, whose validation block rejects any
# value other than "IMMUTABLE" (variables.tf). Semgrep cannot resolve the variable and assumes MUTABLE.
# nosemgrep: terraform.aws.security.aws-ecr-mutable-image-tags.aws-ecr-mutable-image-tags
resource "aws_ecr_repository" "api" {
  name                 = "${local.prefix}/api"
  image_tag_mutability = var.ecr_image_tag_mutability
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.secrets.arn
  }

  tags = { Name = "${local.prefix}-ecr-api" }
}

# Same as above: the value is variable-validated to IMMUTABLE.
# nosemgrep: terraform.aws.security.aws-ecr-mutable-image-tags.aws-ecr-mutable-image-tags
resource "aws_ecr_repository" "gateway" {
  name                 = "${local.prefix}/market-gateway"
  image_tag_mutability = var.ecr_image_tag_mutability
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.secrets.arn
  }

  tags = { Name = "${local.prefix}-ecr-gateway" }
}

# Retain the last 30 images so a rollback target always exists; expire untagged layers quickly.
locals {
  ecr_lifecycle_policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 3 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 3
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the 30 most recent images (rollback targets)"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 30
        }
        action = { type = "expire" }
      },
    ]
  })
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecr_lifecycle_policy" "gateway" {
  repository = aws_ecr_repository.gateway.name
  policy     = local.ecr_lifecycle_policy
}

# Resource policy: the runtime role may PULL, the deployment role may PUSH. Nothing else.
data "aws_iam_policy_document" "ecr_repo" {
  statement {
    sid    = "RuntimePullOnly"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.runtime.arn]
    }

    actions = [
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchCheckLayerAvailability",
    ]
  }

  statement {
    sid    = "DeploymentPush"
    effect = "Allow"

    principals {
      type        = "AWS"
      identifiers = [aws_iam_role.deployment.arn]
    }

    actions = [
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:DescribeImages",
      # Cosign / in-toto attestations are stored as OCI artifacts in the same repository.
      "ecr:PutImageTagMutability",
    ]
  }
}

resource "aws_ecr_repository_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy     = data.aws_iam_policy_document.ecr_repo.json
}

resource "aws_ecr_repository_policy" "gateway" {
  repository = aws_ecr_repository.gateway.name
  policy     = data.aws_iam_policy_document.ecr_repo.json
}

# Image signing: ECR has no native signing resource. Signatures/attestations are produced by the
# deployment pipeline with cosign (keyless OIDC) and pushed as OCI artifacts into the same
# repository; verification runs as an admission/deploy-time step. See
# docs/PHASE7-08-SECURITY-FINAL-GATE.md §"image signing and provenance".
