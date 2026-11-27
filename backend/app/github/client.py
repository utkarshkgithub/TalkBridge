"""GitHub App reads pinned to the webhook's head SHA, with mockable HTTP transport."""

import base64
import time
from typing import Any
from urllib.parse import quote

import httpx
import jwt

from app.config import Settings
from app.pipeline.diff_cleaner import excluded
from app.schemas import PRContext, PRSource


class GitHubFetcher:
    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self.settings = settings
        self.client = client
        self._identity: tuple[int, str] | None = None

    def _app_token(self) -> str:
        now = int(time.time())
        return jwt.encode(
            {"iat": now - 60, "exp": now + 540, "iss": self.settings.github_app_id},
            self.settings.github_private_key.get_secret_value().replace("\\n", "\n"),
            algorithm="RS256",
        )

    async def app_identity(self) -> tuple[int, str]:
        """Resolve the authenticated App, not a user-supplied review marker."""
        if self._identity is None:
            response = await self.client.get(
                "/app", headers={"Authorization": f"Bearer {self._app_token()}"}
            )
            response.raise_for_status()
            data = response.json()
            self._identity = (int(data["id"]), str(data["slug"]))
        return self._identity

    async def installation_headers(
        self, context: PRContext, *, write: bool = False
    ) -> dict[str, str]:
        if not context.installation_id or not self.settings.github_app_id:
            raise RuntimeError("GitHub App ID, private key, and installation ID are required")
        token = self._app_token()
        response = await self.client.post(
            f"/app/installations/{context.installation_id}/access_tokens",
            headers={"Authorization": f"Bearer {token}"},
            json={
                "repositories": [context.repo_full_name.split("/")[1]],
                "permissions": (
                    {"contents": "read", "pull_requests": "write", "checks": "write"}
                    if write
                    else {"contents": "read", "pull_requests": "read"}
                ),
            },
        )
        response.raise_for_status()
        return {"Authorization": f"Bearer {response.json()['token']}"}

    async def fetch(self, context: PRContext) -> PRSource:
        headers = await self.installation_headers(context)
        repo = f"/repos/{context.repo_full_name}"
        pr = f"{repo}/pulls/{context.pr_number}"
        metadata = await self._get(pr, headers)
        if (
            metadata["head"]["sha"] != context.head_sha
            or metadata["base"]["sha"] != context.base_sha
        ):
            raise RuntimeError("Pull request changed since this webhook; wait for the new delivery")
        diff_response = await self.client.get(
            pr,
            headers={**headers, "Accept": "application/vnd.github.diff"},
        )
        diff_response.raise_for_status()
        files: dict[str, str] = {}
        total_bytes = 0
        for page in range(1, 32):
            changed = await self._get(f"{pr}/files?per_page=100&page={page}", headers)
            for item in changed:
                if item["status"] == "removed" or excluded(item["filename"]):
                    continue
                path = item["filename"]
                content = await self._content(repo, path, context.head_sha, headers)
                if content is not None:
                    total_bytes += len(content.encode())
                    if total_bytes > 10_000_000:
                        raise RuntimeError("Changed source exceeds the 10 MB review limit")
                    files[path] = content
            if len(changed) < 100:
                break
        else:
            raise RuntimeError("Pull request exceeds GitHub's 3000-file limit")
        rules = ""
        for name in ("REVIEW.md", "CLAUDE.md"):
            content = await self._content(repo, name, context.head_sha, headers)
            if content is not None:
                rules = content
                break
        commits = await self._get(f"{pr}/commits?per_page=20", headers)
        # Recheck after reads so a concurrent synchronize cannot mix two PR versions.
        latest = await self._get(pr, headers)
        if latest["head"]["sha"] != context.head_sha or latest["base"]["sha"] != context.base_sha:
            raise RuntimeError("Pull request changed during fetch; wait for the new delivery")
        return PRSource(
            context=context,
            diff=diff_response.text,
            files=files,
            review_rules=rules,
            commit_subjects=[c["commit"]["message"].splitlines()[0] for c in commits],
        )

    async def _get(self, path: str, headers: dict[str, str]) -> Any:
        response = await self.client.get(path, headers=headers)
        response.raise_for_status()
        return response.json()

    async def _content(
        self,
        repo: str,
        path: str,
        sha: str,
        headers: dict[str, str],
    ) -> str | None:
        response = await self.client.get(
            f"{repo}/contents/{quote(path, safe='/')}",
            params={"ref": sha},
            headers=headers,
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        data = response.json()
        if data.get("size", 0) > 1_000_000 or data.get("encoding") != "base64":
            return None
        try:
            raw = base64.b64decode(data["content"])
            return None if b"\0" in raw else raw.decode("utf-8")
        except (UnicodeDecodeError, ValueError):
            return None
