variable "region" {
  type    = string
  default = "eu-west-2"
}

variable "project" {
  type    = string
  default = "mise"
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "app_secret_key" {
  type      = string
  sensitive = true
}

# Optional email-alert provider (Resend). Empty = alerts log + no-op (app runs fine).
variable "resend_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

variable "email_from" {
  type    = string
  default = "Mise <onboarding@resend.dev>"
}

# Optional Mise Copilot LLM (Google Gemini, free tier). Empty = the assistant
# runs in deterministic fallback mode (glossary + navigation), app fine without it.
variable "gemini_api_key" {
  type      = string
  sensitive = true
  default   = ""
}

# Custom domain for HTTPS. Empty = serve plain HTTP on :80 by IP (current).
# When set, Caddy auto-provisions a Let's Encrypt cert for it + www. (DNS must
# point at the box's Elastic IP FIRST, or the ACME challenge fails.)
variable "domain" {
  type    = string
  default = ""
}

# Email Let's Encrypt uses for expiry notices (recommended once a domain is set).
variable "acme_email" {
  type    = string
  default = ""
}

# Full ECR image URIs (with tag), supplied by the CI workflow.
variable "backend_image" {
  type = string
}

# Empty on the first apply (backend only); set once the frontend image is built
# with the backend URL baked in. Controls whether the frontend service is created.
variable "frontend_image" {
  type    = string
  default = ""
}
