from typing import Literal

from pydantic import BaseModel, Field

from app.schemas import PRContext, PullRequestAction

__all__ = ["PRContext", "PullRequestAction", "WebhookAck"]


class WebhookAck(BaseModel):
    """Response returned by the GitHub webhook receiver."""

    status: Literal["accepted", "ignored", "duplicate", "duplicate_ignored"]
    delivery_id: str = Field(min_length=1)
