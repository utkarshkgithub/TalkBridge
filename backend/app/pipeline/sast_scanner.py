"""Local-only Semgrep subprocess with a hard wall-clock timeout."""

import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
from collections.abc import Mapping
from pathlib import Path, PurePosixPath
from typing import Literal

import certifi
from pydantic import ValidationError

from app.pipeline.diff_cleaner import safe_path
from app.schemas import CleanedHunk, Contract, SastHint


class ScanResult(Contract):
    hints: list[SastHint] = []
    status: Literal["completed", "timeout", "unavailable", "error"] = "completed"
    warnings: list[str] = []


LANG_EXTENSIONS: dict[str, set[str]] = {
    "python": {".py"},
    "javascript": {".js", ".jsx", ".mjs", ".cjs"},
    "typescript": {".ts", ".tsx"},
    "java": {".java"},
    "c": {".c", ".h"},
    "cpp": {".cc", ".cpp", ".hpp"},
}


def _supported_extensions(rules_dir: Path) -> set[str] | None:
    files = list(rules_dir.glob("*.yml")) + list(rules_dir.glob("*.yaml"))
    if not files:
        return None
    exts: set[str] = set()
    for path in files:
        matches = re.findall(r"^\s*languages:\s*\[([^\]]+)\]", path.read_text(encoding="utf-8"), re.M)
        if not matches:
            return None
        for group in matches:
            for lang in (part.strip().lower() for part in group.split(",")):
                if lang not in LANG_EXTENSIONS:
                    return None
                exts.update(LANG_EXTENSIONS[lang])
    return exts


class SastScanner:
    def __init__(self, rules: Path, timeout: float = 5.0) -> None:
        if not 0 < timeout <= 5:
            raise ValueError("Semgrep timeout must be in (0, 5] seconds")
        self.rules = rules.resolve()
        self.timeout = timeout

    def scan(self, files: Mapping[str, str], hunks: list[CleanedHunk]) -> ScanResult:
        targets = sorted({h.file for h in hunks} & files.keys())
        if not targets:
            return ScanResult()
        if not self.rules.is_dir():
            return ScanResult(
                status="unavailable", warnings=["Local Semgrep rules directory is missing"]
            )
        if (supported := _supported_extensions(self.rules)) is not None:
            targets = [t for t in targets if PurePosixPath(t).suffix.lower() in supported]
            if not targets:
                return ScanResult()
        with tempfile.TemporaryDirectory(prefix="talkbridge-sast-") as directory:
            root = Path(directory)
            for path in targets:
                if not safe_path(path):
                    return ScanResult(status="error", warnings=["Unsafe source path rejected"])
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(files[path], encoding="utf-8")
            env = {
                **os.environ,
                "SEMGREP_SEND_METRICS": "off",
                "SEMGREP_ENABLE_VERSION_CHECK": "0",
                "SSL_CERT_FILE": os.environ.get("SSL_CERT_FILE", certifi.where()),
                "SEMGREP_LOG_FILE": str(root / ".semgrep.log"),
                "SEMGREP_SETTINGS_FILE": str(root / ".semgrep-settings.yml"),
            }
            venv_semgrep = Path(sys.executable).with_name("semgrep")
            executable = (
                str(venv_semgrep)
                if venv_semgrep.exists()
                else shutil.which("semgrep") or str(venv_semgrep)
            )
            command = [
                executable,
                "scan",
                "--json",
                "--quiet",
                "--config",
                str(self.rules),
                "--metrics=off",
                "--disable-version-check",
                "--no-git-ignore",
                "--jobs=1",
                "--timeout=3",
                "--max-target-bytes=1000000",
                "--",
                *targets,
            ]
            try:
                process = subprocess.Popen(
                    command,
                    cwd=root,
                    env=env,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    start_new_session=True,
                )
                try:
                    stdout, _ = process.communicate(timeout=self.timeout)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.communicate()
                    return ScanResult(
                        status="timeout", warnings=["Semgrep exceeded its wall-clock timeout"]
                    )
            except OSError:
                return ScanResult(
                    status="unavailable", warnings=["Semgrep executable could not start"]
                )
            if process.returncode != 0:
                return ScanResult(status="error", warnings=["Semgrep exited unsuccessfully"])
            try:
                data = json.loads(stdout)
                hints = []
                for item in data.get("results", []):
                    path = str(item["path"])
                    if Path(path).is_absolute():
                        path = str(Path(path).relative_to(root))
                    path = path.removeprefix("./")
                    start, end = item["start"]["line"], item["end"]["line"]
                    if not any(
                        h.file == path
                        and any(start <= line <= end for line in h.changed_head_lines)
                        for h in hunks
                    ):
                        continue
                    extra = item["extra"]
                    cwe = extra.get("metadata", {}).get("cwe")
                    if isinstance(cwe, list):
                        cwe = cwe[0] if cwe else None
                    hints.append(
                        SastHint(
                            file=path,
                            line_start=start,
                            line_end=end,
                            rule_id=item["check_id"],
                            cwe_id=cwe.split(":")[0] if cwe else None,
                            message=extra["message"],
                            severity=extra["severity"],
                        )
                    )
                warnings = ["Semgrep reported partial scan errors"] if data.get("errors") else []
                return ScanResult(
                    hints=sorted(hints, key=lambda h: (h.file, h.line_start, h.rule_id)),
                    status="error" if warnings else "completed",
                    warnings=warnings,
                )
            except (ValueError, KeyError, TypeError, AttributeError, ValidationError):
                return ScanResult(status="error", warnings=["Semgrep returned invalid result data"])
