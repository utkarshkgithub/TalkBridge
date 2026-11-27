import asyncio
import hashlib
import hmac
import json
from unittest.mock import Mock
from uuid import uuid4

import pytest
from app.config import Settings
from app.main import create_app
from app.webhooks.github import DeliveryCache
from fastapi.testclient import TestClient
from pydantic import SecretStr


def payload(action: str = "opened") -> dict:
    return {
        "action": action,
        "repository": {"full_name": "college/demo"},
        "pull_request": {"number": 1, "head": {"sha": "head"}, "base": {"sha": "base"}},
    }


def signed(data: dict, delivery: str | None = None, event: str = "pull_request") -> tuple:
    body = json.dumps(data).encode()
    return body, {
        "X-Hub-Signature-256": "sha256=" + hmac.new(b"secret", body, hashlib.sha256).hexdigest(),
        "X-GitHub-Delivery": delivery or str(uuid4()),
        "X-GitHub-Event": event,
    }


def client_and_worker() -> tuple:
    worker = Mock()
    settings = Settings(_env_file=None, github_webhook_secret=SecretStr("secret"))
    return TestClient(create_app(settings, worker)), worker


@pytest.mark.parametrize("action", ["opened", "synchronize", "reopened"])
def test_valid_and_duplicate(action: str) -> None:
    client, worker = client_and_worker()
    body, headers = signed(payload(action))
    assert client.post("/webhooks/github", content=body, headers=headers).status_code == 202
    response = client.post("/webhooks/github", content=body, headers=headers)
    assert response.json()["status"] == "duplicate_ignored"
    worker.enqueue.assert_called_once()


@pytest.mark.parametrize("signature", [None, "sha256=bad", "sha256=é"])
def test_invalid_signature(signature: str | None) -> None:
    client, worker = client_and_worker()
    body, headers = signed(payload())
    headers.pop("X-Hub-Signature-256")
    if signature is not None:
        # HTTP headers are ASCII; exercise malformed signatures within that boundary.
        headers["X-Hub-Signature-256"] = signature.encode().hex()
    assert client.post("/webhooks/github", content=body, headers=headers).status_code == 401
    worker.enqueue.assert_not_called()


@pytest.mark.parametrize(("action", "event"), [("labeled", "pull_request"), ("opened", "issues")])
def test_ignored(action: str, event: str) -> None:
    client, worker = client_and_worker()
    body, headers = signed(payload(action), event=event)
    assert (
        client.post("/webhooks/github", content=body, headers=headers).json()["status"] == "ignored"
    )
    worker.enqueue.assert_not_called()


def test_queue_full_allows_retry() -> None:
    client, worker = client_and_worker()
    worker.enqueue.side_effect = [asyncio.QueueFull(), None]
    body, headers = signed(payload())
    assert client.post("/webhooks/github", content=body, headers=headers).status_code == 503
    assert client.post("/webhooks/github", content=body, headers=headers).status_code == 202


def test_invalid_payload_and_size() -> None:
    client, worker = client_and_worker()
    body, headers = signed({"action": "opened"})
    assert client.post("/webhooks/github", content=body, headers=headers).status_code == 422
    body, headers = signed(payload(), delivery="bad")
    assert client.post("/webhooks/github", content=body, headers=headers).status_code == 400
    client.app.state.settings.webhook_max_bytes = 1024
    assert client.post("/webhooks/github", content=b"a" * 1025).status_code == 413
    worker.enqueue.assert_not_called()


def test_cache_expiry(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = Mock(return_value=0)
    monkeypatch.setattr("app.webhooks.github.time.monotonic", clock)
    cache = DeliveryCache(ttl=10, capacity=1)
    assert cache.claim("one")
    assert not cache.claim("one")
    clock.return_value = 11
    assert cache.claim("one")


@pytest.mark.parametrize("action", [[], {}, None, 1])
def test_malformed_action_is_rejected_without_crashing(action: object) -> None:
    client, worker = client_and_worker()
    data = payload()
    data["action"] = action
    body, headers = signed(data)
    assert client.post("/webhooks/github", content=body, headers=headers).status_code == 422
    worker.enqueue.assert_not_called()


def test_null_optional_fields_accepted() -> None:
    client, worker = client_and_worker()
    data = payload()
    data["installation"] = None
    data["pull_request"]["title"] = None
    data["pull_request"]["user"] = None
    body, headers = signed(data)
    assert client.post("/webhooks/github", content=body, headers=headers).status_code == 202
    worker.enqueue.assert_called_once()
