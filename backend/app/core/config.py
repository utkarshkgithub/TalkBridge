from functools import lru_cache
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings loaded from environment variables and `.env`."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: Literal["dev", "test", "prod"] = "dev"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    database_url: str = "postgresql+psycopg://postgres:postgres@localhost:5432/talkbridge"
    github_webhook_secret: SecretStr = SecretStr("")

    @field_validator("database_url")
    @classmethod
    def _validate_postgres_url(cls, value: str) -> str:
        if not value.startswith("postgresql"):
            raise ValueError("database_url must use a postgresql scheme")
        return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached application settings."""
    return Settings()
