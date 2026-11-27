"""Local dashboard APIs and an explicit, network-free replay path."""

import asyncio
from uuid import uuid4

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from app.agents.dedupe_rank import label_for
from app.agents.orchestrator import ReviewOrchestrator
from app.llm.vllm_client import VLLMClient
from app.pipeline.stage0 import Stage0
from app.schemas import ReviewList, ReviewTelemetry, StoredReview, TelemetrySummary
from app.storage.db import ReviewStore
from app.storage.replay import load_fixture

router = APIRouter(prefix="/api")


def store_for(request: Request) -> ReviewStore:
    store: ReviewStore | None = getattr(request.app.state, "store", None)
    if store is None:
        raise HTTPException(
            503, "Storage is disabled. Start PostgreSQL and set STORAGE_ENABLED=true."
        )
    return store


@router.get("/reviews", response_model=ReviewList)
async def list_reviews(
    request: Request, limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0)
) -> ReviewList:
    return await store_for(request).list(limit, offset)


@router.get("/reviews/{identity}", response_model=StoredReview)
async def get_review(identity: str, request: Request) -> StoredReview:
    result = await store_for(request).get(identity)
    if result is None:
        raise HTTPException(404, "Review not found")
    return result


@router.post("/demo/replay/{identity}", response_model=StoredReview)
async def replay_review(identity: str, request: Request) -> StoredReview:
    store = store_for(request)
    try:
        fixture = load_fixture(identity)
    except KeyError as exc:
        raise HTTPException(404, "Replay fixture not found") from exc
    return await store.save(fixture.result, "replay", f"demo-{identity}")


@router.post("/reviews/run/{identity}", response_model=StoredReview)
async def run_live_review(identity: str, request: Request) -> StoredReview:
    store = store_for(request)
    settings = request.app.state.settings
    if settings.demo_replay_mode or not settings.review_enabled:
        raise HTTPException(
            409, "Live reviews are disabled. Enable reviews and disable replay mode."
        )
    try:
        fixture = load_fixture(identity)
    except KeyError as exc:
        raise HTTPException(404, "Review fixture not found") from exc
    semaphore: asyncio.Semaphore = request.app.state.live_review_semaphore
    if semaphore.locked():
        raise HTTPException(429, "A live review is already running")
    try:
        # Finish before the frontend proxy's 180-second deadline and always release the slot.
        async with (
            asyncio.timeout(settings.live_review_timeout_seconds),
            semaphore,
            httpx.AsyncClient() as client,
        ):
            fixture.source.context.delivery_id = str(uuid4())
            result = await ReviewOrchestrator(Stage0(settings), VLLMClient(settings, client)).run(
                fixture.source
            )
            return await store.save(result, "base_8b")
    except TimeoutError as exc:
        raise HTTPException(504, "Live review timed out. Reduce review context or retry.") from exc


@router.get("/telemetry/summary", response_model=TelemetrySummary)
async def telemetry_summary(request: Request) -> TelemetrySummary:
    rows = await store_for(request).summary_rows()
    findings = [f for row in rows for f in (row.get("findings") or ())]
    telemetries = [ReviewTelemetry.model_validate(row.get("telemetry") or {}) for row in rows]
    candidates = len(findings)
    posted = sum(bool(f.get("posted_to_pr")) for f in findings)
    severities = {
        name: sum(
            label_for(bool(f.get("pre_existing")), str(f.get("severity", "nit"))).endswith(name)
            for f in findings
            if f.get("tier") != "discarded"
        )
        for name in ("Important", "Nit", "Pre-existing")
    }
    stages = {
        f"stage{i}": sum(t.stage_ms.get(f"stage{i}", 0) for t in telemetries)
        / max(len(telemetries), 1)
        for i in range(5)
    }
    prompt = sum(t.prompt_tokens for t in telemetries)
    cached = sum(t.cached_tokens for t in telemetries)
    observed = [t for t in telemetries if t.cached_tokens_exposed]
    observed_prompt = sum(t.prompt_tokens for t in observed)
    return TelemetrySummary(
        reviews=len(rows),
        candidates=candidates,
        posted=posted,
        suppression_rate=sum(f.get("tier") != "post_to_pr" for f in findings) / max(candidates, 1),
        severity_counts=severities,
        stage_ms=stages,
        prompt_tokens=prompt,
        cached_tokens=cached,
        cache_hit_ratio=sum(t.cached_tokens for t in observed) / observed_prompt
        if observed_prompt
        else None,
        estimated_cost_usd=sum(t.estimated_cost_usd for t in telemetries),
        model_profiles=sorted({str(row["model_profile"]) for row in rows}),
    )
