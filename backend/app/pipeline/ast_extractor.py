"""Extract enclosing functions and immediate call signatures from touched source files."""

import importlib
import re
from collections.abc import Iterator, Mapping
from pathlib import PurePosixPath

from tree_sitter import Language, Node, Parser

from app.pipeline.diff_cleaner import HEADER
from app.schemas import AstChunk, CleanedHunk

DEFAULT_REVIEW_RULES = "Correctness over style. Report actionable bugs and security issues only."
GRAMMARS = {
    ".py": ("python", "tree_sitter_python", "language"),
    ".js": ("javascript", "tree_sitter_javascript", "language"),
    ".jsx": ("javascript", "tree_sitter_javascript", "language"),
    ".mjs": ("javascript", "tree_sitter_javascript", "language"),
    ".ts": ("typescript", "tree_sitter_typescript", "language_typescript"),
    ".tsx": ("tsx", "tree_sitter_typescript", "language_tsx"),
    ".java": ("java", "tree_sitter_java", "language"),
    ".c": ("c", "tree_sitter_c", "language"),
    ".h": ("c", "tree_sitter_c", "language"),
    ".cc": ("cpp", "tree_sitter_cpp", "language"),
    ".cpp": ("cpp", "tree_sitter_cpp", "language"),
    ".hpp": ("cpp", "tree_sitter_cpp", "language"),
}
FUNCTIONS = {
    "function_definition",
    "function_declaration",
    "method_definition",
    "method_declaration",
    "constructor_declaration",
    "arrow_function",
    "function_expression",
    "lambda_expression",
}
CALLS = {"call", "call_expression", "method_invocation"}


def load_review_rules(files: Mapping[str, str]) -> str:
    for name in ("REVIEW.md", "CLAUDE.md"):
        if name in files:
            return files[name]
    return DEFAULT_REVIEW_RULES


def walk(node: Node) -> Iterator[Node]:
    stack = [node]
    while stack:
        current = stack.pop()
        yield current
        stack.extend(reversed(current.named_children))


def _text(node: Node, source: bytes) -> str:
    return source[node.start_byte : node.end_byte].decode("utf-8", errors="replace")


def _name(node: Node, source: bytes) -> str:
    name = node.child_by_field_name("name")
    if name is not None:
        return _text(name, source)
    declarator = node.child_by_field_name("declarator")
    if declarator is not None:
        for child in walk(declarator):
            if child.type in {"identifier", "field_identifier"}:
                return _text(child, source)
    parent = node.parent
    if parent is not None and parent.type == "variable_declarator":
        name = parent.child_by_field_name("name")
        if name is not None:
            return _text(name, source)
    return f"callback@{node.start_point.row + 1}"


def _signature(node: Node, source: bytes) -> str:
    body = node.child_by_field_name("body")
    end = body.start_byte if body is not None else node.end_byte
    return " ".join(source[node.start_byte : end].decode("utf-8", errors="replace").split())[:500]


def _called_names(node: Node, source: bytes) -> set[str]:
    names = set()
    stack = list(node.named_children)
    while stack:
        child = stack.pop()
        if child.type in FUNCTIONS:
            continue  # A nested function's body is not an immediate call from its parent.
        if child.type in CALLS:
            callee = child.child_by_field_name("function") or child.child_by_field_name("name")
            if callee is not None:
                identifiers = re.findall(r"[A-Za-z_$][\w$]*", _text(callee, source))
                if identifiers:
                    names.add(identifiers[-1])
        stack.extend(child.named_children)
    return names


def extract_context(
    hunks: list[CleanedHunk],
    files: Mapping[str, str],
    *,
    max_lines: int = 200,
) -> list[AstChunk]:
    parsed: dict[str, tuple[str, bytes, list[Node]]] = {}
    for path in sorted({h.file for h in hunks} & files.keys()):
        source = files[path].encode()
        grammar = GRAMMARS.get(PurePosixPath(path).suffix.lower())
        if grammar is None:
            continue
        language, module, factory = grammar
        tree = Parser(Language(getattr(importlib.import_module(module), factory)())).parse(source)
        if not tree.root_node.has_error:
            parsed[path] = (
                language,
                source,
                [node for node in walk(tree.root_node) if node.type in FUNCTIONS],
            )
    chunks: list[AstChunk] = []
    seen: set[tuple[str, int, int]] = set()
    for hunk in hunks:
        if hunk.file not in files:
            continue
        lines = files[hunk.file].splitlines()
        if not lines:
            continue
        # Deletions anchor to the nearest surviving line for AST context only, never for publishing.
        changed = set(hunk.changed_head_lines)
        header = HEADER.match(hunk.header)
        cursor = int(header[3]) if header else hunk.line_start
        for diff_line in hunk.lines:
            if diff_line.head_line is not None:
                cursor = diff_line.head_line + 1
            elif diff_line.kind == "deletion":
                changed.add(max(1, min(cursor, len(lines))))
        for line in sorted(changed):
            enclosing = []
            if hunk.file in parsed:
                language, source, functions = parsed[hunk.file]
                enclosing = [
                    node
                    for node in functions
                    if node.start_point.row < line <= node.end_point.row + 1
                ]
            if not enclosing:
                if any(
                    chunk.file == hunk.file
                    and chunk.fallback
                    and chunk.line_start <= line <= chunk.line_end
                    for chunk in chunks
                ):
                    continue
                start, end = max(1, line - 15), min(len(lines), line + 15)
                key = (hunk.file, start, end)
                if key not in seen:
                    chunks.append(
                        AstChunk(
                            file=hunk.file,
                            line_start=start,
                            line_end=end,
                            language=GRAMMARS.get(PurePosixPath(hunk.file).suffix, ("unknown",))[0],
                            symbol="context_window",
                            source="\n".join(lines[start - 1 : end]),
                            fallback=True,
                        )
                    )
                    seen.add(key)
                continue
            function = min(enclosing, key=lambda node: node.end_byte - node.start_byte)
            symbol = _name(function, source)
            if any(
                chunk.file == hunk.file
                and not chunk.fallback
                and chunk.symbol == symbol
                and chunk.line_start <= line <= chunk.line_end
                for chunk in chunks
            ):
                continue
            start, end = function.start_point.row + 1, function.end_point.row + 1
            if end - start + 1 > max_lines:
                start = max(start, line - max_lines // 2)
                end = min(end, start + max_lines - 1)
            key = (hunk.file, start, end)
            if key in seen:
                continue
            seen.add(key)
            calls = _called_names(function, source)
            callers, callees = [], []
            for other_path, (_, other_source, other_functions) in parsed.items():
                for other in other_functions:
                    if other_path == hunk.file and other.id == function.id:
                        continue
                    signature = f"{other_path}:{other.start_point.row + 1} {_signature(other, other_source)}"
                    if symbol in _called_names(other, other_source):
                        callers.append(signature)
                    if _name(other, other_source) in calls:
                        callees.append(signature)
            chunks.append(
                AstChunk(
                    file=hunk.file,
                    line_start=start,
                    line_end=end,
                    language=language,
                    symbol=symbol,
                    source="\n".join(lines[start - 1 : end]),
                    caller_signatures=sorted(set(callers))[:20],
                    callee_signatures=sorted(set(callees))[:20],
                )
            )
    return chunks
