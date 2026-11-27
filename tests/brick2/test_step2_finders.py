import asyncio
import json

import httpx
import pytest
from app.agents.finders import run_finders
from app.config import Settings
from app.llm.vllm_client import VLLMClient
from app.schemas import FinderOutput
from conftest import completion


@pytest.mark.parametrize(
    ("mode", "roles"),
    [("quick", ["A"]), ("standard", ["A", "B", "C"]), ("deep", ["A", "B", "C", "D"])],
)
def test_parallel_isolation(bundle, candidate, mode, roles):
    async def run():
        active = 0
        peak = 0
        seen = []

        async def respond(request):
            nonlocal active, peak
            prompt = json.loads(request.content)["messages"][0]["content"]
            role = prompt.split("--- CACHE BOUNDARY ---\nAgent ")[1][0]
            seen.append(role)
            if role != "A":
                assert "secret-sast-marker" not in prompt and candidate.reasoning not in prompt
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.02)
            active -= 1
            return httpx.Response(200, json=completion(FinderOutput(findings=[candidate])))

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
            bundle.depth_mode = mode
            batch = await run_finders(bundle, VLLMClient(Settings(_env_file=None), http))
            assert seen == roles and peak == len(roles)
            assert [c.source_agent for c in batch.output.findings] == roles
            assert len({c.finding_id for c in batch.output.findings}) == len(roles)

    asyncio.run(run())


def test_one_failure_does_not_drop_other_agents(bundle, candidate):
    async def run():
        def respond(request):
            prompt = json.loads(request.content)["messages"][0]["content"]
            if "\nAgent A:" in prompt:
                raise httpx.ReadTimeout("fail", request=request)
            return httpx.Response(200, json=completion(FinderOutput(findings=[candidate])))

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
            batch = await run_finders(bundle, VLLMClient(Settings(_env_file=None), http))
            assert len(batch.output.findings) == 3 and len(batch.errors) == 1

    asyncio.run(run())


@pytest.mark.parametrize("problem", ["limit", "location"])
def test_invalid_or_excess_findings_are_not_silent(bundle, candidate, problem):
    async def run():
        output = (
            [candidate, candidate]
            if problem == "limit"
            else [candidate.model_copy(update={"file": "not-in-the-diff.py"})]
        )

        def respond(request):
            return httpx.Response(200, json=completion(FinderOutput(findings=output)))

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
            batch = await run_finders(
                bundle,
                VLLMClient(Settings(_env_file=None, max_candidates_per_agent=1), http),
                single=True,
            )
            assert not batch.output.findings
            assert len(batch.errors) == 1
            assert batch.errors[0].code == ("budget" if problem == "limit" else "invalid_output")

    asyncio.run(run())
