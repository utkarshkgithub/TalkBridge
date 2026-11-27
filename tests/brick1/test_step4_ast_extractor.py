import pytest
from app.pipeline.ast_extractor import DEFAULT_REVIEW_RULES, extract_context, load_review_rules
from app.pipeline.diff_cleaner import clean_diff


def changed(path: str, line: int):
    return clean_diff(
        f"diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n@@ -{line} +{line} @@\n-old\n+new\n"
    )


def test_python_minimal_enclosing_function_and_caller() -> None:
    source = (
        "\n" * 300
        + "def authenticate_user(name):\n    return name\n\ndef login_handler():\n    return authenticate_user('a')\n"
    )
    source += "\n".join(f"def unrelated_{i}():\n    pass\n" for i in range(6))
    chunks = extract_context(changed("login.py", 302), {"login.py": source})
    assert len(chunks) == 1
    chunk = chunks[0]
    assert chunk.symbol == "authenticate_user"
    assert chunk.source == "def authenticate_user(name):\n    return name"
    assert chunk.caller_signatures == ["login.py:304 def login_handler():"]
    assert "unrelated" not in chunk.source
    assert not chunk.fallback


def test_typescript_callback_and_service() -> None:
    source = 'function service(id: string) { return id; }\napp.get("/", (req, res) => {\n  res.send(service(req.id));\n});\n'
    chunks = extract_context(changed("route.ts", 3), {"route.ts": source})
    assert len(chunks) == 1
    assert "res.send" in chunks[0].source
    assert chunks[0].callee_signatures == ["route.ts:1 function service(id: string)"]


@pytest.mark.parametrize(
    ("path", "source", "symbol"),
    [
        ("a.js", "function run() { return 1; }", "run"),
        ("A.java", "class A { int run() { return 1; } }", "run"),
        ("a.c", "int run(void) { return 1; }", "run"),
        ("a.cpp", "int run() { return 1; }", "run"),
        ("a.tsx", "const run = () => { return <div />; };", "run"),
    ],
)
def test_supported_languages(path: str, source: str, symbol: str) -> None:
    chunk = extract_context(changed(path, 1), {path: source})[0]
    assert not chunk.fallback
    assert chunk.symbol == symbol


def test_parse_error_unsupported_and_budget_fallback() -> None:
    for path in ["a.py", "a.rs"]:
        source = "line\n" * 25 + "def broken(:\n" + "line\n" * 25
        chunk = extract_context(changed(path, 26), {path: source})[0]
        assert chunk.fallback
        assert (chunk.line_start, chunk.line_end) == (11, 41)
    source = "def long():\n" + "    run()\n" * 400
    chunk = extract_context(changed("long.py", 200), {"long.py": source}, max_lines=50)[0]
    assert chunk.line_start <= 200 <= chunk.line_end
    assert len(chunk.source.splitlines()) <= 50


def test_rules_verbatim_and_fallback() -> None:
    assert load_review_rules({"REVIEW.md": "  rules\n", "CLAUDE.md": "fallback"}) == "  rules\n"
    assert load_review_rules({"CLAUDE.md": "fallback"}) == "fallback"
    assert load_review_rules({}) == DEFAULT_REVIEW_RULES


def test_deletion_extracts_changed_function_instead_of_first_context() -> None:
    source = "def unrelated():\n    return 1\n\ndef login(user):\n    return user\n"
    diff = (
        "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1,7 +1,5 @@\n"
        " def unrelated():\n     return 1\n \n def login(user):\n"
        "-    if not user:\n-        raise ValueError()\n     return user\n"
    )
    chunks = extract_context(clean_diff(diff), {"a.py": source})
    assert [chunk.symbol for chunk in chunks] == ["login"]


def test_fallback_window_does_not_hide_changed_function() -> None:
    source = "CONSTANT = 2\n\ndef login(user):\n    return user\n"
    diff = (
        "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -1,4 +1,4 @@\n"
        "-CONSTANT = 1\n+CONSTANT = 2\n \n def login(user):\n-    return None\n+    return user\n"
    )
    chunks = extract_context(clean_diff(diff), {"a.py": source})
    assert any(chunk.symbol == "login" and not chunk.fallback for chunk in chunks)
