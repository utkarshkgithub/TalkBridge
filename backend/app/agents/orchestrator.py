"""Stages 0 through 4 with shared contracts and measured stage timings."""

import time
from collections.abc import Awaitable, Callable

from app.agents.dedupe_rank import dedupe_rank
from app.agents.finders import run_finders
from app.agents.verifier import verify_candidates
from app.github.pr_publisher import PRPublisher
from app.llm.vllm_client import VLLMClient
from app.pipeline.stage0 import Stage0
from app.schemas import (
    FinderBatch,
    PRSource,
    RankedFinding,
    ReviewBundle,
    ReviewResult,
    ReviewTelemetry,
    VerificationBatch,
    VerifiedCandidate,
    VerifierOutput,
)


class ReviewOrchestrator:
    def __init__(
        self, stage0: Stage0, client: VLLMClient, publisher: PRPublisher | None = None
    ) -> None:
        self.stage0 = stage0
        self.client = client
        self.publisher = publisher
        self.sandbox_hook: Callable[[ReviewBundle, list[RankedFinding]], Awaitable[str]] | None = (
            None
        )

    async def run(self, source: PRSource) -> ReviewResult:
        start = time.perf_counter()
        bundle = await self.stage0.run(source)
        elapsed = (time.perf_counter() - start) * 1000
        result = await self.review(bundle)
        result.telemetry.stage_ms["stage0"] = elapsed
        return result

    async def review(self, bundle: ReviewBundle, *, single: bool = False) -> ReviewResult:
        telemetry = ReviewTelemetry()
        start = time.perf_counter()
        finders = (
            await run_finders(bundle, self.client, single=single) if bundle.hunks else FinderBatch()
        )
        telemetry.stage_ms["stage1"] = (time.perf_counter() - start) * 1000
        start = time.perf_counter()
        if single:
            verified = VerificationBatch(
                findings=[
                    VerifiedCandidate(
                        candidate=c,
                        verification=VerifierOutput(
                            finding_id=c.finding_id,
                            verdict="uncertain",
                            refutation_attempt="Single-agent ablation, no verifier.",
                            calibrated_confidence=c.confidence,
                            severity=c.severity,
                        ),
                    )
                    for c in finders.output.findings
                ]
            )
        else:
            verified = await verify_candidates(bundle, finders.output.findings, self.client)
        telemetry.stage_ms["stage2"] = (time.perf_counter() - start) * 1000
        start = time.perf_counter()
        findings = dedupe_rank(verified.findings)
        telemetry.stage_ms["stage3"] = (time.perf_counter() - start) * 1000
        usages = finders.usage + verified.usage
        telemetry.inference_valid_calls = len(usages)
        telemetry.inference_failed_calls = len(finders.errors) + len(verified.errors)
        telemetry.verifier_attempts = 0 if single else len(verified.findings)
        telemetry.verifier_refutations = sum(
            f.verification.verdict == "refuted" for f in verified.findings
        )
        telemetry.prompt_tokens = sum(u.prompt_tokens for u in usages)
        telemetry.cached_tokens = sum(u.cached_tokens or 0 for u in usages)
        telemetry.cached_tokens_exposed = any(u.cached_tokens is not None for u in usages)
        result = ReviewResult(
            bundle=bundle,
            findings=findings,
            telemetry=telemetry,
            errors=finders.errors + verified.errors,
        )
        start = time.perf_counter()
        if self.client.settings.sandbox_test_enabled and bundle.depth_mode == "deep":
            if self.sandbox_hook is None:
                bundle.warnings.append("Sandbox tests enabled but no isolated runner is configured")
            else:
                bundle.warnings.append(await self.sandbox_hook(bundle, findings))
        if self.publisher:
            result.publication = await self.publisher.publish(result)
        telemetry.stage_ms["stage4"] = (time.perf_counter() - start) * 1000
        return result
