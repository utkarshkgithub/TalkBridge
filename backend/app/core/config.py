from functools import lru_cache
from pathlib import Path
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
    github_app_id: str = ""
    github_private_key: SecretStr = SecretStr("")
    github_api_url: str = "https://api.github.com"
    webhook_max_bytes: int = Field(default=2_000_000, ge=1024)
    delivery_ttl_seconds: int = Field(default=86400, ge=1)
    delivery_cache_size: int = Field(default=10000, ge=1)
    worker_queue_size: int = Field(default=100, ge=1)
    worker_count: int = Field(default=1, ge=1, le=4)
    semgrep_timeout_seconds: float = Field(default=5.0, gt=0, le=5)
    semgrep_rules_path: Path = (
        Path(__file__).resolve().parents[3] / "semgrep_rules"
        if (Path(__file__).resolve().parents[3] / "semgrep_rules").is_dir()
        else Path(__file__).resolve().parents[1] / "semgrep_rules"
    )
    ast_max_lines: int = Field(default=200, ge=31)
    enforce_style_diff: bool = False
    lora_enabled: bool = False
    demo_replay_mode: bool = False
    sandbox_test_enabled: bool = False
    review_enabled: bool = False
    github_publish_enabled: bool = False
    vllm_base_url: str = "http://localhost:8001/v1"
    vllm_api_key: SecretStr = SecretStr("")
    vllm_model: str = "Qwen/Qwen3-8B-AWQ"
    vllm_schema_mode: Literal["guided_json", "structured_outputs"] = "structured_outputs"
    vllm_timeout_seconds: float = Field(default=120, gt=0)
    vllm_max_tokens: int = Field(default=4096, ge=256)
    verifier_concurrency: int = Field(default=4, ge=1, le=16)
    max_candidates_per_agent: int = Field(default=20, ge=1, le=100)
    prompt_max_chars: int = Field(default=100000, ge=1000)

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
