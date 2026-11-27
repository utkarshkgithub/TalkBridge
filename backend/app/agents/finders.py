"""Parallel independent finders; SAST evidence is visible only to A."""

import asyncio

from app.llm.prompts import AgentRole, build_finder_suffix, build_shared_prefix
from app.llm.vllm_client import InferenceFailure, VLLMClient
from app.schemas import DepthMode, FinderBatch, FinderOutput, InferenceError, ReviewBundle

MODES: dict[DepthMode, list[AgentRole]] = {
    DepthMode.QUICK: ["A"],
    DepthMode.STANDARD: ["A", "B", "C"],
    DepthMode.DEEP: ["A", "B", "C", "D"],
}


async def run_finders(
    bundle: ReviewBundle, client: VLLMClient, *, single: bool = False
) -> FinderBatch:
    prefix = build_shared_prefix(bundle)

    async def run(role: AgentRole) -> FinderBatch:
        try:
            output, usage = await client.generate(
                prefix + build_finder_suffix(role, bundle.sast_hints if role == "A" else None),
                FinderOutput,
                stage="finder",
                role=role,
            )
            findings = []
            if len(output.findings) > client.settings.max_candidates_per_agent:
                raise InferenceFailure(
                    InferenceError(
                        stage="finder",
                        role=role,
                        code="budget",
                        message="Finder exceeded the configured candidate limit",
                    )
                )
            # Canonical IDs and source tags are assigned by the host, never trusted to the model.
            for index, finding in enumerate(output.findings):
                if not any(
                    h.file == finding.file
                    and h.line_start <= finding.line_end
                    and finding.line_start <= h.line_end
                    for h in bundle.hunks
                ):
                    raise InferenceFailure(
                        InferenceError(
                            stage="finder",
                            role=role,
                            code="invalid_output",
                            message="Finder returned a location outside the reviewed diff",
                        )
                    )
                findings.append(
                    finding.model_copy(
                        update={"source_agent": role, "finding_id": f"{role}-{index + 1}"}
                    )
                )
            return FinderBatch(output=FinderOutput(findings=findings), usage=[usage])
        except InferenceFailure as exc:
            return FinderBatch(errors=[exc.error])

    roles: list[AgentRole] = ["A"] if single else MODES[bundle.depth_mode]
    batches = await asyncio.gather(*(run(r) for r in roles))
    return FinderBatch(
        output=FinderOutput(findings=[f for b in batches for f in b.output.findings]),
        usage=[u for b in batches for u in b.usage],
        errors=[e for b in batches for e in b.errors],
    )
