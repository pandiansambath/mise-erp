"""Application configuration via environment variables (pydantic-settings)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # App
    app_name: str = "DineAI API"
    environment: str = "local"  # local | ci | staging | production
    debug: bool = True

    # Database — async driver. Overridden by DATABASE_URL env var.
    database_url: str = "postgresql+asyncpg://mise:mise@db:5432/mise"

    # Security
    secret_key: str = "dev-only-secret-change-me"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 480  # 8h — a full restaurant shift

    # CORS (comma-separated in env: CORS_ORIGINS="http://localhost:3000,https://app.example")
    cors_origins: list[str] = ["http://localhost:3000"]

    # Document storage: local disk for dev, S3 in the cloud (box disk is ephemeral).
    storage_backend: str = "local"  # local | s3
    upload_dir: str = "uploads"
    s3_bucket: str = ""
    aws_region: str = "eu-west-2"
    max_upload_mb: int = 10

    # Email alerts (optional). Set RESEND_API_KEY to activate; otherwise alerts are
    # logged and no-op'd, so the app runs fine without a provider configured.
    resend_api_key: str = ""
    email_from: str = "DineAI <alerts@dineai.cloud>"
    # Public URL of the app — verification/reset links in emails point here.
    app_base_url: str = "https://dineai.cloud"

    # Stripe billing (TEST MODE for now — sk_test_/whsec_ keys, no real money).
    # Empty keys = billing endpoints answer 503 and the app runs fine without it.
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_id: str = ""  # legacy single price; kept so old callers work

    # Per-plan price ids as JSON: {"<plan>_<month|year>": "price_..."}. Price
    # ids are not secrets (they appear in the checkout URL), so the TEST-mode
    # ids ship as the default and STRIPE_PRICES overrides them for live.
    stripe_prices: str = (
        '{"starter_month":"price_1TyCp1PlbHXr6C3CgWE7bGVD",'
        '"starter_year":"price_1TyCp2PlbHXr6C3CyWkzdiGX",'
        '"pro_month":"price_1TyCp4PlbHXr6C3Cb42bUvnQ",'
        '"pro_year":"price_1TyCp5PlbHXr6C3Ctgnxtl7G",'
        '"enterprise_month":"price_1TyCp7PlbHXr6C3C6s7Czbrh",'
        '"enterprise_year":"price_1TyCp8PlbHXr6C3C7Uz21KGA"}'
    )

    # Gemini is GONE. The assistant, document ingest and scanning all run on
    # Bedrock now (see app/assistant/brain.py). These keys are kept only so an
    # existing .env with them set still boots; nothing reads them.
    gemini_api_key: str = ""
    gemini_api_key_2: str = ""
    assistant_model: str = ""

    # Claude on Amazon Bedrock — the Copilot's brain for document understanding
    # (bills, handwritten recipes) and the in-app assistant. Runs on the instance
    # role, so there's no key: client images never leave our own AWS account.
    # Model access is granted once in the Bedrock console.
    # Empty on purpose: the plan decides the model (see platform_admin.features),
    # and bedrock.DEFAULT_MODEL is the fallback. This used to default to
    # claude-sonnet-5 — a model AWS never granted this account — so every health
    # check came back AccessDenied and the UI reported "AI is switched off" while
    # the AI was in fact working. Set BEDROCK_MODEL_ID only to pin a model.
    bedrock_model_id: str = ""

    # ── AI spend controls ────────────────────────────────────────────────
    # The AI is the one part of DineAI with UNBOUNDED cost: everything else is a
    # fixed EC2 + RDS bill, but tokens are pay-per-use, so a loop or an abusive
    # client can run up real money. These are enforced BEFORE Bedrock is called.
    # --- Error reporting -------------------------------------------------
    # Empty = off. With no DSN the SDK is never initialised, so there is no
    # client, no network call and no cost; production turns it on with an env
    # var rather than a deploy.
    sentry_dsn: str = ""
    sentry_environment: str = "production"
    # Traces are sampled to nothing by default. Errors are the point; tracing
    # every request would exhaust the free tier on healthy traffic alone.
    sentry_traces_sample_rate: float = 0.0

    ai_enabled: bool = True  # global kill switch — off needs no deploy, just an env var
    ai_hotel_daily_requests: int = 300  # per hotel, per rolling day
    ai_hotel_monthly_tokens: int = 8_000_000  # per hotel, per calendar month
    ai_user_per_minute: int = 12  # per user — stops a stuck client hammering us

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
