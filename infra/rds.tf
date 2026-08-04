resource "aws_db_subnet_group" "main" {
  name       = "${var.project}-db"
  subnet_ids = aws_subnet.private[*].id
  tags       = { Name = "${var.project}-db" }
}

resource "aws_db_instance" "main" {
  identifier     = "${var.project}-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = "db.t4g.micro" # free-tier eligible (12 mo), then ~lowest cost

  allocated_storage     = 20
  max_allocated_storage = 50
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "mise"
  username = "mise"
  password = var.db_password
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false

  # Automated backups: 7 days of point-in-time recovery.
  #
  # This said 0 with a comment claiming free-tier accounts cannot have backups.
  # That is not true — AWS includes backup storage up to 100% of provisioned
  # storage (20GB here), so this costs nothing. The database held every
  # restaurant's records with NO automated backup and NO deletion protection,
  # which was the largest hole in the stack.
  #
  # The S3 dump is not a substitute: it is one file a day, while this restores
  # to any second in the last week. Different disasters.
  #
  # It must live HERE, not in a console change: `terraform apply` runs on every
  # deploy, so a manual fix is silently reverted the next time anyone ships.
  # That is exactly what happened when this was set by hand.
  backup_retention_period = 7
  deletion_protection     = true

  # A parting snapshot if the instance is ever destroyed. deletion_protection
  # should stop that happening at all, but "should" is not a backup.
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.project}-db-final-snapshot"
  apply_immediately         = true

  tags = { Name = "${var.project}-db" }
}
