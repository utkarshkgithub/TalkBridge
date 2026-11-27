import pytest
from pydantic import ValidationError

from app.core.config import Settings, get_settings


def test_settings_defaults_and_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    get_settings.cache_clear()
    defaults = Settings(_env_file=None)
    assert defaults.database_url.startswith("postgresql")
    assert defaults.cors_origins == ["http://localhost:3000"]

    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://u:p@db:5432/tb")
    monkeypatch.setenv("GITHUB_WEBHOOK_SECRET", "top-secret")
    overridden = Settings(_env_file=None)
    assert overridden.database_url == "postgresql+psycopg://u:p@db:5432/tb"
    assert overridden.github_webhook_secret.get_secret_value() == "top-secret"


def test_settings_rejects_non_postgres_url() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, database_url="sqlite:///local.db")
