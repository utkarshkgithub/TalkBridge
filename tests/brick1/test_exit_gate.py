import ast
import asyncio
import json
import time
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from app.config import Settings
from app.main import create_app
from app.pipeline.stage0 import Stage0
from app.schemas import PRSource
from app.workers.tasks import ReviewWorker
from fastapi.testclient import TestClient
from pydantic import SecretStr

FIXTURES = Path(__file__).resolve().parents[2] / "evaluation" / "fixtures"


@pytest.mark.parametrize(
    ("name", "depth", "hints"),
    [
        ("clean_small_pr", "quick", 0),
        ("noisy_lockfile_pr", "quick", 0),
        ("auth_sqli_pr", "deep", 1),
    ],
)
def test_stage0_exit_gate(name: str, depth: str, hints: int) -> None:
    source = PRSource.model_validate_json((FIXTURES / f"{name}.json").read_text())
    pipeline = Stage0(Settings(_env_file=None))
    start = time.perf_counter()
    bundle = pipeline.assemble(source)
    assert time.perf_counter() - start < 5
    assert bundle.sast_status == "completed", bundle.warnings
    assert not bundle.warnings
    assert bundle.depth_mode == depth
    assert len(bundle.sast_hints) == hints
    assert bundle.ast_chunks and not bundle.ast_chunks[0].fallback
    assert bundle.review_rules == source.review_rules
    assert bundle.cleaned_chars < bundle.original_chars
    assert all(line.github_position > 0 for h in bundle.hunks for line in h.lines)
    # Compare full serialized output while reusing the actual scanner's observed output.
    from unittest.mock import patch

    from app.pipeline.sast_scanner import ScanResult

    with patch.object(pipeline.scanner, "scan", return_value=ScanResult(hints=bundle.sast_hints)):
        assert pipeline.assemble(source).model_dump_json() == bundle.model_dump_json()


def test_pipeline_has_no_llm_imports() -> None:
    pipeline = Path(__file__).resolve().parents[2] / "backend" / "app" / "pipeline"
    for path in pipeline.glob("*.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                assert all(not n.name.startswith(("openai", "vllm", "app.llm")) for n in node.names)
            if isinstance(node, ast.ImportFrom):
                assert not (node.module or "").startswith(("openai", "vllm", "app.llm"))


def test_style_rules_keep_formatting_changes() -> None:
    source = PRSource.model_validate_json((FIXTURES / "clean_small_pr.json").read_text())
    source.diff = "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1 +1 @@\n-x = 1\n+x=1\n"
    source.files = {"a.py": "x=1\n"}
    pipeline = Stage0(Settings(_env_file=None))
    assert not pipeline.assemble(source).hunks
    source.review_rules = "<!-- talkbridge: enforce-style -->"
    from unittest.mock import patch

    from app.pipeline.sast_scanner import ScanResult

    with patch.object(pipeline.scanner, "scan", return_value=ScanResult()):
        assert pipeline.assemble(source).hunks


def test_signed_webhook_reaches_stage0_worker() -> None:
    import hashlib
    import hmac
    from uuid import uuid4

    source = PRSource.model_validate_json((FIXTURES / "clean_small_pr.json").read_text())
    settings = Settings(_env_file=None, github_webhook_secret=SecretStr("secret"))
    fetcher = AsyncMock()

    async def fetch(context):
        return source.model_copy(update={"context": context})

    fetcher.fetch.side_effect = fetch
    worker = ReviewWorker(fetcher, Stage0(settings).run)
    body = json.dumps(
        {
            "action": "opened",
            "repository": {"full_name": "college/demo"},
            "pull_request": {"number": 1, "head": {"sha": "head"}, "base": {"sha": "base"}},
        }
    ).encode()
    delivery = str(uuid4())
    with TestClient(create_app(settings, worker)) as client:
        response = client.post(
            "/webhooks/github",
            content=body,
            headers={
                "X-Hub-Signature-256": "sha256="
                + hmac.new(b"secret", body, hashlib.sha256).hexdigest(),
                "X-GitHub-Delivery": delivery,
                "X-GitHub-Event": "pull_request",
            },
        )
        assert response.status_code == 202
        client.portal.call(worker.queue.join)
        assert worker.results[delivery].depth_mode == "quick"
        assert not worker.failures
    assert not worker.tasks


def test_worker_survives_failed_job() -> None:
    source = PRSource.model_validate_json((FIXTURES / "clean_small_pr.json").read_text())

    async def scenario() -> None:
        fetcher = AsyncMock()
        fetcher.fetch.side_effect = [RuntimeError("test"), source]
        processor = AsyncMock(return_value=Stage0(Settings(_env_file=None)).assemble(source))
        worker = ReviewWorker(fetcher, processor)
        await worker.start()
        worker.enqueue(source.context.model_copy(update={"delivery_id": "fail"}))
        worker.enqueue(source.context)
        await worker.queue.join()
        assert "fail" in worker.failures
        assert source.context.delivery_id in worker.results
        await worker.close()

    asyncio.run(scenario())
