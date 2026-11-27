from pathlib import Path

import pytest
from app.schemas import (
    AstChunk,
    CleanedHunk,
    DepthMode,
    DiffLine,
    FinderCandidate,
    PRSource,
    ReviewBundle,
    SastHint,
    VerifiedCandidate,
    VerifierOutput,
)


@pytest.fixture
def bundle():
    source = PRSource.model_validate_json(
        (Path(__file__).resolve().parents[2] / "evaluation/fixtures/auth_sqli_pr.json").read_text()
    )
    return ReviewBundle(
        context=source.context,
        depth_mode=DepthMode.DEEP,
        hunks=[
            CleanedHunk(
                file="auth/login.py",
                line_start=1,
                line_end=8,
                header="@@ -1 +1 @@",
                lines=[
                    DiffLine(kind="addition", content="unsafe()", head_line=4, github_position=1)
                ],
                changed_head_lines=[4],
            )
        ],
        ast_chunks=[
            AstChunk(
                file="auth/login.py",
                line_start=1,
                line_end=8,
                language="python",
                symbol="login",
                source='cursor.execute(f"SELECT {uid}")',
            )
        ],
        sast_hints=[
            SastHint(
                file="auth/login.py",
                line_start=4,
                line_end=4,
                rule_id="secret-sast-marker",
                message="SQLi",
                severity="ERROR",
            )
        ],
        review_rules="",
    )


@pytest.fixture
def candidate():
    return FinderCandidate(
        file="auth/login.py",
        line_start=4,
        line_end=5,
        finding_id="A-1",
        source_agent="A",
        category="security",
        cwe_id="CWE-89",
        confidence=90,
        reasoning="Unsanitized parameter enters SQL",
    )


def completion(output, *, cached=12):
    return {
        "choices": [
            {
                "finish_reason": "stop",
                "message": {
                    "content": output.model_dump_json()
                    if hasattr(output, "model_dump_json")
                    else output
                },
            }
        ],
        "usage": {"prompt_tokens": 100, "prompt_tokens_details": {"cached_tokens": cached}},
    }


def verified(candidate, confidence=90, **kwargs):
    return VerifiedCandidate(
        candidate=candidate,
        verification=VerifierOutput(
            finding_id=candidate.finding_id,
            verdict=kwargs.pop("verdict", "confirmed"),
            refutation_attempt="No guard or binding found",
            calibrated_confidence=confidence,
            severity=kwargs.pop("severity", "important"),
            **kwargs,
        ),
    )
