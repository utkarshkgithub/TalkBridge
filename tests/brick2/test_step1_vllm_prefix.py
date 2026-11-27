import asyncio
import json

import httpx
import pytest
from app.config import Settings
from app.llm.prompts import build_finder_suffix, build_shared_prefix
from app.llm.vllm_client import InferenceFailure, VLLMClient
from app.schemas import FinderOutput, VerifierOutput
from conftest import completion


def test_prefix_identical_and_isolated(bundle):
    prompts = [
        build_shared_prefix(bundle)
        + build_finder_suffix(r, bundle.sast_hints if r == "A" else None)
        for r in ["A", "B", "C", "D"]
    ]
    prefixes = [p.split("--- CACHE BOUNDARY ---")[0].encode() for p in prompts]
    assert len(set(prefixes)) == 1
    assert "secret-sast-marker" in prompts[0]
    assert all("secret-sast-marker" not in p and "SastHint" not in p for p in prompts[1:])
    with pytest.raises(ValueError):
        build_finder_suffix("B", bundle.sast_hints)


@pytest.mark.parametrize("mode", ["guided_json", "structured_outputs"])
@pytest.mark.parametrize("schema", [FinderOutput, VerifierOutput])
def test_schema_and_usage(mode, schema):
    output = (
        FinderOutput()
        if schema is FinderOutput
        else VerifierOutput(
            finding_id="A-1",
            verdict="refuted",
            refutation_attempt="Bound parameter",
            calibrated_confidence=0,
            severity="important",
        )
    )

    async def run():
        def respond(request):
            body = json.loads(request.content)
            actual = (
                body["guided_json"] if mode == "guided_json" else body["structured_outputs"]["json"]
            )
            assert actual == schema.model_json_schema()
            return httpx.Response(200, json=completion(output))

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
            client = VLLMClient(Settings(_env_file=None, vllm_schema_mode=mode), http)
            result, usage = await client.generate("prompt", schema, stage="finder", role="A")
            assert result == output
            assert usage.prompt_tokens == 100 and usage.cached_tokens == 12
            assert usage.latency_ms >= 0

    asyncio.run(run())


@pytest.mark.parametrize("kind", ["json", "timeout", "http", "truncated", "shape", "budget"])
def test_structured_failure(kind):
    async def run():
        def respond(request):
            if kind == "timeout":
                raise httpx.ReadTimeout("secret response", request=request)
            if kind == "http":
                return httpx.Response(500, text="secret")
            if kind == "shape":
                return httpx.Response(200, json=[])
            data = completion("{broken")
            if kind == "truncated":
                data["choices"][0]["finish_reason"] = "length"
            return httpx.Response(200, json=data)

        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
            client = VLLMClient(Settings(_env_file=None), http)
            with pytest.raises(InferenceFailure) as error:
                await client.generate(
                    "x" * (100001 if kind == "budget" else 1),
                    FinderOutput,
                    stage="finder",
                    role="A",
                )
            assert error.value.error.code == {
                "json": "invalid_output",
                "truncated": "invalid_output",
                "shape": "invalid_output",
            }.get(kind, kind)
            assert "secret" not in str(error.value)

    asyncio.run(run())


@pytest.mark.live_vllm
def test_live_four_finders_and_prefix_ttft(bundle):
    import os
    import statistics
    import time

    from app.agents.finders import run_finders

    if os.environ.get("LIVE_VLLM") != "1" or os.environ.get("ALLOW_CACHE_RESET") != "1":
        pytest.skip("Set LIVE_VLLM=1 and ALLOW_CACHE_RESET=1 on a dedicated vLLM server")

    async def run():
        from evaluation.run_eval import evaluation_settings

        settings = evaluation_settings()
        bundle.ast_chunks[0].source = "\n".join(
            f'def lookup_{i}(uid, cursor):\n    return cursor.execute("SELECT %s", (uid,))'
            for i in range(60)
        )
        async with httpx.AsyncClient(timeout=settings.vllm_timeout_seconds) as http:
            client = VLLMClient(settings, http)
            batch = await run_finders(bundle, client)
            assert not batch.errors and len(batch.usage) == 4
            prompt = build_shared_prefix(bundle) + build_finder_suffix("A", [])
            payload = {
                "model": settings.vllm_model,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0,
                "max_tokens": 256,
                "stream": True,
                "chat_template_kwargs": {"enable_thinking": False},
            }
            payload.update(
                {"guided_json": FinderOutput.model_json_schema()}
                if settings.vllm_schema_mode == "guided_json"
                else {"structured_outputs": {"json": FinderOutput.model_json_schema()}}
            )
            key = settings.vllm_api_key.get_secret_value()
            headers = {"Authorization": f"Bearer {key}"} if key else {}

            async def ttft():
                start = time.perf_counter()
                first = None
                content = ""
                async with http.stream(
                    "POST",
                    settings.vllm_base_url.rstrip("/") + "/chat/completions",
                    json=payload,
                    headers=headers,
                ) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line.startswith("data: ") or line == "data: [DONE]":
                            continue
                        event = json.loads(line[6:])
                        choices = event.get("choices") or []
                        token = choices[0].get("delta", {}).get("content", "") if choices else ""
                        if token:
                            if first is None:
                                first = time.perf_counter() - start
                            content += token
                FinderOutput.model_validate_json(content)
                assert first is not None
                return first

            cold, warm = [], []
            for _ in range(3):
                response = await http.post(
                    settings.vllm_base_url.rsplit("/v1", 1)[0] + "/reset_prefix_cache",
                    headers=headers,
                )
                response.raise_for_status()
                cold.append(await ttft())
                warm.append(await ttft())
            print({"cold_ttft_s": cold, "warm_ttft_s": warm})
            assert statistics.median(warm) < statistics.median(cold), (
                "No measured prefix-cache TTFT improvement"
            )

    asyncio.run(run())
