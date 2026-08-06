terraform {
  # Pinned minor range: reproducible plans without blocking patch upgrades.
  required_version = "~> 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.60"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # No backend block on purpose: `terraform init -backend=false` must work for static validation in
  # CI without AWS credentials. Configure the production backend out-of-band, e.g.
  #   terraform init -backend-config=backend.hcl
  # with an S3 bucket (SSE-KMS, versioned, blocked public access) + DynamoDB lock table.
  # NOTE: Terraform state can contain resource attributes. This configuration never writes a secret
  # VALUE (see secrets.tf), so state holds only ARNs/names/metadata — but the state backend must
  # still be encrypted and access-controlled.
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "quantumtrade-ai"
      Environment = var.environment
      Phase       = "phase-7"
      ManagedBy   = "terraform"
      Baseline    = "phase-6-approved-v0.6.0"
    }
  }
}
