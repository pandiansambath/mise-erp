data "aws_caller_identity" "current" {}

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

locals {
  registry = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.region}.amazonaws.com"
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = "t3.micro" # free-tier eligible (750h/mo, 12 mo)
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
  }

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    region         = var.region
    registry       = local.registry
    backend_image  = var.backend_image
    frontend_image = var.frontend_image
    db_host        = aws_db_instance.main.address
    db_password    = var.db_password
    app_secret_key = var.app_secret_key
  })
  # Re-run cloud-init (pull new images + restart) whenever the images change.
  user_data_replace_on_change = true

  depends_on = [aws_db_instance.main]
  tags       = { Name = "${var.project}-app" }
}

# Stable public IP so the URL doesn't change across deploys.
resource "aws_eip" "app" {
  domain   = "vpc"
  instance = aws_instance.app.id
  tags     = { Name = "${var.project}-app" }
}
