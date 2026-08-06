# ---------------------------------------------------------------------------
# Managed PostgreSQL — Multi-AZ, encrypted, automated backups + PITR.
#
# The master credential is NOT generated or stored by Terraform. RDS-managed master-user password
# rotation keeps the value in a Secrets Manager secret owned by RDS, so no password ever transits
# Terraform state. The application uses its own least-privilege role, whose credential lives in
# `quantumtrade/<env>/db/postgres` (populated out-of-band).
# ---------------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name        = "${local.prefix}-db-subnets"
  subnet_ids  = local.private_subnet_ids
  description = "Private subnets for the managed PostgreSQL instance"

  tags = { Name = "${local.prefix}-db-subnets" }
}

resource "aws_db_parameter_group" "postgres" {
  name        = "${local.prefix}-pg16"
  family      = "postgres16"
  description = "TLS-required, statement-timeout bounded parameters"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  # Bound runaway queries; the application also sets its own statement timeout.
  parameter {
    name  = "statement_timeout"
    value = "30000"
  }

  parameter {
    name  = "log_min_duration_statement"
    value = "1000"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "main" {
  identifier     = "${local.prefix}-postgres"
  engine         = "postgres"
  engine_version = var.postgres_engine_version
  instance_class = var.postgres_instance_class

  # RDS manages the master password in its own Secrets Manager secret — nothing in Terraform state.
  username                      = "qtadmin"
  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.secrets.arn
  db_name                       = "quantumtrade"

  allocated_storage     = var.postgres_allocated_storage_gb
  max_allocated_storage = var.postgres_max_allocated_storage_gb
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.database.arn

  multi_az               = var.postgres_multi_az
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false
  parameter_group_name   = aws_db_parameter_group.postgres.name
  ca_cert_identifier     = "rds-ca-rsa2048-g1"

  # Automated backups + PITR. The PITR window equals the retention period.
  backup_retention_period   = var.backup_retention_days
  backup_window             = "17:00-18:00" # 02:00-03:00 KST
  copy_tags_to_snapshot     = true
  delete_automated_backups  = false
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.prefix}-postgres-final"

  maintenance_window           = "sun:18:30-sun:19:30" # 03:30-04:30 KST
  auto_minor_version_upgrade   = true
  apply_immediately            = false
  deletion_protection          = true
  performance_insights_enabled = true

  # IAM database authentication for operator/break-glass access (the application still uses the
  # Secrets Manager credential; IAM auth removes the need to hand a password to a human).
  iam_database_authentication_enabled = true

  performance_insights_kms_key_id       = aws_kms_key.database.arn
  performance_insights_retention_period = 7

  monitoring_interval = 60
  monitoring_role_arn = aws_iam_role.rds_monitoring.arn

  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  tags = { Name = "${local.prefix}-postgres" }

  lifecycle {
    # Storage autoscaling changes allocated_storage outside Terraform.
    ignore_changes = [allocated_storage]
  }
}

resource "aws_iam_role" "rds_monitoring" {
  name               = "${local.prefix}-rds-monitoring"
  assume_role_policy = data.aws_iam_policy_document.rds_monitoring_assume.json

  tags = { Name = "${local.prefix}-rds-monitoring" }
}

data "aws_iam_policy_document" "rds_monitoring_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["monitoring.rds.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy_attachment" "rds_monitoring" {
  role       = aws_iam_role.rds_monitoring.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole"
}
