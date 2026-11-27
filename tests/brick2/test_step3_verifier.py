import asyncio
import json

import httpx
import pytest
from app.agents.verifier import verify_candidates
from app.config import Settings
from app.llm.vllm_client import VLLMClient
from app.schemas import VerifierOutput
from conftest import completion


@pytest.mark.parametrize("safe", [False, True])
def test_refutation_context_and_contract(bundle, candidate, safe):
    async def run():
        source = (
            'cursor.execute("SELECT * FROM users WHERE id = %s", (uid,))'
            if safe
            else 'cursor.execute(f"SELECT * FROM users WHERE id = {uid}")'
        )
        bundle.ast_chunks[0].source = source

        def respond(request):
            prompt = json.loads(request.content)["messages"][0]["content"]
            assert "DISPROVE" in prompt and json.dumps(source)[1:-1] in prompt
            assert "SastHint" not in prompt and "secret-sast-marker" not in prompt
            return httpx.Response(
                200,
                json=completion(
                    VerifierOutput(
                        finding_id=candidate.finding_id,
                        verdict="refuted" if safe else "confirmed",
                        calibrated_confidence=5 if safe else 92,
                        severity="important",
                        refutation_attempt="Parameterized binding"
                        if safe
                        else "No sanitizer found",
                    )
                ),
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
            result = await verify_candidates(
                bundle, [candidate], VLLMClient(Settings(_env_file=None), http)
            )
            output = result.findings[0].verification
            assert output.verdict == ("refuted" if safe else "confirmed")
            assert (output.calibrated_confidence >= 80) is not safe

    asyncio.run(run())


def test_bounded_single_candidate_and_fail_closed(bundle, candidate):
    async def run():
        active = peak = 0

        async def respond(request):
            nonlocal active, peak
            prompt = json.loads(request.content)["messages"][0]["content"]
            assert prompt.count('"finding_id"') == 1
            active += 1
            peak = max(active, peak)
            await asyncio.sleep(0.01)
            active -= 1
            return httpx.Response(
                200,
                json=completion(
                    VerifierOutput(
                        finding_id="wrong-id",
                        verdict="confirmed",
                        calibrated_confidence=99,
                        severity="important",
                        refutation_attempt="bad",
                    )
                ),
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
            candidates = [candidate.model_copy(update={"finding_id": f"A-{i}"}) for i in range(5)]
            result = await verify_candidates(
                bundle,
                candidates,
                VLLMClient(Settings(_env_file=None, verifier_concurrency=2), http),
            )
            assert peak == 2 and len(result.errors) == 5
            assert all(x.verification.calibrated_confidence == 0 for x in result.findings)

    asyncio.run(run())


@pytest.mark.live_vllm
@pytest.mark.parametrize("safe", [False, True])
def test_live_sql_pair(bundle, candidate, safe):
    import os

    from evaluation.run_eval import evaluation_settings

    if os.environ.get("LIVE_VLLM") != "1":
        pytest.skip("Set LIVE_VLLM=1 for actual base 8B verification")

    async def run():
        bundle.ast_chunks[0].source = (
            'def login(uid, cursor):\n    cursor.execute("SELECT * FROM users WHERE id = %s", (uid,))'
            if safe
            else 'def login(uid, cursor):\n    cursor.execute(f"SELECT * FROM users WHERE id = {uid}")'
        )
        async with httpx.AsyncClient() as http:
            result = await verify_candidates(
                bundle, [candidate], VLLMClient(evaluation_settings(), http)
            )
            assert not result.errors
            verdict = result.findings[0].verification
            if safe:
                assert verdict.verdict == "refuted" or verdict.calibrated_confidence < 80
            else:
                assert verdict.verdict == "confirmed" and verdict.calibrated_confidence >= 80

    asyncio.run(run())


def test_uncertain_cannot_reach_publication_threshold(bundle, candidate):
    async def run():
        def respond(request):
            return httpx.Response(
                200,
                json=completion(
                    VerifierOutput(
                        finding_id=candidate.finding_id,
                        verdict="uncertain",
                        calibrated_confidence=99,
                        severity="important",
                        refutation_attempt="Missing caller context",
                    )
                ),
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
            result = await verify_candidates(
                bundle, [candidate], VLLMClient(Settings(_env_file=None), http)
            )
            assert result.findings[0].verification.calibrated_confidence == 79

    asyncio.run(run())


def test_verifier_scopes_context_to_overlapping_chunks(bundle, candidate):
    unrelated = bundle.ast_chunks[0].model_copy(
        update={"line_start": 200, "line_end": 220, "symbol": "unrelated_fn", "source": "UNRELATED"}
    )
    bundle.ast_chunks.append(unrelated)
    from app.llm.prompts import build_verifier_prompt

    prompt = build_verifier_prompt(bundle, candidate)
    assert "unrelated_fn" not in prompt
    assert "UNRELATED" not in prompt
