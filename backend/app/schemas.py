"""Shared, validated contracts for the review pipeline."""

from datetime import datetime
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
    cached_tokens_exposed: bool = False
    estimated_cost_usd: float = Field(default=0, ge=0)
    inference_valid_calls: int = Field(default=0, ge=0)
    inference_failed_calls: int = Field(default=0, ge=0)
    verifier_attempts: int = Field(default=0, ge=0)
    verifier_refutations: int = Field(default=0, ge=0)


class InferenceError(Contract):
    stage: Literal["finder", "verifier"]
    role: str
    code: Literal["timeout", "http", "invalid_output", "budget"]
    message: str


class InferenceUsage(Contract):
    prompt_tokens: int = Field(default=0, ge=0)
    cached_tokens: int | None = Field(default=None, ge=0)
    latency_ms: float = Field(default=0, ge=0)


class FinderBatch(Contract):
    output: FinderOutput = Field(default_factory=FinderOutput)
    usage: list[InferenceUsage] = Field(default_factory=list)
    errors: list[InferenceError] = Field(default_factory=list)


class VerifiedCandidate(Contract):
    candidate: FinderCandidate
    verification: VerifierOutput


class VerificationBatch(Contract):
    findings: list[VerifiedCandidate] = Field(default_factory=list)
    usage: list[InferenceUsage] = Field(default_factory=list)
    errors: list[InferenceError] = Field(default_factory=list)


class PublishResult(Contract):
    dry_run: bool = True
    inline_comments: list[dict[str, str | int]] = Field(default_factory=list)
    summary: str = ""
    check: dict[str, str] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class ReviewResult(Contract):
    bundle: ReviewBundle
    findings: list[RankedFinding]
    telemetry: ReviewTelemetry
    errors: list[InferenceError] = Field(default_factory=list)
    publication: PublishResult | None = None


class EvaluationCase(Contract):
    id: str
    dataset: Literal["primevul_paired", "code_security"]
    provenance: str
    commit_sha: str | None = None
    cve_id: str | None = None
    normalized_code_hash: str
    vulnerable: bool
    cwe_ids: list[str]
    source: PRSource


class EvaluationPrediction(Contract):
    id: str
    vulnerable: bool
    cwe_ids: list[str]
    score: Confidence
    predicted_cwe: str | None = None
    latency_ms: float = Field(ge=0)
    calls: int = Field(ge=0)
    valid_calls: int = Field(ge=0)
    verifier_refuted: bool = False
    verifier_attempts: int = Field(default=0, ge=0)
    verifier_refutations: int = Field(default=0, ge=0)
    errors: list[InferenceError] = Field(default_factory=list)


class StoredReview(Contract):
    id: str
    created_at: datetime
    model_profile: Literal["base_8b", "replay"]
    result: ReviewResult


class ReviewList(Contract):
    items: list[StoredReview]
    total: int
    limit: int
    offset: int


class ReplayFixture(Contract):
    source: PRSource
    result: ReviewResult
    note: str = "Illustrative replay fixture, not measured live model output."


class TelemetrySummary(Contract):
    reviews: int
    candidates: int
    posted: int
    suppression_rate: float
    severity_counts: dict[str, int]
    stage_ms: dict[str, float]
    prompt_tokens: int
    cached_tokens: int
    cache_hit_ratio: float | None
    estimated_cost_usd: float
    model_profiles: list[str]
