import time
from unittest.mock import AsyncMock, patch
from urllib.parse import urlencode
from uuid import uuid4

import psycopg
import pytest
from app.config import Settings
from app.main import create_app
from app.storage.replay import load_fixture
from app.workers.tasks import ReviewWorker
from fastapi.testclient import TestClient
from psycopg import sql


@pytest.fixture
def database_url():
    import os

    base = os.environ.get(
        "TEST_DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/talkbridge"
    )
    name = "tb_test_" + uuid4().hex
    with psycopg.connect(base, autocommit=True) as connection:
        connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(name)))
    separator = "&" if "?" in base else "?"
    yield base + separator + urlencode({"options": f"-csearch_path={name}"})
    with psycopg.connect(base, autocommit=True) as connection:
        connection.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(name)))


def test_replay_persistence_and_offline_api(database_url):
    settings = Settings(
        _env_file=None, storage_enabled=True, demo_replay_mode=True, database_url=database_url
    )
    with patch("httpx.AsyncClient.send", side_effect=AssertionError("Replay must never use HTTP")):
        with TestClient(create_app(settings)) as client:
            started = time.perf_counter()
            response = client.post("/api/demo/replay/auth_sqli_pr")
            assert time.perf_counter() - started < 0.5
            assert response.status_code == 200
            review = response.json()
            assert review["model_profile"] == "replay"
            assert [
                f["verification"]["calibrated_confidence"] for f in review["result"]["findings"]
            ] == [92, 65, 35]
            assert not any(f["posted_to_pr"] for f in review["result"]["findings"])
            assert client.get("/api/reviews/" + review["id"]).json() == review
            assert client.get("/api/reviews?limit=1").json()["total"] == 3
            assert len(client.get("/api/reviews?limit=1").json()["items"]) == 1
            assert client.get("/api/reviews?limit=0").status_code == 422
            assert client.post("/api/demo/replay/not-a-fixture").status_code == 404
            assert client.get("/api/reviews/missing").status_code == 404
            assert client.post("/api/reviews/run/auth_sqli_pr").status_code == 409
            metrics = client.get("/api/telemetry/summary").json()
            assert metrics["reviews"] == 3 and metrics["candidates"] == 4
            assert metrics["posted"] == 0 and metrics["suppression_rate"] == 0.5
        with TestClient(create_app(settings)) as restarted:
            assert restarted.get("/api/reviews/demo-auth_sqli_pr").status_code == 200
    with psycopg.connect(database_url) as connection:
        assert connection.execute("SELECT count(*) FROM reviews").fetchone()[0] == 3
        assert connection.execute("SELECT count(*) FROM findings").fetchone()[0] == 4
        assert connection.execute("SELECT count(*) FROM diff_hunks").fetchone()[0] == 3


def test_worker_result_is_persisted(database_url):
    fixture = load_fixture("auth_sqli_pr")
    fetcher = AsyncMock()
    fetcher.fetch.return_value = fixture.source
    worker = ReviewWorker(fetcher, AsyncMock(return_value=fixture.result))
    settings = Settings(_env_file=None, storage_enabled=True, database_url=database_url)
    with TestClient(create_app(settings, worker)) as client:
        worker.enqueue(fixture.source.context)
        client.portal.call(worker.queue.join)
        review = client.get("/api/reviews/" + fixture.source.context.delivery_id).json()
        assert review["model_profile"] == "base_8b"
        assert len(review["result"]["findings"]) == 3
        assert not worker.failures


def test_storage_disabled_returns_actionable_response():
    with TestClient(create_app(Settings(_env_file=None))) as client:
        assert client.get("/api/reviews").status_code == 503
        assert "STORAGE_ENABLED" in client.get("/api/reviews").json()["detail"]


def test_live_route_runs_inference_instead_of_replay(database_url):
    import json

    import httpx

    requests = []

    async def send(client, request, **kwargs):
        requests.append(request)
        assert request.url.path.endswith("/chat/completions")
        assert json.loads(request.content)["model"] == "Qwen/Qwen3-8B-AWQ"
        return httpx.Response(
            200,
            request=request,
            json={
                "choices": [{"finish_reason": "stop", "message": {"content": '{"findings":[]}'}}],
                "usage": {"prompt_tokens": 100},
            },
        )

    settings = Settings(
        _env_file=None,
        storage_enabled=True,
        review_enabled=True,
        demo_replay_mode=False,
        database_url=database_url,
    )
    with patch("httpx.AsyncClient.send", new=send), TestClient(create_app(settings)) as client:
        response = client.post("/api/reviews/run/auth_sqli_pr")
        assert response.status_code == 200
        review = response.json()
        assert review["model_profile"] == "base_8b" and review["result"]["findings"] == []
        assert len(requests) == 4
        assert client.get("/api/reviews/" + review["id"]).json() == review
        assert client.get("/api/telemetry/summary").json()["cache_hit_ratio"] is None


def test_live_deadline_releases_slot_and_does_not_save_incomplete_results(database_url):
    import asyncio

    import httpx
    from app.pipeline.stage0 import Stage0

    async def slow_send(client, request, **kwargs):
        await asyncio.sleep(30)
        raise AssertionError("The deadline should cancel inference")

    async def fast_send(client, request, **kwargs):
        return httpx.Response(
            200,
            request=request,
            json={
                "choices": [{"finish_reason": "stop", "message": {"content": '{"findings":[]}'}}],
                "usage": {"prompt_tokens": 10},
            },
        )

    settings = Settings(
        _env_file=None,
        storage_enabled=True,
        review_enabled=True,
        database_url=database_url,
        live_review_timeout_seconds=0.02,
    )
    fixture = load_fixture("auth_sqli_pr")
    with (
        patch.object(Stage0, "run", new=AsyncMock(return_value=fixture.result.bundle)),
        TestClient(create_app(settings)) as client,
    ):
        with patch("httpx.AsyncClient.send", new=slow_send):
            response = client.post("/api/reviews/run/auth_sqli_pr")
        assert response.status_code == 504
        assert "timed out" in response.json()["detail"]
        assert client.get("/api/reviews").json()["total"] == 0
        settings.live_review_timeout_seconds = 1
        with patch("httpx.AsyncClient.send", new=fast_send):
            assert client.post("/api/reviews/run/auth_sqli_pr").status_code == 200
        assert client.get("/api/reviews").json()["total"] == 1
