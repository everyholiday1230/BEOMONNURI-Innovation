variable "region" {
  description = "AWS region for all Phase 7 resources."
  type        = string
  default     = "ap-northeast-2"
}

variable "environment" {
  description = "Deployment environment name (drives resource naming and tags)."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["prod", "staging"], var.environment)
    error_message = "environment must be one of: prod, staging."
  }
}

variable "name_prefix" {
  description = "Prefix for every resource name."
  type        = string
  default     = "quantumtrade"
}

# ---------------------------------------------------------------------------
# Networking — bring your own VPC, or let this configuration create one.
# ---------------------------------------------------------------------------
variable "create_network" {
  description = "Create a dedicated VPC/subnets. Set false to attach to an existing VPC."
  type        = bool
  default     = true
}

variable "existing_vpc_id" {
  description = "Existing VPC id. Required when create_network = false."
  type        = string
  default     = ""
}

variable "existing_private_subnet_ids" {
  description = "Existing private subnet ids for the runtime + data layer. Required when create_network = false."
  type        = list(string)
  default     = []
}

variable "vpc_cidr" {
  description = "CIDR for the created VPC (used only when create_network = true)."
  type        = string
  default     = "10.20.0.0/16"
}

variable "availability_zones" {
  description = "AZs to spread private/public subnets across (>=2 required for Multi-AZ RDS)."
  type        = list(string)
  default     = ["ap-northeast-2a", "ap-northeast-2c"]

  validation {
    condition     = length(var.availability_zones) >= 2
    error_message = "At least two availability zones are required for Multi-AZ RDS."
  }
}

variable "fixed_egress_ip" {
  description = <<-EOT
    The single NAT egress IP the exchange allowlist is pinned to. Recorded so the value that must be
    registered in the BitMart dashboard is explicit in code review. Verified from the runtime as
    15.164.47.4 during the Phase 7 Stage 0 preflight.
  EOT
  type        = string
  default     = "15.164.47.4"
}

# ---------------------------------------------------------------------------
# Data layer
# ---------------------------------------------------------------------------
variable "postgres_engine_version" {
  description = "Managed PostgreSQL engine version."
  type        = string
  default     = "16.4"
}

variable "postgres_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.m7g.large"
}

variable "postgres_multi_az" {
  description = "Enable Multi-AZ for the primary database."
  type        = bool
  default     = true
}

variable "postgres_allocated_storage_gb" {
  description = "Initial allocated storage (GiB)."
  type        = number
  default     = 100
}

variable "postgres_max_allocated_storage_gb" {
  description = "Upper bound for storage autoscaling (GiB)."
  type        = number
  default     = 500
}

variable "backup_retention_days" {
  description = "Automated backup retention in days. PITR window equals this value."
  type        = number
  default     = 14

  validation {
    condition     = var.backup_retention_days >= 7
    error_message = "Production backup retention must be at least 7 days for a usable PITR window."
  }
}

variable "redis_engine_version" {
  description = "ElastiCache engine version (Valkey/Redis OSS compatible)."
  type        = string
  default     = "7.1"
}

variable "redis_node_type" {
  description = "ElastiCache node type."
  type        = string
  default     = "cache.m7g.large"
}

variable "redis_replica_count" {
  description = "Replicas per shard (>=1 enables automatic failover)."
  type        = number
  default     = 1

  validation {
    condition     = var.redis_replica_count >= 1
    error_message = "At least one replica is required so automatic failover can be enabled."
  }
}

# ---------------------------------------------------------------------------
# Observability / alerting
# ---------------------------------------------------------------------------
variable "log_retention_days" {
  description = "CloudWatch Logs retention for application and audit log groups."
  type        = number
  default     = 90
}

variable "alert_email_subscriptions" {
  description = "E-mail endpoints subscribed to the alert topic (Slack/PagerDuty are wired separately)."
  type        = list(string)
  default     = []
}

variable "alert_https_subscriptions" {
  description = <<-EOT
    HTTPS webhook endpoints (Slack / PagerDuty Events API) subscribed to the alert topic. Provide the
    endpoint URL only; the shared key belongs in Secrets Manager, never in Terraform.
  EOT
  type        = list(string)
  default     = []
}

# ---------------------------------------------------------------------------
# Optional DNS / TLS — off by default so validation works without a hosted zone.
# ---------------------------------------------------------------------------
variable "enable_dns" {
  description = "Manage ACM certificate + Route53 records for the production domain."
  type        = bool
  default     = false
}

variable "domain_name" {
  description = "Production domain (e.g. app.example.com). Required when enable_dns = true."
  type        = string
  default     = ""
}

variable "route53_zone_id" {
  description = "Hosted zone id that owns domain_name. Required when enable_dns = true."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Container deployment target
# ---------------------------------------------------------------------------
variable "deployment_target" {
  description = <<-EOT
    Where the approved container runs. "ecs_fargate" provisions an ECS cluster + task execution
    plumbing; "external" provisions only IAM/registry/data/observability and leaves the compute to an
    existing platform (the Stage 0 runtime was a plain EC2 instance).
  EOT
  type        = string
  default     = "external"

  validation {
    condition     = contains(["ecs_fargate", "external"], var.deployment_target)
    error_message = "deployment_target must be one of: ecs_fargate, external."
  }
}

variable "api_container_port" {
  description = "Container port the API listens on."
  type        = number
  default     = 8787
}

variable "ecr_image_tag_mutability" {
  description = "Tag mutability for the API repository. MUST stay IMMUTABLE for digest-pinned deploys."
  type        = string
  default     = "IMMUTABLE"

  validation {
    condition     = var.ecr_image_tag_mutability == "IMMUTABLE"
    error_message = "Phase 7 requires IMMUTABLE image tags (deployments are pinned by digest)."
  }
}

variable "enable_ssm_session_manager" {
  description = "Attach AmazonSSMManagedInstanceCore to the runtime role for break-glass shell access."
  type        = bool
  default     = true
}
