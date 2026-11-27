import pytest
from app.webhooks.schemas import PRContext, WebhookAck
from pydantic import ValidationError


def test_pr_context_json_roundtrip() -> None:
    ctx = PRContext(
        delivery_id="deliv-123",
        action="opened",
        repo_full_name="acme/api",
        pr_number=14,
        base_sha="abc1234",
        head_sha="def5678",
        pr_title="Fix login",
        pr_author="alice",
    )
    assert PRContext.model_validate_json(ctx.model_dump_json()) == ctx


def test_pr_context_rejects_unsupported_action_and_bad_pr_number() -> None:
    with pytest.raises(ValidationError):
        PRContext(
            delivery_id="deliv-123",
            action="labeled",  # type: ignore[arg-type]
            repo_full_name="acme/api",
            pr_number=14,
            base_sha="abc1234",
            head_sha="def5678",
        )

    with pytest.raises(ValidationError):
        PRContext(
            delivery_id="deliv-123",
            action="opened",
            repo_full_name="acme/api",
            pr_number=0,
            base_sha="abc1234",
            head_sha="def5678",
        )


def test_webhook_ack() -> None:
    ack = WebhookAck(status="accepted", delivery_id="deliv-123")
    assert ack.status == "accepted"
