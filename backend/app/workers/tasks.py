"""Bounded in-process worker for a single-process college deployment."""

import asyncio
import logging
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from typing import Protocol

from app.schemas import PRContext, PRSource, ReviewBundle, ReviewResult

logger = logging.getLogger(__name__)


class SourceFetcher(Protocol):
    async def fetch(self, context: PRContext) -> PRSource: ...


class ReviewWorker:
    def __init__(
        self,
        fetcher: SourceFetcher,
        processor: Callable[[PRSource], Awaitable[ReviewBundle | ReviewResult]],
        *,
        queue_size: int = 100,
        count: int = 1,
    ) -> None:
        self.fetcher = fetcher
        self.processor = processor
        self.queue: asyncio.Queue[PRContext] = asyncio.Queue(maxsize=queue_size)
        self.count = count
        self.tasks: list[asyncio.Task[None]] = []
        self.results: OrderedDict[str, ReviewBundle | ReviewResult] = OrderedDict()
        self.failures: OrderedDict[str, str] = OrderedDict()

    async def start(self) -> None:
        self.tasks = [asyncio.create_task(self._run()) for _ in range(self.count)]

    def enqueue(self, context: PRContext) -> None:
        self.queue.put_nowait(context)

    async def close(self) -> None:
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        self.tasks.clear()

    async def _run(self) -> None:
        while True:
            context = await self.queue.get()
            try:
                source = await self.fetcher.fetch(context)
                bundle = await self.processor(source)
                self.results[context.delivery_id] = bundle
                if len(self.results) > 100:
                    self.results.popitem(last=False)
            except Exception:
                # Do not log remote response bodies or authentication material.
                logger.error("Review failed for delivery %s", context.delivery_id)
                self.failures[context.delivery_id] = (
                    "Review failed; inspect GitHub access and worker configuration"
                )
                if len(self.failures) > 100:
                    self.failures.popitem(last=False)
            finally:
                self.queue.task_done()
