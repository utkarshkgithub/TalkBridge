"""Authenticate the raw body before interpreting any GitHub payload."""

import asyncio
import hashlib
import hmac
import json
import time
from collections import OrderedDict
from typing import Any
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from app.schemas import PRContext

router = APIRouter()


class DeliveryCache:
    def __init__(self, ttl: int, capacity: int) -> None:
        self.ttl = ttl
        self.capacity = capacity
        self.entries: OrderedDict[str, float] = OrderedDict()

    def claim(self, delivery: str) -> bool:
        now = time.monotonic()
        while self.entries and next(iter(self.entries.values())) <= now:
            self.entries.popitem(last=False)
        if delivery in self.entries:
            return False
        # Refuse new work instead of evicting an unexpired idempotency key.
        if len(self.entries) >= self.capacity:
            raise HTTPException(503, "Delivery cache full; retry later")
        self.entries[delivery] = now + self.ttl
        return True

    def release(self, delivery: str) -> None:
        self.entries.pop(delivery, None)


@router.post("/webhooks/github")
async def github_webhook(request: Request) -> Any:
    settings = request.app.state.settings
    secret = settings.github_webhook_secret.get_secret_value()
    if not secret:
        raise HTTPException(503, "GITHUB_WEBHOOK_SECRET is not configured")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > settings.webhook_max_bytes:
            raise HTTPException(413, "Webhook payload too large")
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    supplied = request.headers.get("X-Hub-Signature-256", "")
    if not hmac.compare_digest(expected.encode(), supplied.encode()):
        raise HTTPException(401, "Invalid webhook signature")
    delivery = request.headers.get("X-GitHub-Delivery", "")
    try:
        delivery = str(UUID(delivery))
    except ValueError as exc:
        raise HTTPException(400, "X-GitHub-Delivery must be a UUID") from exc
    try:
        payload = json.loads(body)
        if not isinstance(payload, dict):
            raise ValueError("Expected object")
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(400, "Invalid JSON payload") from exc
    event = request.headers.get("X-GitHub-Event")
    if event == "installation":
        action = payload.get("action")
        inst = payload.get("installation")
        if (
            isinstance(action, str)
            and action in {"created", "deleted", "suspend", "unsuspend"}
            and isinstance(inst, dict)
            and isinstance(inst.get("id"), int)
            and inst["id"] >= 1
        ):
            raw_acct = inst.get("account")
            acct = raw_acct if isinstance(raw_acct, dict) else {}
            store = getattr(request.app.state, "store", None)
            if store is not None:
                await store.upsert_installation_event(
                    inst["id"],
                    str(acct.get("login") or ""),
                    str(acct.get("type") or "User"),
                    action,
                    daily_limit=settings.install_daily_limit,
                )
        return {"status": "installation_recorded", "delivery_id": delivery}
    if event != "pull_request":
        return {"status": "ignored", "delivery_id": delivery}
    action = payload.get("action")
    if not isinstance(action, str):
        raise HTTPException(422, "Invalid pull request action")
    if action not in {
        "opened",
        "synchronize",
        "reopened",
    }:
        return {"status": "ignored", "delivery_id": delivery}
    try:
        pr = payload["pull_request"]
        context = PRContext(
            delivery_id=delivery,
            action=payload["action"],
            repo_full_name=payload["repository"]["full_name"],
            pr_number=pr["number"],
            base_sha=pr["base"]["sha"],
            head_sha=pr["head"]["sha"],
            pr_title=pr.get("title") or "",
            pr_author=(pr.get("user") or {}).get("login") or "",
            installation_id=(payload.get("installation") or {}).get("id"),
        )
    except (KeyError, TypeError, AttributeError, ValidationError) as exc:
        raise HTTPException(422, "Invalid pull request payload") from exc
    cache = request.app.state.deliveries
    if not cache.claim(delivery):
        return {"status": "duplicate_ignored", "delivery_id": delivery}
    store = getattr(request.app.state, "store", None)
    quota_charged = False
    if settings.multi_tenant_enabled:
        if context.installation_id is None:
            cache.release(delivery)
            return {"status": "ignored", "delivery_id": delivery, "reason": "installation_unclaimed"}
        if store is None:
            cache.release(delivery)
            raise HTTPException(503, "Storage is required in multi-tenant mode")
        verdict = await store.claim_webhook_quota(context.installation_id)
        if verdict == "unclaimed":
            cache.release(delivery)
            return {"status": "ignored", "delivery_id": delivery, "reason": "installation_unclaimed"}
        if verdict == "quota_exceeded":
            cache.release(delivery)
            raise HTTPException(429, "Daily pull request review quota exceeded for this installation")
        quota_charged = True
    try:
        request.app.state.worker.enqueue(context)
    except asyncio.QueueFull as exc:
        cache.release(delivery)
        if quota_charged and store is not None and context.installation_id is not None:
            await store.refund_webhook_quota(context.installation_id)
        raise HTTPException(503, "Worker queue full; retry later") from exc
    from fastapi.responses import JSONResponse

    return JSONResponse({"status": "accepted", "delivery_id": delivery}, status_code=202)
