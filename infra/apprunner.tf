resource "aws_apprunner_vpc_connector" "main" {
  vpc_connector_name = "${var.project}-connector"
  subnets            = aws_subnet.private[*].id
  security_groups    = [aws_security_group.connector.id]
}

# Pin to a single instance: keeps cost down and keeps local document storage
# consistent (S3-backed storage is the planned follow-up for horizontal scale).
resource "aws_apprunner_auto_scaling_configuration_version" "single" {
  auto_scaling_configuration_name = "${var.project}-single"
  max_concurrency                 = 100
  min_size                        = 1
  max_size                        = 1
}

resource "aws_apprunner_service" "backend" {
  service_name = "${var.project}-backend"

  source_configuration {
    auto_deployments_enabled = false
    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_ecr.arn
    }
    image_repository {
      image_identifier      = var.backend_image
      image_repository_type = "ECR"
      image_configuration {
        port = "8000"
        runtime_environment_variables = {
          ENVIRONMENT  = "production"
          DATABASE_URL = "postgresql+asyncpg://mise:${var.db_password}@${aws_db_instance.main.address}:5432/mise"
          SECRET_KEY   = var.app_secret_key
          CORS_ORIGINS = "[\"*\"]"
          UPLOAD_DIR   = "/tmp/uploads"
        }
        # Run DB migrations on boot, then serve.
        start_command = "sh -c 'alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 1'"
      }
    }
  }

  instance_configuration {
    cpu               = "256"
    memory            = "512"
    instance_role_arn = aws_iam_role.apprunner_instance.arn
  }

  network_configuration {
    egress_configuration {
      egress_type       = "VPC"
      vpc_connector_arn = aws_apprunner_vpc_connector.main.arn
    }
  }

  health_check_configuration {
    protocol            = "HTTP"
    path                = "/api/health"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 1
    unhealthy_threshold = 5
  }

  auto_scaling_configuration_arn = aws_apprunner_auto_scaling_configuration_version.single.arn

  depends_on = [aws_db_instance.main]
}

resource "aws_apprunner_service" "frontend" {
  count        = var.frontend_image != "" ? 1 : 0
  service_name = "${var.project}-frontend"

  source_configuration {
    auto_deployments_enabled = false
    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_ecr.arn
    }
    image_repository {
      image_identifier      = var.frontend_image
      image_repository_type = "ECR"
      image_configuration {
        port = "3000"
      }
    }
  }

  instance_configuration {
    cpu    = "256"
    memory = "512"
  }

  health_check_configuration {
    protocol            = "TCP"
    interval            = 10
    timeout             = 5
    healthy_threshold   = 1
    unhealthy_threshold = 5
  }

  auto_scaling_configuration_arn = aws_apprunner_auto_scaling_configuration_version.single.arn
}
