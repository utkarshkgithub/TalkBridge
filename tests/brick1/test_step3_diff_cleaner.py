from app.pipeline.diff_cleaner import clean_diff


def file_diff(path: str, content: str) -> str:
    return f"diff --git a/{path} b/{path}\n--- a/{path}\n+++ b/{path}\n{content}\n"


def test_noise_and_positions(caplog) -> None:
    noisy = file_diff("package-lock.json", "@@ -0,0 +1,2000 @@\n" + "+noise\n" * 2000)
    noisy += file_diff("public/bundle.min.js", "@@ -1 +1 @@\n-old\n+new")
    noisy += file_diff("utils/format.py", "@@ -1 +1 @@\n-x = 1\n+x=1")
    real = file_diff(
        "auth/login.py",
        "@@ -40,3 +40,3 @@\n def login():\n-    old()\n+    new()\n     return True",
    )
    with caplog.at_level("INFO"):
        hunks = clean_diff(noisy + real)
    assert len(hunks) == 1
    hunk = hunks[0]
    assert hunk.file == "auth/login.py"
    assert (hunk.line_start, hunk.line_end) == (40, 42)
    assert hunk.changed_head_lines == [41]
    assert [(line.head_line, line.base_line, line.github_position) for line in hunk.lines] == [
        (40, 40, 1),
        (None, 41, 2),
        (41, None, 3),
        (42, 42, 4),
    ]
    assert sum(len(line.content) for line in hunk.lines) / len(noisy + real) < 0.1
    assert "original chars" in caplog.text


def test_positions_include_filtered_hunk_and_headers() -> None:
    hunks = clean_diff(
        file_diff("a.js", "@@ -1 +1 @@\n-x = 1\n+x=1\n@@ -10 +10 @@\n-old()\n+new()")
    )
    assert len(hunks) == 1
    assert hunks[0].lines[-1].github_position == 5
    assert hunks[0].lines[-1].head_line == 10


def test_semantic_whitespace_is_preserved() -> None:
    for old, new in [("x = 'a b'", "x = 'ab'"), ("    run()", "        run()")]:
        assert clean_diff(file_diff("a.py", f"@@ -1 +1 @@\n-{old}\n+{new}"))
    assert clean_diff(file_diff("a.py", "@@ -1 +1 @@\n-x = 1\n+x=1"), enforce_style=True)


def test_token_boundaries_are_not_formatting() -> None:
    for old, new in [("return name", "returnname"), ("a + +b", "a++b")]:
        assert clean_diff(file_diff("a.js", f"@@ -1 +1 @@\n-{old}\n+{new}"))


def test_removed_binary_rename_and_new_file() -> None:
    removed = clean_diff(
        file_diff("a.py", "@@ -1 +0,0 @@\n-old()").replace("+++ b/a.py", "+++ /dev/null")
    )
    assert removed[0].file == "a.py"
    assert removed[0].lines[0].base_line == 1
    assert removed[0].lines[0].head_line is None
    assert not clean_diff("diff --git a/a.png b/a.png\nBinary files differ\n")
    assert not clean_diff(file_diff("../evil.py", "@@ -0,0 +1 @@\n+eval(x)"))
    assert clean_diff(file_diff("new.py", "@@ -0,0 +1 @@\n+run()"))[0].changed_head_lines == [1]
    renamed = 'diff --git "a/old name.py" "b/new name.py"\n--- "a/old name.py"\n+++ "b/new name.py"\n@@ -1 +1 @@\n-old()\n+new()\n'
    assert clean_diff(renamed)[0].file == "new name.py"


def test_deletion_only_hunk_has_no_added_anchor() -> None:
    hunk = clean_diff(file_diff("a.py", "@@ -2,2 +2,1 @@\n-old()\n keep()"))[0]
    assert not hunk.changed_head_lines
    assert hunk.lines[0].head_line is None


def test_git_quoted_utf8_filename() -> None:
    raw = r"""diff --git "a/caf\303\251.py" "b/caf\303\251.py"
--- "a/caf\303\251.py"
+++ "b/caf\303\251.py"
@@ -1 +1 @@
-old()
+new()
"""
    assert clean_diff(raw)[0].file == "café.py"
    assert clean_diff(raw.replace(r"caf\303\251.py", "café name.py"))[0].file == "café name.py"


def test_malformed_quoted_path_does_not_crash() -> None:
    raw = 'diff --git a/a.py b/a.py\n--- "a/unclosed.py\n+++ "b/unclosed.py\n@@ -1 +1 @@\n-old()\n+new()\n'
    assert clean_diff(raw)[0].file == "unclosed.py"
