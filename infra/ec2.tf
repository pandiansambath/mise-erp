data "aws_caller_identity" "current" {}

# Standard AL2023 (NOT minimal) via the AWS-published SSM parameter — ships with
# the SSM agent and EC2 Instance Connect so we have a way onto the box.
data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

locals {
  registry = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.region}.amazonaws.com"

  # Caddy site address: a real domain (+ www) turns on automatic HTTPS via
  # Let's Encrypt; empty domain falls back to plain HTTP on :80 by IP.
  caddy_site = var.domain != "" ? "${var.domain}, www.${var.domain}" : ":80"
  # When a domain is set: get a Let's Encrypt cert BUT keep HTTP serving (disable
  # the auto http→https redirect) so the site is never unreachable if a future
  # deploy can't re-issue the cert. (Re-enable the redirect once certs persist.)
  caddy_global = var.domain == "" ? "" : "{\n${var.acme_email != "" ? "\temail ${var.acme_email}\n" : ""}\tauto_https disable_redirects\n}\n\n"
  caddyfile    = "${local.caddy_global}${local.caddy_site} {\n\thandle /api/* {\n\t\treverse_proxy backend:8000\n\t}\n\thandle {\n\t\treverse_proxy frontend:3000\n\t}\n}\n"
}

resource "aws_instance" "app" {
  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = "t3.micro" # free-tier eligible (750h/mo, 12 mo)
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
  }

  # Hop limit 2 so containers (one extra network hop) can reach IMDS for the
  # instance-role credentials boto3 uses to talk to S3.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  user_data = templatefile("${path.module}/user_data.sh.tftpl", {
    region         = var.region
    registry       = local.registry
    backend_image  = var.backend_image
    frontend_image = var.frontend_image
    db_host        = aws_db_instance.main.address
    db_password    = var.db_password
    app_secret_key = var.app_secret_key
    s3_bucket      = aws_s3_bucket.uploads.bucket
    resend_api_key = var.resend_api_key
    email_from     = var.email_from
    gemini_api_key = var.gemini_api_key
    caddyfile      = local.caddyfile
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
