"""Filter unified diffs without losing original GitHub position coordinates."""

import ast
import logging
import re
from pathlib import PurePosixPath
from typing import Literal

from app.schemas import CleanedHunk, DiffLine

logger = logging.getLogger(__name__)
HEADER = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")
LOCKFILES = {
    "package-lock.json",
    "poetry.lock",
    "yarn.lock",
    "pnpm-lock.yaml",
    "Cargo.lock",
    "uv.lock",
}
BUILD_DIRS = {"node_modules", "vendor", "dist", "build", ".next", "__pycache__", ".git"}
TOKEN = re.compile(
    r""""(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|"""
    r"\w+|===|!==|==|!=|<=|>=|=>|\+\+|--|\*\*|//|&&|\|\||<<|>>|:=|\S"
)
KINDS: dict[str, Literal["context", "addition", "deletion"]] = {
    " ": "context",
    "+": "addition",
    "-": "deletion",
}


def safe_path(path: str) -> bool:
    parts = PurePosixPath(path).parts
    return bool(parts) and not path.startswith("/") and ".." not in parts and "\\" not in path


def excluded(path: str) -> bool:
    file = PurePosixPath(path)
    return (
        not safe_path(path)
        or file.name in LOCKFILES
        or bool(BUILD_DIRS.intersection(file.parts))
        or ".min." in file.name
        or file.suffix.lower()
        in {".map", ".svg", ".png", ".jpg", ".jpeg", ".gif", ".pdf", ".woff", ".ico"}
    )


def _normalized(lines: list[str], python: bool) -> list[tuple[str, ...]]:
    result = []
    for line in lines:
        # Preserve literal whitespace and Python indentation, both can change behavior.
        prefix = line[: len(line) - len(line.lstrip())] if python and line.strip() else ""
        tokens = TOKEN.findall(line)
        if tokens:
            result.append((prefix, *tokens))
    return result


def _path(header: str) -> str:
    value = header[4:].split("\t", 1)[0]
    if value.startswith('"'):
        try:
            decoded = (
                ast.literal_eval("b" + value).decode("utf-8")
                if value.isascii()
                else ast.literal_eval(value)
            )
            if isinstance(decoded, str):
                value = decoded
        except (SyntaxError, ValueError, UnicodeDecodeError):
            value = value.strip('"')
    return value[2:] if value.startswith(("a/", "b/")) else value


def clean_diff(diff: str, *, enforce_style: bool = False) -> list[CleanedHunk]:
    hunks: list[CleanedHunk] = []
    path = ""
    base_path = ""
    header = ""
    lines: list[DiffLine] = []
    old = new = position = 0
    active = False
    first_hunk = True

    def flush() -> None:
        if not lines or excluded(path):
            return
        added = [line.content for line in lines if line.kind == "addition"]
        removed = [line.content for line in lines if line.kind == "deletion"]
        if not added and not removed:
            return
        # Multiline strings and template literals need whole-file lexical context.
        multiline = any('"""' in line or "'''" in line or "`" in line for line in added + removed)
        if (
            not enforce_style
            and not multiline
            and _normalized(added, path.endswith(".py"))
            == _normalized(removed, path.endswith(".py"))
        ):
            return
        head = [line.head_line for line in lines if line.head_line is not None]
        changed = [
            line.head_line
            for line in lines
            if line.kind == "addition" and line.head_line is not None
        ]
        # A deletion-only hunk has no commentable added line. Keep surrounding context if available.
        start = min(head) if head else max(new, 1)
        hunks.append(
            CleanedHunk(
                file=path,
                line_start=start,
                line_end=max(head) if head else start,
                header=header,
                lines=list(lines),
                changed_head_lines=changed,
            )
        )

    for raw in diff.splitlines():
        if raw.startswith("diff --git "):
            flush()
            path, base_path, header, lines = "", "", "", []
            active, first_hunk, position = False, True, 0
        elif not active and raw.startswith("--- "):
            base_path = _path(raw)
        elif not active and raw.startswith("+++ "):
            path = _path(raw)
            if path == "/dev/null":
                path = base_path
        elif match := HEADER.match(raw):
            flush()
            lines = []
            old, new = int(match[1]), int(match[3])
            header = raw
            if not first_hunk:
                position += 1  # Later @@ headers count toward GitHub's original position.
            first_hunk, active = False, True
        elif active:
            position += 1
            if raw.startswith("\\ No newline"):
                continue
            if not raw or raw[0] not in " +-":
                active = False
                continue
            marker = raw[0]
            lines.append(
                DiffLine(
                    kind=KINDS[marker],
                    content=raw[1:],
                    head_line=new if marker != "-" else None,
                    base_line=old if marker != "+" else None,
                    github_position=position,
                )
            )
            old += marker != "+"
            new += marker != "-"
    flush()
    logger.info(
        "Diff cleaning: %d original chars, %d retained chars",
        len(diff),
        sum(len(line.content) + 1 for h in hunks for line in h.lines),
    )
    return hunks
