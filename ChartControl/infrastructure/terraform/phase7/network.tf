# ---------------------------------------------------------------------------
# Network. Created only when create_network = true; otherwise an existing VPC/subnets are used.
#
# Layout: private subnets for the runtime + data layer, public subnets for the NAT gateway and (if
# DNS is enabled) the load balancer. A SINGLE NAT gateway is used on purpose so egress leaves through
# ONE Elastic IP — the exchange allowlist is pinned to a single address (var.fixed_egress_ip).
# ---------------------------------------------------------------------------

resource "aws_vpc" "main" {
  #checkov:skip=CKV2_AWS_11:Flow logging IS enabled - see aws_flow_log.vpc below (traffic_type=ALL,
  #destination aws_cloudwatch_log_group.vpc_flow). This graph check cannot resolve the count-indexed
  #reference aws_vpc.main[0], so it reports a false negative. Verified by reading the resource.
  #checkov:skip=CKV2_AWS_12:The default security group IS locked down - see
  #aws_default_security_group.main below, declared with no ingress/egress blocks (all rules revoked).
  #Same count-indexed graph-resolution limitation.
  count = var.create_network ? 1 : 0

  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = "${local.prefix}-vpc" }
}

resource "aws_flow_log" "vpc" {
  count = var.create_network ? 1 : 0

  vpc_id               = aws_vpc.main[0].id
  traffic_type         = "ALL"
  log_destination_type = "cloud-watch-logs"
  log_destination      = aws_cloudwatch_log_group.vpc_flow[0].arn
  iam_role_arn         = aws_iam_role.flow_logs[0].arn

  tags = { Name = "${local.prefix}-vpc-flow-log" }
}

# The default security group must permit nothing: workloads use the purpose-built groups below.
resource "aws_default_security_group" "main" {
  count = var.create_network ? 1 : 0

  vpc_id = aws_vpc.main[0].id
  # No ingress and no egress blocks => all rules revoked.

  tags = { Name = "${local.prefix}-default-sg-locked" }
}

resource "aws_subnet" "private" {
  count = var.create_network ? length(var.availability_zones) : 0

  vpc_id                  = aws_vpc.main[0].id
  availability_zone       = var.availability_zones[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  map_public_ip_on_launch = false

  tags = { Name = "${local.prefix}-private-${var.availability_zones[count.index]}", Tier = "private" }
}

resource "aws_subnet" "public" {
  count = var.create_network ? length(var.availability_zones) : 0

  vpc_id                  = aws_vpc.main[0].id
  availability_zone       = var.availability_zones[count.index]
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index + 8)
  map_public_ip_on_launch = false

  tags = { Name = "${local.prefix}-public-${var.availability_zones[count.index]}", Tier = "public" }
}

resource "aws_internet_gateway" "main" {
  count = var.create_network ? 1 : 0

  vpc_id = aws_vpc.main[0].id
  tags   = { Name = "${local.prefix}-igw" }
}

resource "aws_eip" "nat" {
  #checkov:skip=CKV2_AWS_19: The EIP is attached to the NAT gateway (aws_nat_gateway.main), not to an
  #EC2 instance. A single NAT EIP is what gives the exchange allowlist one stable egress address.
  count = var.create_network ? 1 : 0

  domain = "vpc"
  # This is the address that must be registered in the BitMart IP allowlist.
  tags = { Name = "${local.prefix}-nat-eip", Purpose = "fixed-egress-ip" }
}

resource "aws_nat_gateway" "main" {
  count = var.create_network ? 1 : 0

  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id
  depends_on    = [aws_internet_gateway.main]

  tags = { Name = "${local.prefix}-nat" }
}

resource "aws_route_table" "public" {
  count = var.create_network ? 1 : 0

  vpc_id = aws_vpc.main[0].id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main[0].id
  }

  tags = { Name = "${local.prefix}-rt-public" }
}

resource "aws_route_table" "private" {
  count = var.create_network ? 1 : 0

  vpc_id = aws_vpc.main[0].id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[0].id
  }

  tags = { Name = "${local.prefix}-rt-private" }
}

resource "aws_route_table_association" "public" {
  count = var.create_network ? length(var.availability_zones) : 0

  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public[0].id
}

resource "aws_route_table_association" "private" {
  count = var.create_network ? length(var.availability_zones) : 0

  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[0].id
}

# ---------------------------------------------------------------------------
# Security groups — least privilege, no inbound from the internet on the runtime.
#
# There is deliberately NO administrative inbound rule (no SSH, no operator CIDR allowlist):
# break-glass shell access goes through SSM Session Manager, which needs no open port and is audited
# in CloudTrail. See iam-runtime.tf (AmazonSSMManagedInstanceCore) and
# docs/PHASE7-03-SECRET-IAM-KMS.md §"operator access".
# ---------------------------------------------------------------------------

resource "aws_security_group" "api" {
  name        = "${local.prefix}-api-sg"
  description = "QuantumTrade API/Gateway runtime: egress to AWS APIs + exchange, no direct inbound"
  vpc_id      = local.vpc_id

  tags = { Name = "${local.prefix}-api-sg" }

  lifecycle {
    create_before_destroy = true
  }
}

# Inbound only from the load balancer (when DNS/ALB is enabled) — never from 0.0.0.0/0.
resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  count = var.enable_dns ? 1 : 0

  security_group_id            = aws_security_group.api.id
  description                  = "API port from the application load balancer only"
  from_port                    = var.api_container_port
  to_port                      = var.api_container_port
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.alb[0].id
}

# Egress: HTTPS only (AWS APIs, Secrets Manager, exchange REST/WS, OpenAI).
resource "aws_vpc_security_group_egress_rule" "api_https" {
  security_group_id = aws_security_group.api.id
  description       = "HTTPS egress (AWS APIs, exchange REST/WSS, OpenAI)"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "api_to_postgres" {
  security_group_id            = aws_security_group.api.id
  description                  = "PostgreSQL to the managed database security group"
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.database.id
}

resource "aws_vpc_security_group_egress_rule" "api_to_redis" {
  security_group_id            = aws_security_group.api.id
  description                  = "Redis TLS to the managed cache security group"
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.cache.id
}

resource "aws_security_group" "database" {
  name        = "${local.prefix}-db-sg"
  description = "Managed PostgreSQL: inbound only from the API/Gateway security group"
  vpc_id      = local.vpc_id

  tags = { Name = "${local.prefix}-db-sg" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "database_from_api" {
  security_group_id            = aws_security_group.database.id
  description                  = "PostgreSQL from the API/Gateway runtime only"
  from_port                    = 5432
  to_port                      = 5432
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_security_group" "cache" {
  name        = "${local.prefix}-cache-sg"
  description = "ElastiCache: inbound only from the API/Gateway security group"
  vpc_id      = local.vpc_id

  tags = { Name = "${local.prefix}-cache-sg" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_ingress_rule" "cache_from_api" {
  security_group_id            = aws_security_group.cache.id
  description                  = "Redis TLS from the API/Gateway runtime only"
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.api.id
}

# ---------------------------------------------------------------------------
# Optional public load balancer (only when DNS/TLS is managed here).
# ---------------------------------------------------------------------------

resource "aws_security_group" "alb" {
  count = var.enable_dns ? 1 : 0

  name        = "${local.prefix}-alb-sg"
  description = "Public HTTPS entry point"
  vpc_id      = local.vpc_id

  tags = { Name = "${local.prefix}-alb-sg" }
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  count = var.enable_dns ? 1 : 0

  security_group_id = aws_security_group.alb[0].id
  description       = "Public HTTPS"
  from_port         = 443
  to_port           = 443
  ip_protocol       = "tcp"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_egress_rule" "alb_to_api" {
  count = var.enable_dns ? 1 : 0

  security_group_id            = aws_security_group.alb[0].id
  description                  = "Forward to the API runtime"
  from_port                    = var.api_container_port
  to_port                      = var.api_container_port
  ip_protocol                  = "tcp"
  referenced_security_group_id = aws_security_group.api.id
}
