import subprocess
from pathlib import Path
from unittest.mock import Mock

import pytest
from app.config import Settings
from app.pipeline.depth_router import route_depth
from app.pipeline.diff_cleaner import clean_diff
from app.pipeline.sast_scanner import SastScanner
from app.schemas import DepthMode


def added(path: str, source: str):
    lines = source.splitlines()
    return clean_diff(
        f"diff --git a/{path} b/{path}\n--- /dev/null\n+++ b/{path}\n@@ -0,0 +1,{len(lines)} @@\n"
        + "\n".join("+" + line for line in lines)
        + "\n"
    )


@pytest.mark.parametrize(
    ("loc", "path", "expected"),
    [
        (20, "src/helpers.py", "quick"),
        (49, "src/helpers.py", "quick"),
        (50, "src/orders.py", "standard"),
        (120, "src/orders.py", "standard"),
        (300, "src/orders.py", "standard"),
        (301, "src/orders.py", "deep"),
        (350, "src/orders.py", "deep"),
        (12, "src/auth/jwt.py", "deep"),
        (1, "db/query.py", "deep"),
        (1, "src/admin/view.py", "deep"),
        (1, "src/author.py", "quick"),
    ],
)
def test_routing(loc: int, path: str, expected: str) -> None:
    assert route_depth(added(path, "run()\n" * loc)) == DepthMode(expected)


def test_real_semgrep_hints_and_clean_bindings() -> None:
    source = 'api_key = "sk_example_1234567890123456"\neval(user_input)\ncursor.execute(f"SELECT * FROM users WHERE id = {uid}")\n'
    scanner = SastScanner(Settings(_env_file=None).semgrep_rules_path)
    result = scanner.scan({"auth/login.py": source}, added("auth/login.py", source))
    assert result.status == "completed", result
    assert {h.cwe_id for h in result.hints} == {"CWE-798", "CWE-95", "CWE-89"}
    assert {(h.line_start, h.line_end) for h in result.hints} == {(1, 1), (2, 2), (3, 3)}
    clean = 'cursor.execute("SELECT * FROM users WHERE id = %s", (uid,))\n'
    result = scanner.scan({"safe.py": clean}, added("safe.py", clean))
    assert result.status == "completed", result
    assert not result.hints


def test_scanner_timeout_and_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    scanner = SastScanner(Settings(_env_file=None).semgrep_rules_path)
    process = Mock(pid=123, returncode=0)
    process.communicate.side_effect = [subprocess.TimeoutExpired("semgrep", 5), (b"", b"")]
    monkeypatch.setattr("app.pipeline.sast_scanner.subprocess.Popen", Mock(return_value=process))
    kill = Mock()
    monkeypatch.setattr("app.pipeline.sast_scanner.os.killpg", kill)
    assert scanner.scan({"a.py": "eval(x)"}, added("a.py", "eval(x)")).status == "timeout"
    kill.assert_called_once()
    assert (
        SastScanner(Path("/missing-rules")).scan({"a.py": "x"}, added("a.py", "x")).status
        == "unavailable"
    )
    with pytest.raises(ValueError):
        SastScanner(Path("."), timeout=6)


def test_scanner_filters_unchanged_findings(monkeypatch: pytest.MonkeyPatch) -> None:
    import json

    result = {
        "results": [
            {
                "path": "a.py",
                "start": {"line": 1},
                "end": {"line": 1},
                "check_id": "eval",
                "extra": {"message": "eval", "severity": "ERROR"},
            }
        ]
    }
    process = Mock(returncode=0)
    process.communicate.return_value = (json.dumps(result).encode(), b"")
    monkeypatch.setattr("app.pipeline.sast_scanner.subprocess.Popen", Mock(return_value=process))
    hunks = clean_diff(
        "diff --git a/a.py b/a.py\n--- a/a.py\n+++ b/a.py\n@@ -2 +2 @@\n-old\n+new\n"
    )
    assert (
        not SastScanner(Settings(_env_file=None).semgrep_rules_path)
        .scan({"a.py": "eval(x)\nnew"}, hunks)
        .hints
    )


def test_scanner_treats_dash_filename_as_target(monkeypatch: pytest.MonkeyPatch) -> None:
    process = Mock(returncode=0)
    process.communicate.return_value = (b'{"results": []}', b"")
    popen = Mock(return_value=process)
    monkeypatch.setattr("app.pipeline.sast_scanner.subprocess.Popen", popen)
    scanner = SastScanner(Settings(_env_file=None).semgrep_rules_path)
    assert scanner.scan({"-target.py": "x=1"}, added("-target.py", "x=1")).status == "completed"
    command = popen.call_args.args[0]
    assert command[-2:] == ["--", "-target.py"]


def test_scanner_skips_unsupported_extensions(monkeypatch: pytest.MonkeyPatch) -> None:
    popen = Mock()
    monkeypatch.setattr("app.pipeline.sast_scanner.subprocess.Popen", popen)
    scanner = SastScanner(Settings(_env_file=None).semgrep_rules_path)
    result = scanner.scan({"main.c": "int main() { return 0; }"}, added("main.c", "int main() {}"))
    assert result.status == "completed" and not result.hints
    popen.assert_not_called()
