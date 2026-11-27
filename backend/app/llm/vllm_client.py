"""Small HTTP-only client for vLLM's OpenAI-compatible API."""

import time
from typing import Any, Literal

import httpx
from pydantic import BaseModel, ValidationError

from app.config import Settings
from app.schemas import InferenceError, InferenceUsage


class InferenceFailure(Exception):
    def __init__(self, error: InferenceError) -> None:
        super().__init__(error.message)
        self.error = error


class VLLMClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self.settings = settings
        self.client = client

    async def generate[T: BaseModel](
        self, prompt: str, schema: type[T], *, stage: Literal["finder", "verifier"], role: str
    ) -> tuple[T, InferenceUsage]:
        def fail(code: Any, message: str) -> InferenceFailure:
            return InferenceFailure(
                InferenceError(stage=stage, role=role, code=code, message=message)
            )

        max_chars = min(
            self.settings.prompt_max_chars,
            max(1000, (self.settings.vllm_max_model_len - self.settings.vllm_max_tokens) * 3),
        )
        if len(prompt) > max_chars:
            raise fail("budget", "Review exceeds the configured prompt budget")
        payload: dict[str, Any] = {
            "model": self.settings.vllm_model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
            "max_tokens": self.settings.vllm_max_tokens,
            "chat_template_kwargs": {"enable_thinking": False},
        }
        if self.settings.vllm_schema_mode == "guided_json":
            payload["guided_json"] = schema.model_json_schema()
        else:
            payload["structured_outputs"] = {"json": schema.model_json_schema()}
        headers = {}
        if key := self.settings.vllm_api_key.get_secret_value():
            headers["Authorization"] = f"Bearer {key}"
        start = time.perf_counter()
        try:
            response = await self.client.post(
                self.settings.vllm_base_url.rstrip("/") + "/chat/completions",
                json=payload,
                headers=headers,
                timeout=self.settings.vllm_timeout_seconds,
            )
            response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise fail("timeout", "Inference request timed out") from exc
        except httpx.HTTPError as exc:
            raise fail("http", "Inference endpoint request failed") from exc
        try:
            data = response.json()
            choice = data["choices"][0]
            if choice.get("finish_reason") != "stop":
                raise ValueError("Incomplete generation")
            result = schema.model_validate_json(choice["message"]["content"])
            usage = data.get("usage") or {}
            details = usage.get("prompt_tokens_details") or {}
            observed = InferenceUsage(
                prompt_tokens=usage.get("prompt_tokens", 0),
                cached_tokens=details.get("cached_tokens"),
                latency_ms=(time.perf_counter() - start) * 1000,
            )
            return result, observed
        except (
            ValueError,
            TypeError,
            KeyError,
            IndexError,
            AttributeError,
            ValidationError,
        ) as exc:
            raise fail(
                "invalid_output", "Inference returned incomplete or invalid schema JSON"
            ) from exc
