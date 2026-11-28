import hashlib
import hmac
import json
import os
from unittest.mock import AsyncMock, Mock
from urllib.parse import urlencode
from uuid import uuid4

import psycopg
import pytest
from app.config import Settings
from app.main import create_app
from app.storage.replay import load_fixture
from fastapi.testclient import TestClient
from psycopg import sql
from pydantic import SecretStr


@pytest.fixture
def database_url():
    base = os.environ.get(
        "TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/talkbridge"
    )
    name = "tb_mt_" + uuid4().hex
    with psycopg.connect(base, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(name)))
    separator = "&" if "?" in base else "?"
    yield base + separator + urlencode({"options": f"-csearch_path={name}"})
    with psycopg.connect(base, autocommit=True) as connection:
        connection.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(name)))


def _signed(data: dict, event: str, delivery: str | None = None) -> tuple[bytes, dict[str, str]]:
    body = json.dumps(data).encode()
    return body, {
        "X-Hub-Signature-256": "sha256=" + hmac.new(b"secret", body, hashlib.sha256).hexdigest(),
        "X-GitHub-Delivery": delivery or str(uuid4()),
        "X-GitHub-Event": event,
    }


def _pr_payload(installation_id: int | None) -> dict:
    return {
        "action": "opened",
        "repository": {"full_name": "acme/demo"},
        "installation": {"id": installation_id} if installation_id is not None else None,
        "pull_request": {"number": 1, "head": {"sha": "head"}, "base": {"sha": "base"}},
    }


def test_webhook_requires_claimed_installation_enforces_quota_and_lifecycle(database_url):
    worker = Mock()
    worker.start = AsyncMock()
    worker.close = AsyncMock()
    settings = Settings(
        _env_file=None,
        storage_enabled=True,
        multi_tenant_enabled=True,
        install_daily_limit=2,
        database_url=database_url,
        github_webhook_secret=SecretStr("secret"),
    )
    with TestClient(create_app(settings, worker)) as client:
        body, headers = _signed(_pr_payload(777), "pull_request")
        res = client.post("/webhooks/github", content=body, headers=headers)
        assert res.status_code == 200
        assert res.json()["reason"] == "installation_unclaimed"
        worker.enqueue.assert_not_called()

        body, headers = _signed(
            {
                "action": "created",
                "installation": {"id": 777, "account": {"login": "alice", "type": "User"}},
            },
            "installation",
        )
        assert client.post("/webhooks/github", content=body, headers=headers).status_code == 200

        body, headers = _signed(_pr_payload(777), "pull_request")
        res = client.post("/webhooks/github", content=body, headers=headers)
        assert res.json()["reason"] == "installation_unclaimed"
        worker.enqueue.assert_not_called()

        with psycopg.connect(database_url, autocommit=True) as conn:
            conn.execute("UPDATE github_installations SET status='active' WHERE installation_id=777")
            conn.execute(
                "INSERT INTO user_installations (user_id, installation_id) VALUES ('github:1', 777)"
            )

        delivery = str(uuid4())
        body, headers = _signed(_pr_payload(777), "pull_request", delivery=delivery)
        assert client.post("/webhooks/github", content=body, headers=headers).status_code == 202
        assert (
            client.post("/webhooks/github", content=body, headers=headers).json()["status"]
            == "duplicate_ignored"
        )
        assert worker.enqueue.call_count == 1

        body, headers = _signed(_pr_payload(777), "pull_request")
        assert client.post("/webhooks/github", content=body, headers=headers).status_code == 202
        assert worker.enqueue.call_count == 2

        body, headers = _signed(_pr_payload(777), "pull_request")
        assert client.post("/webhooks/github", content=body, headers=headers).status_code == 429
        assert worker.enqueue.call_count == 2

        body, headers = _signed(
            {"action": "suspend", "installation": {"id": 777}},
            "installation",
        )
        assert client.post("/webhooks/github", content=body, headers=headers).status_code == 200
        body, headers = _signed(_pr_payload(777), "pull_request")
        assert client.post("/webhooks/github", content=body, headers=headers).json()["reason"] == (
            "installation_unclaimed"
        )

        body, headers = _signed(
            {"action": "unsuspend", "installation": {"id": 777}},
            "installation",
        )
        assert client.post("/webhooks/github", content=body, headers=headers).status_code == 200

        body, headers = _signed(
            {"action": "deleted", "installation": {"id": 777}},
            "installation",
        )
        assert client.post("/webhooks/github", content=body, headers=headers).status_code == 200
        body, headers = _signed(_pr_payload(777), "pull_request")
        assert client.post("/webhooks/github", content=body, headers=headers).json()["reason"] == (
            "installation_unclaimed"
        )


def test_tenant_isolation_scopes_reviews_and_telemetry(database_url):
    settings = Settings(
        _env_file=None,
        app_env="prod",
        storage_enabled=True,
        multi_tenant_enabled=True,
        dashboard_api_key=SecretStr("k" * 32),
        database_url=database_url,
    )
    with TestClient(create_app(settings)) as client:
        with psycopg.connect(database_url, autocommit=True) as conn:
            conn.execute(
                "INSERT INTO github_installations (installation_id, account_login, status) "
                "VALUES (101, 'alice', 'active'), (202, 'bob', 'active')"
            )
            conn.execute(
                "INSERT INTO user_installations (user_id, installation_id) "
                "VALUES ('github:1', 101), ('github:2', 202)"
            )

        r1 = load_fixture("auth_sqli_pr").result.model_copy(deep=True)
        r1.bundle.context.installation_id = 101
        r2 = load_fixture("clean_small_pr").result.model_copy(deep=True)
        r2.bundle.context.installation_id = 202

        client.portal.call(client.app.state.store.save, r1, "base_8b", "rev-alice")
        client.portal.call(client.app.state.store.save, r2, "base_8b", "rev-bob")

        assert client.get("/api/reviews", headers={"X-TalkBridge-Key": "k" * 32}).status_code == 401

        h_alice = {"X-TalkBridge-Key": "k" * 32, "X-TalkBridge-User": "github:1"}
        h_bob = {"X-TalkBridge-Key": "k" * 32, "X-TalkBridge-User": "github:2"}

        alice_list = client.get("/api/reviews", headers=h_alice).json()
        assert alice_list["total"] == 1
        assert [i["id"] for i in alice_list["items"]] == ["rev-alice"]
        assert client.get("/api/reviews/rev-alice", headers=h_alice).status_code == 200
        assert client.get("/api/reviews/rev-bob", headers=h_alice).status_code == 404
        assert client.get("/api/telemetry/summary", headers=h_alice).json()["reviews"] == 1

        bob_list = client.get("/api/reviews", headers=h_bob).json()
        assert bob_list["total"] == 1
        assert [i["id"] for i in bob_list["items"]] == ["rev-bob"]
        assert client.get("/api/reviews/rev-alice", headers=h_bob).status_code == 404

        assert (
            client.post("/api/demo/replay/auth_sqli_pr", headers=h_alice).status_code == 403
        )
        assert client.post("/api/reviews/run/auth_sqli_pr", headers=h_alice).status_code == 403
