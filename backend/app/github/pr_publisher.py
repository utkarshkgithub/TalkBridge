"""Review publication with valid head-line anchors and a dry-run default."""

import asyncio
import html

from app.agents.dedupe_rank import severity_label
from app.github.client import GitHubFetcher
from app.schemas import PublishResult, ReviewResult


def finding_body(result: ReviewResult, index: int) -> str:
    finding = result.findings[index]
    # Escape HTML so model or repository content cannot inject mentions or markup controls.
    body = (
        f"{severity_label(finding)} ({finding.verification.calibrated_confidence}/100)\n\n"
        + html.escape(finding.candidate.reasoning).replace("@", "&#64;")
        + "\n\nRefutation attempted: "
        + html.escape(finding.verification.refutation_attempt).replace("@", "&#64;")
    )
    if finding.candidate.suggested_patch:
        body += (
            "\n\nSuggested patch (review before applying):\n\n<pre>"
            + html.escape(finding.candidate.suggested_patch).replace("@", "&#64;")
            + "</pre>"
        )
    return body[:20000]


class PRPublisher:
    def __init__(self, github: GitHubFetcher, *, enabled: bool = False) -> None:
        self.github = github
        self.enabled = enabled
        self.lock = asyncio.Lock()

    async def publish(self, result: ReviewResult) -> PublishResult:
        async with self.lock:
            return await self._publish(result)

    async def _ensure_check(
        self, result: ReviewResult, publication: PublishResult, headers: dict[str, str], status: str
    ) -> None:
        repo = f"/repos/{result.bundle.context.repo_full_name}"
        app_id, _ = await self.github.app_identity()
        response = await self.github.client.get(
            f"{repo}/commits/{result.bundle.context.head_sha}/check-runs",
            params={"check_name": "TalkBridge", "app_id": app_id, "per_page": 100},
            headers=headers,
        )
        response.raise_for_status()
        existing = [
            c for c in response.json().get("check_runs", []) if c.get("app", {}).get("id") == app_id
        ]
        body = {**publication.check, "output": {"title": "TalkBridge review", "summary": status}}
        if existing:
            # Keep one check on retry after a review was accepted but check creation failed.
            body.pop("head_sha")
            response = await self.github.client.patch(
                f"{repo}/check-runs/{existing[0]['id']}",
                headers=headers,
                json=body,
            )
        else:
            response = await self.github.client.post(
                f"{repo}/check-runs", headers=headers, json=body
            )
        response.raise_for_status()

    async def _publish(self, result: ReviewResult) -> PublishResult:
        bundle = result.bundle
        context = bundle.context
        comments: list[dict[str, str | int]] = []
        fallback: list[str] = []
        indices = []
        for index, finding in enumerate(result.findings):
            if finding.tier != "post_to_pr":
                continue
            candidate = finding.candidate
            valid = sorted(
                {
                    line.head_line
                    for h in bundle.hunks
                    if h.file == candidate.file
                    for line in h.lines
                    if line.kind != "deletion"
                    and line.head_line
                    and candidate.line_start <= line.head_line <= candidate.line_end
                }
            )
            body = finding_body(result, index)
            if valid:
                comments.append(
                    {"path": candidate.file, "line": valid[0], "side": "RIGHT", "body": body}
                )
                indices.append(index)
            else:
                fallback.append(f"{candidate.file}:{candidate.line_start}\n\n{body}")
        counts = {
            tier: sum(f.tier == tier for f in result.findings)
            for tier in ("post_to_pr", "dashboard_only", "discarded")
        }
        status = (
            "Partial review: inference or context processing was incomplete."
            if result.errors or bundle.sast_status != "completed" or bundle.warnings
            else "Review completed."
        )
        marker = f"<!-- talkbridge:{context.head_sha} -->"
        summary = (
            f"{marker}\n## TalkBridge review\n{status}\n\nDepth: {bundle.depth_mode.value}. "
            f"PR findings: {counts['post_to_pr']}. Dashboard only: {counts['dashboard_only']}. "
            f"Suppressed: {counts['discarded']}.\n\n" + "\n\n".join(fallback)
        )
        if bundle.warnings:
            summary += "\n\nContext warnings:\n" + "\n".join(
                "- " + html.escape(warning[:500]).replace("@", "&#64;")
                for warning in bundle.warnings[:10]
            )
        publication = PublishResult(
            dry_run=not self.enabled,
            inline_comments=comments,
            summary=summary[:60000],
            check={
                "name": "TalkBridge",
                "head_sha": context.head_sha,
                "status": "completed",
                "conclusion": "neutral",
                "external_id": context.delivery_id,
            },
        )
        if not self.enabled:
            return publication
        client = self.github.client
        headers = await self.github.installation_headers(context, write=True)
        _, app_slug = await self.github.app_identity()
        repo = f"/repos/{context.repo_full_name}"
        pr = f"{repo}/pulls/{context.pr_number}"
        response = await client.get(pr, headers=headers)
        response.raise_for_status()
        if response.json()["head"]["sha"] != context.head_sha:
            publication.warnings.append("PR head changed; stale review was not published")
            return publication
        # One review per head SHA, even across process restarts or reopened webhook deliveries.
        for page in range(1, 32):
            existing = await client.get(
                f"{pr}/reviews", params={"per_page": 100, "page": page}, headers=headers
            )
            existing.raise_for_status()
            reviews = existing.json()
            if any(
                marker in (r.get("body") or "")
                and r.get("user", {}).get("login") == f"{app_slug}[bot]"
                and r.get("user", {}).get("type") == "Bot"
                for r in reviews
            ):
                publication.warnings.append("Review already exists for this head SHA")
                await self._ensure_check(result, publication, headers, status)
                return publication
            if len(reviews) < 100:
                break
        else:
            raise RuntimeError("Too many reviews to safely deduplicate publication")
        review_payload = {
            "commit_id": context.head_sha,
            "event": "COMMENT",
            "body": publication.summary,
            "comments": comments,
        }
        response = await client.post(f"{pr}/reviews", headers=headers, json=review_payload)
        if response.status_code == 422 and comments:
            publication.warnings.append("GitHub rejected inline anchors; findings moved to summary")
            publication.summary = (
                publication.summary
                + "\n\n"
                + "\n\n".join(
                    str(c["path"]) + ":" + str(c["line"]) + "\n" + str(c["body"]) for c in comments
                )
            )[:60000]
            response = await client.post(
                f"{pr}/reviews",
                headers=headers,
                json={
                    "commit_id": context.head_sha,
                    "event": "COMMENT",
                    "body": publication.summary,
                },
            )
        else:
            response.raise_for_status()
            for index in indices:
                result.findings[index].posted_to_pr = True
        response.raise_for_status()
        await self._ensure_check(result, publication, headers, status)
        return publication
