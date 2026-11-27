"""Deterministic duplicate clustering and conservative publication gates."""

from app.schemas import RankedFinding, VerifiedCandidate


def duplicate(a: VerifiedCandidate, b: VerifiedCandidate) -> bool:
    x, y = a.candidate, b.candidate
    return (
        x.file == y.file
        and x.line_start <= y.line_end + 3
        and y.line_start <= x.line_end + 3
        and x.category.casefold() == y.category.casefold()
        and x.cwe_id == y.cwe_id
    )


def dedupe_rank(items: list[VerifiedCandidate]) -> list[RankedFinding]:
    discarded = [
        x
        for x in items
        if x.verification.verdict == "refuted" or x.verification.calibrated_confidence < 50
    ]
    groups: list[list[VerifiedCandidate]] = []
    for item in items:
        if item in discarded:
            continue
        touching = [g for g in groups if any(duplicate(item, x) for x in g)]
        merged = [item]
        for group in touching:
            merged.extend(group)
            groups.remove(group)
        groups.append(merged)
    retained = []
    for group in groups:
        best = max(
            group,
            key=lambda x: (
                x.verification.calibrated_confidence,
                x.verification.severity == "important",
                len(x.candidate.reasoning),
            ),
        )
        patch = max(group, key=lambda x: len(x.candidate.suggested_patch or ""))
        candidate = best.candidate.model_copy(
            update={"suggested_patch": patch.candidate.suggested_patch}
        )
        verification = best.verification.model_copy(
            update={
                "severity": "important"
                if any(x.verification.severity == "important" for x in group)
                else "nit",
            }
        )
        retained.append(
            RankedFinding(
                candidate=candidate,
                verification=verification,
                tier="post_to_pr" if verification.calibrated_confidence >= 80 else "dashboard_only",
            )
        )
    retained.extend(
        RankedFinding(candidate=x.candidate, verification=x.verification, tier="discarded")
        for x in discarded
    )
    return sorted(
        retained,
        key=lambda x: (
            -x.verification.calibrated_confidence,
            x.candidate.file,
            x.candidate.line_start,
            x.candidate.finding_id,
        ),
    )


def severity_label(finding: RankedFinding) -> str:
    if finding.verification.pre_existing:
        return "🟣 Pre-existing"
    return "🔴 Important" if finding.verification.severity == "important" else "🟡 Nit"
