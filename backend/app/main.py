from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, get_settings
from app.github.client import GitHubFetcher
from app.webhooks.github import DeliveryCache, router
from app.workers.tasks import ReviewWorker


def create_app(settings: Settings | None = None, worker: ReviewWorker | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        async with httpx.AsyncClient(
            base_url=settings.github_api_url,
            timeout=30,
            headers={"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
        ) as client:
            if worker is None:
                from app.pipeline.stage0 import Stage0

                app.state.worker = ReviewWorker(
                    GitHubFetcher(settings, client),
                    Stage0(settings).run,
                    queue_size=settings.worker_queue_size,
                    count=settings.worker_count,
                )
            await app.state.worker.start()
            try:
                yield
            finally:
                await app.state.worker.close()

    app = FastAPI(title="TalkBridge API", lifespan=lifespan)
    app.state.settings = settings
    app.state.deliveries = DeliveryCache(
        settings.delivery_ttl_seconds, settings.delivery_cache_size
    )
    app.state.worker = worker
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
