import pytest
from app.schemas import (
    AstChunk,
    DepthMode,
    FinderCandidate,
    FinderOutput,
    PRContext,
    RankedFinding,
    ReviewBundle,
    ReviewTelemetry,
    SastHint,
    VerifierOutput,
)
from pydantic import ValidationError


def context() -> PRContext:
    return PRContext(
        delivery_id="test-delivery",
        action="opened",
        repo_full_name="college/demo",
        pr_number=1,
        base_sha="base",
        head_sha="head",
    )


@pytest.mark.parametrize("score", [0, 50, 80, 100])
def test_contract_roundtrip(score: int) -> None:
    candidate = FinderCandidate(
        file="a.py",
        line_start=1,
        line_end=2,
        finding_id="f1",
        source_agent="A",
        category="security",
        confidence=score,
        reasoning="Untrusted input",
    )
    verification = VerifierOutput(
        finding_id="f1",
        verdict="confirmed",
        refutation_attempt="No guard found",
        calibrated_confidence=score,
        severity="important",
    )
    bundle = ReviewBundle(
        context=context(),
        depth_mode=DepthMode.QUICK,
        hunks=[],
        review_rules="rules",
        ast_chunks=[
            AstChunk(
                file="a.py",
                line_start=1,
                line_end=2,
                language="python",
                symbol="f",
                source="def f(): pass",
            )
        ],
        sast_hints=[
            SastHint(
                file="a.py",
                line_start=1,
                line_end=1,
                rule_id="eval",
                message="eval",
                severity="ERROR",
            )
        ],
    )
    for model in [
        bundle,
        candidate,
        verification,
        FinderOutput(findings=[candidate]),
        RankedFinding(candidate=candidate, verification=verification, tier="post_to_pr"),
        ReviewTelemetry(),
    ]:
        assert type(model).model_validate_json(model.model_dump_json()) == model
    assert FinderOutput.model_json_schema()["type"] == "object"
    assert VerifierOutput.model_json_schema()["type"] == "object"


@pytest.mark.parametrize("score", [-1, 101, True, 80.1])
def test_confidence_bounds(score: object) -> None:
    with pytest.raises(ValidationError):
        FinderCandidate.model_validate(
            dict(
                file="a.py",
                line_start=1,
                line_end=1,
                finding_id="f",
                source_agent="A",
                category="security",
                confidence=score,
                reasoning="test",
            )
        )
    with pytest.raises(ValidationError):
        VerifierOutput.model_validate(
            dict(
                finding_id="f",
                verdict="confirmed",
                refutation_attempt="test",
                calibrated_confidence=score,
                severity="important",
            )
        )


def test_invalid_span() -> None:
    with pytest.raises(ValidationError):
        AstChunk(file="a", line_start=3, line_end=1, language="python", symbol="f", source="")
