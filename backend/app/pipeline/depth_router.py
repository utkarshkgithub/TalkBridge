"""Choose review depth from retained LOC and critical path components."""

from pathlib import PurePosixPath

from app.schemas import CleanedHunk, DepthMode

CRITICAL = {"auth", "db", "payments", "crypto", "admin"}


def route_depth(hunks: list[CleanedHunk]) -> DepthMode:
    loc = sum(hunk.changed_loc for hunk in hunks)
    if loc > 300 or any(CRITICAL.intersection(PurePosixPath(h.file).parts[:-1]) for h in hunks):
        return DepthMode.DEEP
    return DepthMode.QUICK if loc < 50 else DepthMode.STANDARD
