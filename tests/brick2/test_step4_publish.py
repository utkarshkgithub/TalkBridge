import asyncio
import json
from unittest.mock import AsyncMock

import httpx
import pytest
from app.agents.dedupe_rank import dedupe_rank, severity_label
from app.agents.orchestrator import ReviewOrchestrator
from app.config import Settings
from app.github.client import GitHubFetcher
from app.github.pr_publisher import PRPublisher
from app.llm.vllm_client import VLLMClient
from app.pipeline.stage0 import Stage0
from app.schemas import FinderOutput, PRSource, ReviewResult, ReviewTelemetry, VerifierOutput
from conftest import completion, verified


def test_dedupe_gates_and_richest_patch(candidate):
    other = candidate.model_copy(
        update={
            "finding_id": "D-1",
            "source_agent": "D",
            "cwe_id": "cwe-89",
            "line_start": 7,
            "line_end": 8,
            "suggested_patch": "parameterized binding",
            "unit_test": "def test_sqli(): ...",
        }
    )
    items = [
        verified(candidate, 88, severity="nit"),
        verified(other, 85, pre_existing=True),
        verified(candidate.model_copy(update={"finding_id": "B-1", "file": "b.py"}), 67),
        verified(candidate.model_copy(update={"finding_id": "C-1", "file": "c.py"}), 34),
        verified(
            candidate.model_copy(update={"finding_id": "C-2", "file": "d.py"}),
            99,
            verdict="refuted",
        ),
    ]
    result = dedupe_rank(items)
    kept = next(f for f in result if f.candidate.file == candidate.file)
    assert len(result) == 4 and kept.verification.calibrated_confidence == 88
    assert kept.verification.severity == "important"
    assert kept.verification.pre_existing is True
    assert kept.candidate.suggested_patch == "parameterized binding"
    assert kept.candidate.unit_test == "def test_sqli(): ..."
    assert (kept.candidate.line_start, kept.candidate.line_end) == (4, 8)
    assert {f.candidate.file: f.tier for f in result} == {
        candidate.file: "post_to_pr",
        "b.py": "dashboard_only",
        "c.py": "discarded",
        "d.py": "discarded",
    }
    assert severity_label(kept) == "🟣 Pre-existing"
    kept.verification.pre_existing = False
    assert severity_label(kept) == "🔴 Important"


@pytest.mark.parametrize(
    "score,tier",
    [
        (0, "discarded"),
        (49, "discarded"),
        (50, "dashboard_only"),
        (79, "dashboard_only"),
        (80, "post_to_pr"),
        (100, "post_to_pr"),
    ],
)
def test_boundaries(candidate, score, tier):
    assert dedupe_rank([verified(candidate, score)])[0].tier == tier


@pytest.mark.parametrize("scenario", ["normal", "422", "stale", "duplicate", "dry"])
def test_publication(bundle, candidate, scenario):
    async def run():
        result = ReviewResult(
            bundle=bundle, findings=dedupe_rank([verified(candidate)]), telemetry=ReviewTelemetry()
        )
        seen = []

        def respond(request):
            seen.append(request)
            if request.method == "GET" and request.url.path.endswith("/reviews"):
                return httpx.Response(
                    200,
                    json=[
                        {
                            "body": f"<!-- talkbridge:{bundle.context.head_sha} -->",
                            "user": {"login": "talkbridge[bot]", "type": "Bot"},
                        }
                    ]
                    if scenario == "duplicate"
                    else [],
                )
            if request.method == "GET":
                return httpx.Response(
                    200,
                    json={
                        "head": {"sha": "stale" if scenario == "stale" else bundle.context.head_sha}
                    },
                )
            body = json.loads(request.content)
            if request.url.path.endswith("/check-runs"):
                assert body["conclusion"] == "neutral" and body["status"] == "completed"
            elif body.get("comments"):
                assert body["comments"][0]["line"] == 4 and body["comments"][0]["side"] == "RIGHT"
                if scenario == "422":
                    return httpx.Response(422)
            return httpx.Response(201, json={"id": 1})

        async with httpx.AsyncClient(
            base_url="https://api.github.com", transport=httpx.MockTransport(respond)
        ) as http:
            github = GitHubFetcher(Settings(_env_file=None), http)
            github.app_identity = AsyncMock(return_value=(42, "talkbridge"))
            github.installation_headers = AsyncMock(return_value={"Authorization": "Bearer fake"})
            publication = await PRPublisher(github, enabled=scenario != "dry").publish(result)
            assert f"<!-- talkbridge:{bundle.context.head_sha} -->" in publication.summary
            assert "PR findings: 1" in publication.summary
            if scenario == "dry":
                assert not seen and publication.dry_run and not result.findings[0].posted_to_pr
            elif scenario in ("stale", "duplicate"):
                assert publication.warnings
                assert not any(r.method == "POST" and r.url.path.endswith("/reviews") for r in seen)
            else:
                assert seen[-1].url.path.endswith("/check-runs")
                assert result.findings[0].posted_to_pr is (scenario == "normal")
                if scenario == "422":
                    assert "Unsanitized parameter" in publication.summary and publication.warnings

    asyncio.run(run())


def test_invalid_location_falls_back_to_summary(bundle, candidate):
    async def run():
        candidate.line_start = 99
        candidate.line_end = 99
        result = ReviewResult(
            bundle=bundle, findings=dedupe_rank([verified(candidate)]), telemetry=ReviewTelemetry()
        )
        async with httpx.AsyncClient() as http:
            publication = await PRPublisher(GitHubFetcher(Settings(_env_file=None), http)).publish(
                result
            )
            assert not publication.inline_comments
            assert "auth/login.py:99" in publication.summary

    asyncio.run(run())


def test_sandboxed_stages_zero_to_four():
    from pathlib import Path

    source = PRSource.model_validate_json(
        (Path("evaluation/fixtures/auth_sqli_pr.json")).read_text()
    )
    requests = []

    async def run():
        def respond(request):
            requests.append(request)
            if "/chat/completions" in request.url.path:
                body = json.loads(request.content)
                prompt = body["messages"][0]["content"]
                if "Verify exactly one" in prompt:
                    data = json.loads(prompt.split("\n")[-1])
                    output = VerifierOutput(
                        finding_id=data["candidate"]["finding_id"],
                        verdict="confirmed",
                        calibrated_confidence=92,
                        severity="important",
                        refutation_attempt="No binding or sanitizer",
                    )
                else:
                    from app.schemas import FinderCandidate

                    output = FinderOutput(
                        findings=[
                            FinderCandidate(
                                file="auth/login.py",
                                line_start=3,
                                line_end=3,
                                finding_id="remote",
                                source_agent="A",
                                category="security",
                                cwe_id="CWE-89",
                                confidence=90,
                                reasoning="User input enters f-string SQL",
                            )
                        ]
                    )
                return httpx.Response(200, json=completion(output))
            if request.method == "GET":
                return httpx.Response(
                    200,
                    json=[]
                    if request.url.path.endswith("/reviews")
                    else {"head": {"sha": source.context.head_sha}},
                )
            return httpx.Response(201, json={"id": 1})

        settings = Settings(_env_file=None)
        async with httpx.AsyncClient(
            base_url="https://api.github.com", transport=httpx.MockTransport(respond)
        ) as http:
            github = GitHubFetcher(settings, http)
            github.app_identity = AsyncMock(return_value=(42, "talkbridge"))
            github.installation_headers = AsyncMock(return_value={})
            pipeline = ReviewOrchestrator(
                Stage0(settings), VLLMClient(settings, http), PRPublisher(github, enabled=True)
            )
            result = await pipeline.run(source)
            assert result.bundle.sast_status == "completed" and not result.errors
            assert set(result.telemetry.stage_ms) == {
                "stage0",
                "stage1",
                "stage2",
                "stage3",
                "stage4",
            }
            assert len(result.findings) == 1
            assert result.findings[0].posted_to_pr
            assert result.publication.check["conclusion"] == "neutral"
            assert any(r.url.path.endswith("/reviews") and r.method == "POST" for r in requests)

    asyncio.run(run())


def test_review_retry_repairs_check_without_duplicate_comments(bundle, candidate):
    async def run():
        result = ReviewResult(
            bundle=bundle, findings=dedupe_rank([verified(candidate)]), telemetry=ReviewTelemetry()
        )
        reviews = []
        checks = []
        fail_check = True

        def respond(request):
            nonlocal fail_check
            if request.method == "GET":
                if request.url.path.endswith("/reviews"):
                    return httpx.Response(200, json=reviews)
                if request.url.path.endswith("/check-runs"):
                    return httpx.Response(200, json={"check_runs": checks})
                return httpx.Response(200, json={"head": {"sha": bundle.context.head_sha}})
            if request.url.path.endswith("/reviews"):
                reviews.append(
                    {
                        **json.loads(request.content),
                        "user": {"login": "talkbridge[bot]", "type": "Bot"},
                    }
                )
                return httpx.Response(201, json={"id": 1})
            if request.url.path.endswith("/check-runs"):
                if fail_check:
                    fail_check = False
                    return httpx.Response(500)
                checks.append({"id": 20, "app": {"id": 42}})
                return httpx.Response(201, json={"id": 20})
            assert request.method == "PATCH" and request.url.path.endswith("/check-runs/20")
            assert json.loads(request.content)["conclusion"] == "neutral"
            return httpx.Response(200, json={"id": 20})

        async with httpx.AsyncClient(
            base_url="https://api.github.com", transport=httpx.MockTransport(respond)
        ) as http:
            github = GitHubFetcher(Settings(_env_file=None), http)
            github.app_identity = AsyncMock(return_value=(42, "talkbridge"))
            github.installation_headers = AsyncMock(return_value={})
            publisher = PRPublisher(github, enabled=True)
            with pytest.raises(httpx.HTTPStatusError):
                await publisher.publish(result)
            await publisher.publish(result)
            await publisher.publish(result)
            assert len(reviews) == len(checks) == 1

    asyncio.run(run())


def test_runtime_wires_review_worker(bundle):
    from unittest.mock import patch

    from app.main import create_app
    from fastapi.testclient import TestClient

    source = PRSource(context=bundle.context, diff="", files={})
    expected = ReviewResult(bundle=bundle, findings=[], telemetry=ReviewTelemetry())
    with (
        patch("app.agents.orchestrator.ReviewOrchestrator") as factory,
        patch("app.github.client.GitHubFetcher.fetch", new=AsyncMock(return_value=source)),
    ):
        factory.return_value.run = AsyncMock(return_value=expected)
        application = create_app(Settings(_env_file=None, review_enabled=True))
        with TestClient(application) as client:
            application.state.worker.enqueue(bundle.context)
            client.portal.call(application.state.worker.queue.join)
            assert application.state.worker.results[bundle.context.delivery_id] == expected
            factory.return_value.run.assert_awaited_once_with(source)


def test_noise_only_bundle_uses_no_inference(bundle):
    async def run():
        def reject(request):
            pytest.fail("Noise-only PR must not call inference")

        async with httpx.AsyncClient(transport=httpx.MockTransport(reject)) as http:
            bundle.hunks = []
            result = await ReviewOrchestrator(
                Stage0(Settings(_env_file=None)), VLLMClient(Settings(_env_file=None), http)
            ).review(bundle)
            assert result.findings == [] and result.telemetry.inference_valid_calls == 0

    asyncio.run(run())


@pytest.mark.parametrize("status", ["timeout", "error", "unavailable"])
def test_sast_failure_is_published_as_partial(bundle, status):
    async def run():
        bundle.sast_status = status
        bundle.warnings = ["Semgrep could not complete"]
        result = ReviewResult(bundle=bundle, findings=[], telemetry=ReviewTelemetry())
        async with httpx.AsyncClient() as http:
            publication = await PRPublisher(GitHubFetcher(Settings(_env_file=None), http)).publish(
                result
            )
            assert "Partial review" in publication.summary
            assert "Semgrep could not complete" in publication.summary
            assert "Review completed." not in publication.summary

    asyncio.run(run())


def test_foreign_marker_and_check_do_not_block_publication(bundle, candidate):
    async def run():
        result = ReviewResult(
            bundle=bundle, findings=dedupe_rank([verified(candidate)]), telemetry=ReviewTelemetry()
        )
        posts = []

        def respond(request):
            if request.method == "GET":
                if request.url.path.endswith("/reviews"):
                    return httpx.Response(
                        200,
                        json=[
                            {
                                "body": f"<!-- talkbridge:{bundle.context.head_sha} -->",
                                "user": {"login": "someone-else", "type": "User"},
                            }
                        ],
                    )
                if request.url.path.endswith("/check-runs"):
                    assert request.url.params["app_id"] == "42"
                    return httpx.Response(200, json={"check_runs": [{"id": 9, "app": {"id": 99}}]})
                return httpx.Response(200, json={"head": {"sha": bundle.context.head_sha}})
            assert request.method == "POST"
            posts.append(request.url.path)
            return httpx.Response(201, json={"id": 20})

        async with httpx.AsyncClient(
            base_url="https://api.github.com", transport=httpx.MockTransport(respond)
        ) as http:
            github = GitHubFetcher(Settings(_env_file=None), http)
            github.app_identity = AsyncMock(return_value=(42, "talkbridge"))
            github.installation_headers = AsyncMock(return_value={})
            await PRPublisher(github, enabled=True).publish(result)
            assert (
                len(posts) == 2
                and posts[0].endswith("/reviews")
                and posts[1].endswith("/check-runs")
            )

    asyncio.run(run())


def test_app_identity_is_authenticated_and_cached(bundle):
    from unittest.mock import patch

    from pydantic import SecretStr

    async def run():
        seen = []

        def respond(request):
            seen.append(request)
            assert request.headers["Authorization"] == "Bearer signed-app-jwt"
            if request.url.path == "/app":
                return httpx.Response(200, json={"id": 42, "slug": "talkbridge"})
            assert json.loads(request.content)["permissions"] == {
                "contents": "read",
                "pull_requests": "write",
                "checks": "write",
            }
            return httpx.Response(201, json={"token": "installation-token"})

        async with httpx.AsyncClient(
            base_url="https://api.github.com", transport=httpx.MockTransport(respond)
        ) as http:
            github = GitHubFetcher(
                Settings(
                    _env_file=None, github_app_id="42", github_private_key=SecretStr("fixture-key")
                ),
                http,
            )
            with patch("app.github.client.jwt.encode", return_value="signed-app-jwt"):
                assert await github.app_identity() == (42, "talkbridge")
                assert await github.app_identity() == (42, "talkbridge")
                headers = await github.installation_headers(
                    bundle.context.model_copy(update={"installation_id": 10}), write=True
                )
                assert headers == {"Authorization": "Bearer installation-token"}
            assert len(seen) == 2

    asyncio.run(run())
