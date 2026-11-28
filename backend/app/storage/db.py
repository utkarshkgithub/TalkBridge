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
ALTER TABLE reviews
    ADD COLUMN IF NOT EXISTS installation_id bigint,
    ADD COLUMN IF NOT EXISTS owner_user_id text;
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
CREATE TABLE IF NOT EXISTS github_installations (
    installation_id bigint PRIMARY KEY,
    account_login text NOT NULL DEFAULT '',
    account_type text NOT NULL DEFAULT 'User',
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'suspended', 'deleted')),
    daily_limit integer NOT NULL DEFAULT 20,
    daily_count integer NOT NULL DEFAULT 0,
    usage_date date NOT NULL DEFAULT CURRENT_DATE,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS user_installations (
    user_id text NOT NULL,
    installation_id bigint NOT NULL REFERENCES github_installations(installation_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, installation_id)
);
CREATE INDEX IF NOT EXISTS reviews_created_at ON reviews(created_at DESC, id);
CREATE INDEX IF NOT EXISTS reviews_installation_created_at
    ON reviews(installation_id, created_at DESC, id);
CREATE INDEX IF NOT EXISTS reviews_owner_created_at
    ON reviews(owner_user_id, created_at DESC, id);
"""


REVIEW_COLUMNS = "id, created_at, model_profile, result"


def _tenant_predicate(
    tenant_user_id: str | None, *, include_replay: bool = False
) -> tuple[str, tuple[Any, ...]]:
    if tenant_user_id is None:
        return "", ()
    clause = (
        "(installation_id IN (SELECT installation_id FROM user_installations WHERE user_id=%s) "
        "OR owner_user_id=%s"
    )
    if include_replay:
        clause += " OR model_profile='replay'"
    return clause + ")", (tenant_user_id, tenant_user_id)


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
        *,
        owner_user_id: str | None = None,
    ) -> StoredReview:
        identity = review_id or result.bundle.context.delivery_id
        installation_id = result.bundle.context.installation_id
        async with self.pool.connection() as connection, connection.transaction():
            cursor = await connection.execute(
                "INSERT INTO reviews(id, model_profile, result, installation_id, owner_user_id) "
                "VALUES (%s, %s, %s, %s, %s) "
                "ON CONFLICT(id) DO UPDATE SET result=EXCLUDED.result, "
                "model_profile=EXCLUDED.model_profile, "
                "installation_id=COALESCE(EXCLUDED.installation_id, reviews.installation_id), "
                "owner_user_id=COALESCE(EXCLUDED.owner_user_id, reviews.owner_user_id) "
                f"RETURNING {REVIEW_COLUMNS}",
                (
                    identity,
                    profile,
                    Jsonb(result.model_dump(mode="json")),
                    installation_id,
                    owner_user_id,
                ),
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

    async def get(
        self,
        identity: str,
        *,
        tenant_user_id: str | None = None,
        include_replay: bool = False,
    ) -> StoredReview | None:
        predicate, params = _tenant_predicate(tenant_user_id, include_replay=include_replay)
        sql = f"SELECT {REVIEW_COLUMNS} FROM reviews WHERE id=%s"
        query_params: tuple[Any, ...] = (identity,)
        if predicate:
            sql += f" AND {predicate}"
            query_params = (identity, *params)
        async with self.pool.connection() as connection:
            cursor = await connection.execute(sql, query_params)
            row = await cursor.fetchone()
        return StoredReview.model_validate(row) if row else None

    async def list(
        self,
        limit: int = 50,
        offset: int = 0,
        *,
        tenant_user_id: str | None = None,
        include_replay: bool = False,
    ) -> ReviewList:
        predicate, params = _tenant_predicate(tenant_user_id, include_replay=include_replay)
        where = f" WHERE {predicate}" if predicate else ""
        async with self.pool.connection() as connection:
            cursor = await connection.execute(
                f"SELECT {REVIEW_COLUMNS} FROM reviews{where} ORDER BY created_at DESC, id LIMIT %s OFFSET %s",
                (*params, limit, offset),
            )
            items = [StoredReview.model_validate(row) for row in await cursor.fetchall()]
            cursor = await connection.execute(f"SELECT count(*) AS total FROM reviews{where}", params)
            total = (await cursor.fetchone())["total"]
        return ReviewList(items=items, total=total, limit=limit, offset=offset)

    async def all(self) -> List[StoredReview]:
        async with self.pool.connection() as connection:
            cursor = await connection.execute(
                f"SELECT {REVIEW_COLUMNS} FROM reviews ORDER BY created_at, id"
            )
            return [StoredReview.model_validate(row) for row in await cursor.fetchall()]

    async def summary_rows(
        self, *, tenant_user_id: str | None = None, include_replay: bool = False
    ) -> List[dict[str, Any]]:
        predicate, params = _tenant_predicate(tenant_user_id, include_replay=include_replay)
        where = f" WHERE {predicate}" if predicate else ""
        async with self.pool.connection() as connection:
            cursor = await connection.execute(
                "SELECT model_profile, result->'telemetry' AS telemetry, "
                "(SELECT coalesce(jsonb_agg(jsonb_build_object("
                "'tier', f->'tier', "
                "'posted_to_pr', f->'posted_to_pr', "
                "'severity', f->'verification'->'severity', "
                "'pre_existing', f->'verification'->'pre_existing'"
                ")), '[]'::jsonb) FROM jsonb_array_elements(result->'findings') AS f) AS findings "
                f"FROM reviews{where}",
                params,
            )
            return list(await cursor.fetchall())

    async def upsert_installation_event(
        self,
        installation_id: int,
        account_login: str,
        account_type: str,
        action: str,
        *,
        daily_limit: int = 20,
    ) -> None:
        async with self.pool.connection() as connection:
            if action == "created":
                await connection.execute(
                    "INSERT INTO github_installations "
                    "(installation_id, account_login, account_type, status, daily_limit) "
                    "VALUES (%s, %s, %s, 'pending', %s) "
                    "ON CONFLICT (installation_id) DO UPDATE SET "
                    "account_login = EXCLUDED.account_login, "
                    "account_type = EXCLUDED.account_type, "
                    "status = CASE WHEN github_installations.status = 'deleted' "
                    "THEN 'pending' ELSE github_installations.status END, "
                    "updated_at = now()",
                    (installation_id, account_login, account_type, daily_limit),
                )
            elif action == "deleted":
                await connection.execute(
                    "INSERT INTO github_installations "
                    "(installation_id, account_login, account_type, status, daily_limit) "
                    "VALUES (%s, %s, %s, 'deleted', %s) "
                    "ON CONFLICT (installation_id) DO UPDATE SET "
                    "status = 'deleted', updated_at = now()",
                    (installation_id, account_login, account_type, daily_limit),
                )
            elif action == "suspend":
                await connection.execute(
                    "UPDATE github_installations SET status = 'suspended', updated_at = now() "
                    "WHERE installation_id = %s",
                    (installation_id,),
                )
            elif action == "unsuspend":
                await connection.execute(
                    "UPDATE github_installations SET status = CASE "
                    "WHEN EXISTS (SELECT 1 FROM user_installations WHERE installation_id = %s) "
                    "THEN 'active' ELSE 'pending' END, updated_at = now() "
                    "WHERE installation_id = %s AND status = 'suspended'",
                    (installation_id, installation_id),
                )

    async def claim_webhook_quota(
        self, installation_id: int
    ) -> Literal["allowed", "unclaimed", "quota_exceeded"]:
        async with self.pool.connection() as connection:
            cursor = await connection.execute(
                "UPDATE github_installations "
                "SET daily_count = CASE WHEN usage_date = CURRENT_DATE "
                "THEN daily_count + 1 ELSE 1 END, "
                "    usage_date = CURRENT_DATE, "
                "    updated_at = now() "
                "WHERE installation_id = %s "
                "  AND status = 'active' "
                "  AND (usage_date IS DISTINCT FROM CURRENT_DATE OR daily_count < daily_limit) "
                "RETURNING installation_id",
                (installation_id,),
            )
            if await cursor.fetchone() is not None:
                return "allowed"
            cursor = await connection.execute(
                "SELECT status FROM github_installations WHERE installation_id = %s",
                (installation_id,),
            )
            row = await cursor.fetchone()
            if row is not None and row["status"] == "active":
                return "quota_exceeded"
            return "unclaimed"

    async def refund_webhook_quota(self, installation_id: int) -> None:
        async with self.pool.connection() as connection:
            await connection.execute(
                "UPDATE github_installations "
                "SET daily_count = GREATEST(0, daily_count - 1), updated_at = now() "
                "WHERE installation_id = %s AND usage_date = CURRENT_DATE",
                (installation_id,),
            )
