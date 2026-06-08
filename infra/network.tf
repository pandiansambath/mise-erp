# Minimal VPC for RDS + the App Runner VPC connector. No IGW/NAT needed:
# App Runner reaches RDS over the VPC connector, and pulls ECR / serves traffic
# over AWS-managed networking — so we avoid NAT gateway cost entirely.
data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = "${var.project}-vpc" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(aws_vpc.main.cidr_block, 8, count.index)
  availability_zone = data.aws_availability_zones.available.names[count.index]
  tags              = { Name = "${var.project}-private-${count.index}" }
}

# SG attached to the App Runner VPC connector (egress to RDS).
resource "aws_security_group" "connector" {
  name        = "${var.project}-apprunner-connector"
  description = "App Runner VPC connector egress"
  vpc_id      = aws_vpc.main.id
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${var.project}-apprunner-connector" }
}

# RDS SG: only Postgres, only from the App Runner connector SG.
resource "aws_security_group" "rds" {
  name        = "${var.project}-rds"
  description = "Postgres from App Runner only"
  vpc_id      = aws_vpc.main.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.connector.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "${var.project}-rds" }
}
