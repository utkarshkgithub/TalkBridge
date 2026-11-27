"""The browser gateway must be the only production dashboard entry point."""
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config import Settings
from app.main import create_app


def test_production_requires_a_backend_gateway_secret():
    with pytest.raises(ValidationError, match="DASHBOARD_API_KEY"):
        Settings(_env_file=None, app_env="prod")


def test_dashboard_api_rejects_missing_or_incorrect_gateway_key():
    settings = Settings(_env_file=None, dashboard_api_key="a" * 32)
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/reviews").status_code == 401
        assert client.post("/api/demo/replay/auth_sqli_pr").status_code == 401
        assert client.get("/api/reviews", headers={"X-TalkBridge-Key": "wrong"}).status_code == 401
        assert client.get("/health").status_code == 200
        # A valid gateway reaches the storage handler; storage is disabled in this test.
        response = client.get("/api/reviews", headers={"X-TalkBridge-Key": "a" * 32})
        assert response.status_code == 503
        assert "STORAGE_ENABLED" in response.json()["detail"]
