import asyncio
import base64
from unittest.mock import patch

import httpx
import pytest
from app.config import Settings
from app.github.client import GitHubFetcher
from app.schemas import PRContext
from pydantic import SecretStr


def test_github_app_fetch_uses_installation_and_head_ref() -> None:
    seen = []

    def respond(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        path = request.url.path
        if path.endswith("access_tokens"):
            assert request.headers["Authorization"] == "Bearer signed-jwt"
            return httpx.Response(201, json={"token": "installation-token"})
        assert request.headers["Authorization"] == "Bearer installation-token"
        if path.endswith("/files"):
            return httpx.Response(200, json=[{"filename": "src/a.py", "status": "modified"}])
        if "/contents/" in path:
            assert request.url.params["ref"] == "head"
            if path.endswith("REVIEW.md"):
                return httpx.Response(404)
            text = "Repo rules\n" if path.endswith("CLAUDE.md") else "def f(): return 1\n"
            return httpx.Response(
                200,
                json={
                    "size": len(text),
                    "encoding": "base64",
                    "content": base64.b64encode(text.encode()).decode(),
                },
            )
        if path.endswith("/commits"):
            return httpx.Response(200, json=[{"commit": {"message": "Fix behavior\n\nBody"}}])
        if request.headers["Accept"] == "application/vnd.github.diff":
            return httpx.Response(200, text="diff --git a/src/a.py b/src/a.py\n")
        return httpx.Response(200, json={"head": {"sha": "head"}, "base": {"sha": "base"}})

    async def scenario() -> None:
        context = PRContext(
            delivery_id="fixture",
            action="opened",
            repo_full_name="college/demo",
            pr_number=1,
            head_sha="head",
            base_sha="base",
            installation_id=10,
        )
        settings = Settings(
            _env_file=None, github_app_id="123", github_private_key=SecretStr("test")
        )
        async with httpx.AsyncClient(
            base_url="https://api.github.com",
            transport=httpx.MockTransport(respond),
            headers={"Accept": "application/vnd.github+json"},
        ) as client:
            with patch("app.github.client.jwt.encode", return_value="signed-jwt"):
                source = await GitHubFetcher(settings, client).fetch(context)
            assert source.files == {"src/a.py": "def f(): return 1\n"}
            assert source.review_rules == "Repo rules\n"
            assert source.commit_subjects == ["Fix behavior"]
            with patch("app.github.client.jwt.encode", return_value="signed-jwt"):
                with pytest.raises(RuntimeError, match="changed since"):
                    await GitHubFetcher(settings, client).fetch(
                        context.model_copy(update={"head_sha": "stale"})
                    )

    asyncio.run(scenario())
    assert len(seen) >= 8
