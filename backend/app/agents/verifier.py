"""Bounded adversarial verification of exactly one candidate per request."""

import asyncio

from app.llm.prompts import build_verifier_prompt
from app.llm.vllm_client import InferenceFailure, VLLMClient
from app.schemas import (
    FinderCandidate,
    InferenceError,
    ReviewBundle,
    VerificationBatch,
    VerifiedCandidate,
    VerifierOutput,
)


async def verify_candidates(
    bundle: ReviewBundle, candidates: list[FinderCandidate], client: VLLMClient
) -> VerificationBatch:
    semaphore = asyncio.Semaphore(client.settings.verifier_concurrency)

    async def verify(candidate: FinderCandidate) -> VerificationBatch:
        async with semaphore:
            try:
                output, usage = await client.generate(
                    build_verifier_prompt(bundle, candidate),
                    VerifierOutput,
                    stage="verifier",
                    role=candidate.finding_id,
                )
                if output.finding_id != candidate.finding_id:
                    raise InferenceFailure(
                        InferenceError(
                            stage="verifier",
                            role=candidate.finding_id,
                            code="invalid_output",
                            message="Verifier returned a mismatched candidate ID",
                        )
                    )
                if output.verdict == "uncertain" and output.calibrated_confidence >= 80:
                    output.calibrated_confidence = 79
                return VerificationBatch(
                    findings=[VerifiedCandidate(candidate=candidate, verification=output)],
                    usage=[usage],
                )
            except InferenceFailure as exc:
                # Fail closed while preserving the candidate for later inspection.
                return VerificationBatch(
                    findings=[
                        VerifiedCandidate(
                            candidate=candidate,
                            verification=VerifierOutput(
                                finding_id=candidate.finding_id,
                                verdict="uncertain",
                                calibrated_confidence=0,
                                severity=candidate.severity,
                                refutation_attempt="Verification failed; no confidence assigned.",
                            ),
                        )
                    ],
                    errors=[exc.error],
                )

    batches = await asyncio.gather(*(verify(c) for c in candidates))
    return VerificationBatch(
        findings=[f for b in batches for f in b.findings],
        usage=[u for b in batches for u in b.usage],
        errors=[e for b in batches for e in b.errors],
    )
