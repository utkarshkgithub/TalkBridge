from typing import Literal

from pydantic import BaseModel, Field

PullRequestAction = Literal["opened", "synchronize", "reopened"]


class PRContext(BaseModel):
    """Normalized pull request context extracted from a GitHub webhook delivery."""

    delivery_id: str = Field(min_length=1)
    action: PullRequestAction
    repo_full_name: str = Field(min_length=1)
    pr_number: int = Field(ge=1)
    base_sha: str = Field(min_length=1)
    head_sha: str = Field(min_length=1)
    pr_title: str = ""
    pr_author: str = ""


class WebhookAck(BaseModel):
    """Response returned by the GitHub webhook receiver."""

    status: Literal["accepted", "ignored", "duplicate"]
    delivery_id: str = Field(min_length=1)
