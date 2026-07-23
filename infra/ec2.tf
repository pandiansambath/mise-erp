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
  # When a domain is set: automatic HTTPS + the normal http→https redirect. Certs now
  # persist across box replacement (restored from S3 in user_data), so deploys don't
  # re-issue → no rate-limit risk → the redirect is safe.
  # Global block: ACME email + the on-demand-TLS ask hook. When a hotel/function
  # subdomain (*.domain) is first hit, Caddy asks the backend whether to mint a
  # cert for it — so only known hosts get certs (no rate-limit abuse).
  caddy_ask    = var.domain == "" ? "" : "\ton_demand_tls {\n\t\task http://backend:8000/api/public/tls-check\n\t}\n"
  caddy_global = var.domain == "" ? "" : "{\n${var.acme_email != "" ? "\temail ${var.acme_email}\n" : ""}${local.caddy_ask}}\n\n"
  # Security response headers on every site: HSTS (force HTTPS for a year, incl.
  # hotel subdomains), no MIME sniffing, deny cross-site framing (clickjacking),
  # a privacy-preserving referrer policy, and hide the Server banner.
  caddy_headers = "\theader {\n\t\tStrict-Transport-Security \"max-age=31536000; includeSubDomains\"\n\t\tX-Content-Type-Options nosniff\n\t\tX-Frame-Options SAMEORIGIN\n\t\tReferrer-Policy strict-origin-when-cross-origin\n\t\t-Server\n\t}\n"
  # Shared site body: security headers + reverse-proxy routing (API vs frontend).
  caddy_body    = "${local.caddy_headers}\thandle /api/* {\n\t\treverse_proxy backend:8000\n\t}\n\thandle {\n\t\treverse_proxy frontend:3000\n\t}\n"
  # Wildcard site block for hotel/function subdomains: same routing, but certs are
  # issued on-demand (one per hostname on first visit) instead of up front.
  caddy_subs    = var.domain == "" ? "" : "\n*.${var.domain} {\n\ttls {\n\t\ton_demand\n\t}\n${local.caddy_body}}\n"
  caddyfile     = "${local.caddy_global}${local.caddy_site} {\n${local.caddy_body}}\n${local.caddy_subs}"

  # Public base URL for the backend (email verify/reset links, alert CTAs). Driven
  # by the domain so it's always correct after a domain move. Emitted as a compose
  # env line only when a domain is set; empty domain → backend keeps its own default.
  app_base_url_env = var.domain != "" ? "\n      APP_BASE_URL: \"https://${var.domain}\"" : ""

  # CORS: lock the API to our own domain(s) instead of "*". The app's own frontend
  # is same-origin (served by Caddy) so this doesn't affect it — it only stops other
  # websites' JS from calling our API. Empty domain (IP mode) keeps "*" for dev.
  cors_origins = var.domain != "" ? "[\"https://${var.domain}\",\"https://www.${var.domain}\"]" : "[\"*\"]"
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
    stripe_secret_key     = var.stripe_secret_key
    stripe_webhook_secret = var.stripe_webhook_secret
    stripe_price_id       = var.stripe_price_id
    gemini_api_key   = var.gemini_api_key
    gemini_api_key_2 = var.gemini_api_key_2
    caddyfile        = local.caddyfile
    app_base_url_env = local.app_base_url_env
    cors_origins     = local.cors_origins
  })
  # Re-run cloud-init (pull new images + restart) whenever the images change.
  # (Normal deploys pin images to :latest, so user_data is stable and the box is
  # NOT replaced — we roll images in-place via SSM instead.)
  user_data_replace_on_change = true

  lifecycle {
    # The AMI comes from AWS's "latest AL2023" SSM parameter, which AWS bumps every
    # few weeks. WITHOUT this, that bump shows up as an `ami` diff and forces a FULL
    # box replacement on the next deploy — downtime, a flaky rollout, and a Caddy
    # cert re-issue. The app runs entirely in Docker (images rebuilt each deploy), so
    # the host AMI rarely matters. Ignore AMI drift here; refresh the OS deliberately
    # with `terraform taint aws_instance.app` when we actually want a new base image.
    ignore_changes = [ami]
  }

  depends_on = [aws_db_instance.main]
  tags       = { Name = "${var.project}-app" }
}

# Stable public IP so the URL doesn't change across deploys.
resource "aws_eip" "app" {
  domain   = "vpc"
  instance = aws_instance.app.id
  tags     = { Name = "${var.project}-app" }
}
