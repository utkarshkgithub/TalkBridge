"""Deterministic Stage 0 coordinator. No LLM dependencies or inference calls."""

import asyncio
import logging

from app.config import Settings
from app.pipeline.ast_extractor import extract_context, load_review_rules
from app.pipeline.depth_router import route_depth
from app.pipeline.diff_cleaner import clean_diff
from app.pipeline.sast_scanner import SastScanner
from app.schemas import PRSource, ReviewBundle

logger = logging.getLogger(__name__)


class Stage0:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.scanner = SastScanner(settings.semgrep_rules_path, settings.semgrep_timeout_seconds)

    async def run(self, source: PRSource) -> ReviewBundle:
        return await asyncio.to_thread(self.assemble, source)

    def assemble(self, source: PRSource) -> ReviewBundle:
        rules = source.review_rules or load_review_rules(source.files)
        hunks = clean_diff(
            source.diff,
            enforce_style=self.settings.enforce_style_diff
            or "<!-- talkbridge: enforce-style -->" in rules,
        )
        chunks = extract_context(hunks, source.files, max_lines=self.settings.ast_max_lines)
        scan = self.scanner.scan(source.files, hunks)
        warnings = list(scan.warnings)
        missing = sorted({h.file for h in hunks} - source.files.keys())
        if missing:
            warnings.append("Head source unavailable for: " + ", ".join(missing))
        bundle = ReviewBundle(
            context=source.context,
            hunks=hunks,
            ast_chunks=chunks,
            sast_hints=scan.hints,
            depth_mode=route_depth(hunks),
            review_rules=rules,
            commit_subjects=source.commit_subjects,
            original_chars=len(source.diff),
            cleaned_chars=sum(len(line.content) + 1 for h in hunks for line in h.lines),
            sast_status=scan.status,
            warnings=warnings,
        )
        logger.info(
            "Stage 0 completed for %s: depth=%s hunks=%d sast=%s",
            source.context.delivery_id,
            bundle.depth_mode,
            len(hunks),
            bundle.sast_status,
        )
        return bundle
