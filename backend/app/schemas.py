"""Shared, validated contracts for the review pipeline."""

from enum import StrEnum
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

Confidence = Annotated[int, Field(strict=True, ge=0, le=100)]
PositiveLine = Annotated[int, Field(ge=1)]
PullRequestAction = Literal["opened", "synchronize", "reopened"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PRContext(Contract):
    """Normalized pull request context extracted from a GitHub webhook delivery."""

    delivery_id: str = Field(min_length=1)
    action: PullRequestAction
    repo_full_name: str = Field(pattern=r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
    pr_number: int = Field(ge=1)
    base_sha: str = Field(min_length=1)
    head_sha: str = Field(min_length=1)
    pr_title: str = ""
    pr_author: str = ""
    installation_id: int | None = Field(default=None, ge=1)


class DepthMode(StrEnum):
    QUICK = "quick"
    STANDARD = "standard"
    DEEP = "deep"


class Span(Contract):
    file: str = Field(min_length=1)
    line_start: PositiveLine
    line_end: PositiveLine

    @model_validator(mode="after")
    def ordered_lines(self) -> Self:
        if self.line_end < self.line_start:
            raise ValueError("line_end must be >= line_start")
        return self


class DiffLine(Contract):
    kind: Literal["context", "addition", "deletion"]
    content: str
    head_line: PositiveLine | None = None
    base_line: PositiveLine | None = None
    github_position: PositiveLine


class CleanedHunk(Span):
    header: str
    lines: list[DiffLine]
    changed_head_lines: list[PositiveLine] = Field(default_factory=list)

    @property
    def changed_loc(self) -> int:
        return sum(line.kind != "context" for line in self.lines)


class AstChunk(Span):
    language: str
    symbol: str
    source: str
    caller_signatures: list[str] = Field(default_factory=list)
    callee_signatures: list[str] = Field(default_factory=list)
    fallback: bool = False


class SastHint(Span):
    rule_id: str
    cwe_id: str | None = None
    message: str
    severity: str


class PRSource(Contract):
    context: PRContext
    diff: str
    files: dict[str, str]
    review_rules: str = ""
    commit_subjects: list[str] = Field(default_factory=list)


class ReviewBundle(Contract):
    context: PRContext
    depth_mode: DepthMode
    hunks: list[CleanedHunk]
    ast_chunks: list[AstChunk]
    sast_hints: list[SastHint]
    review_rules: str
    commit_subjects: list[str] = Field(default_factory=list)
    original_chars: int = Field(default=0, ge=0)
    cleaned_chars: int = Field(default=0, ge=0)
    sast_status: Literal["completed", "timeout", "unavailable", "error"] = "completed"
    warnings: list[str] = Field(default_factory=list)


class FinderCandidate(Span):
    finding_id: str
    source_agent: Literal["A", "B", "C", "D"]
    category: str
    cwe_id: str | None = None
    severity: Literal["important", "nit"] = "important"
    confidence: Confidence
    reasoning: str
    suggested_patch: str | None = None
    unit_test: str | None = None


class FinderOutput(Contract):
    findings: list[FinderCandidate] = Field(default_factory=list)


class VerifierOutput(Contract):
    finding_id: str
    verdict: Literal["confirmed", "refuted", "uncertain"]
    refutation_attempt: str
    calibrated_confidence: Confidence
    severity: Literal["important", "nit"]
    pre_existing: bool = False


class RankedFinding(Contract):
    candidate: FinderCandidate
    verification: VerifierOutput
    tier: Literal["post_to_pr", "dashboard_only", "discarded"]
    posted_to_pr: bool = False


class ReviewTelemetry(Contract):
    stage_ms: dict[str, Annotated[float, Field(ge=0)]] = Field(default_factory=dict)
    prompt_tokens: int = Field(default=0, ge=0)
    cached_tokens: int = Field(default=0, ge=0)
    estimated_cost_usd: float = Field(default=0, ge=0)
