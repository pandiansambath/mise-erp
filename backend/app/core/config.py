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

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
