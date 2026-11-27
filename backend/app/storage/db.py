"""Small async PostgreSQL store. Canonical review JSON and child artifacts share a transaction."""

from __future__ import annotations

from builtins import list as List
from typing import Any, Literal

from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.schemas import ReviewList, ReviewResult, StoredReview

SCHEMA = """
CREATE TABLE IF NOT EXISTS reviews (
    id text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    model_profile text NOT NULL CHECK (model_profile IN ('base_8b', 'replay')),
    result jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS diff_hunks (
    review_id text NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    ordinal integer NOT NULL,
    artifact jsonb NOT NULL,
    PRIMARY KEY (review_id, ordinal)
);
CREATE TABLE IF NOT EXISTS findings (
    review_id text NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    ordinal integer NOT NULL,
    artifact jsonb NOT NULL,
    PRIMARY KEY (review_id, ordinal)
);
CREATE INDEX IF NOT EXISTS reviews_created_at ON reviews(created_at DESC, id);
"""


class ReviewStore:
    def __init__(self, url: str) -> None:
        self.pool: AsyncConnectionPool[Any] = AsyncConnectionPool(
            url.replace("postgresql+psycopg://", "postgresql://", 1),
            open=False,
            min_size=1,
            max_size=4,
            timeout=5,
            kwargs={"row_factory": dict_row},
        )

    async def open(self) -> None:
        await self.pool.open(wait=True, timeout=5)
        async with self.pool.connection() as connection:
            await connection.execute(SCHEMA)

    async def close(self) -> None:
        await self.pool.close()

    async def save(
        self,
        result: ReviewResult,
        profile: Literal["base_8b", "replay"],
        review_id: str | None = None,
    ) -> StoredReview:
        identity = review_id or result.bundle.context.delivery_id
        async with self.pool.connection() as connection, connection.transaction():
            cursor = await connection.execute(
                "INSERT INTO reviews(id, model_profile, result) VALUES (%s, %s, %s) "
                "ON CONFLICT(id) DO UPDATE SET result=EXCLUDED.result, "
                "model_profile=EXCLUDED.model_profile RETURNING *",
                (identity, profile, Jsonb(result.model_dump(mode="json"))),
            )
            row = await cursor.fetchone()
            for table, artifacts in (
                ("diff_hunks", result.bundle.hunks),
                ("findings", result.findings),
            ):
                # Table names are fixed host constants; values use bound parameters.
                await connection.execute(f"DELETE FROM {table} WHERE review_id=%s", (identity,))
                for index, artifact in enumerate(artifacts):
                    await connection.execute(
                        f"INSERT INTO {table}(review_id, ordinal, artifact) VALUES (%s, %s, %s)",
                        (identity, index, Jsonb(artifact.model_dump(mode="json"))),
                    )
        return StoredReview.model_validate(row)

    async def get(self, identity: str) -> StoredReview | None:
        async with self.pool.connection() as connection:
            cursor = await connection.execute("SELECT * FROM reviews WHERE id=%s", (identity,))
            row = await cursor.fetchone()
        return StoredReview.model_validate(row) if row else None

    async def list(self, limit: int = 50, offset: int = 0) -> ReviewList:
        async with self.pool.connection() as connection:
            cursor = await connection.execute(
                "SELECT * FROM reviews ORDER BY created_at DESC, id LIMIT %s OFFSET %s",
                (limit, offset),
            )
            items = [StoredReview.model_validate(row) for row in await cursor.fetchall()]
            cursor = await connection.execute("SELECT count(*) AS total FROM reviews")
            total = (await cursor.fetchone())["total"]
        return ReviewList(items=items, total=total, limit=limit, offset=offset)

    async def all(self) -> List[StoredReview]:
        async with self.pool.connection() as connection:
            cursor = await connection.execute("SELECT * FROM reviews ORDER BY created_at, id")
            return [StoredReview.model_validate(row) for row in await cursor.fetchall()]

    async def summary_rows(self) -> List[dict[str, Any]]:
        async with self.pool.connection() as connection:
            cursor = await connection.execute(
                "SELECT model_profile, result->'telemetry' AS telemetry, "
                "(SELECT coalesce(jsonb_agg(jsonb_build_object("
                "'tier', f->'tier', "
                "'posted_to_pr', f->'posted_to_pr', "
                "'severity', f->'verification'->'severity', "
                "'pre_existing', f->'verification'->'pre_existing'"
                ")), '[]'::jsonb) FROM jsonb_array_elements(result->'findings') AS f) AS findings "
                "FROM reviews"
            )
            return list(await cursor.fetchall())
