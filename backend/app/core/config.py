"""Application configuration via environment variables (pydantic-settings)."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    # App
    app_name: str = "Mise API"
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
    email_from: str = "Mise <alerts@mise.local>"

    # Mise Copilot — the in-app AI assistant. A free Google AI Studio key activates
    # the LLM (Gemini Flash: free tier, 1M context, native tools). With no key the
    # assistant degrades gracefully to deterministic glossary + navigation answers,
    # so the app (and CI) run fine without it. Provider-agnostic by design.
    gemini_api_key: str = ""
    # Optional 2nd key — the assistant rotates to it when the 1st hits the free-tier
    # rate limit (429), so a busy minute doesn't take the Copilot offline.
    gemini_api_key_2: str = ""
    assistant_model: str = "gemini-2.5-flash"

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
