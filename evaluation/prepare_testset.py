"""Build a reproducible benchmark from public test partitions, never training records."""

import argparse
import difflib
import hashlib
import importlib
import json
import re
from pathlib import Path
from typing import Any

from app.schemas import EvaluationCase, PRContext, PRSource
from tree_sitter import Language, Parser

PRIME_SHA = "384758c25142b640f1768bb0d334c43f315c580022ae94973c66e77128fb3821"
CODE_SHA = "f16650e9ccfa2aeb2858136b055d899d4059b435b88a76c16573fb88f175fae4"
EXTENSIONS = {"python": "py", "javascript": "js", "typescript": "ts", "java": "java"}


def valid_language(code: str, extension: str) -> bool:
    grammar = {"py": "python", "js": "javascript", "java": "java", "ts": "typescript"}[extension]
    module = importlib.import_module(f"tree_sitter_{grammar}")
    language = module.language_typescript() if extension == "ts" else module.language()
    return not Parser(Language(language)).parse(code.encode()).root_node.has_error


def code_hash(code: str) -> str:
    return hashlib.sha256(re.sub(r"\s+", "", code).encode()).hexdigest()


def sample(
    dataset: Any,
    provenance: str,
    before: str,
    after: str,
    vulnerable: bool,
    cwes: list[str],
    extension: str,
    commit: str | None = None,
    cve: str | None = None,
) -> EvaluationCase:
    after = after.rstrip() + "\n"
    before = before.rstrip() + "\n" if before else ""
    digest = code_hash(after)
    identity = hashlib.sha256((dataset + provenance + digest).encode()).hexdigest()[:24]
    path = f"src/module.{extension}"
    diff = f"diff --git a/{path} b/{path}\n" + "".join(
        difflib.unified_diff(
            before.splitlines(keepends=True),
            after.splitlines(keepends=True),
            fromfile=f"a/{path}",
            tofile=f"b/{path}",
            n=3,
        )
    )
    return EvaluationCase(
        id=identity,
        dataset=dataset,
        provenance=provenance,
        commit_sha=commit,
        cve_id=cve,
        normalized_code_hash=digest,
        vulnerable=vulnerable,
        cwe_ids=sorted({c for c in cwes if c.startswith("CWE-")}),
        source=PRSource(
            context=PRContext(
                delivery_id=identity,
                action="opened",
                repo_full_name="benchmark/sample",
                pr_number=1,
                base_sha=hashlib.sha256(before.encode()).hexdigest(),
                head_sha=hashlib.sha256(after.encode()).hexdigest(),
            ),
            diff=diff,
            files={path: after},
        ),
    )


def build_cases(prime: list[dict[str, Any]], code: list[dict[str, Any]]) -> list[EvaluationCase]:
    cases: list[EvaluationCase] = []
    used: set[str] = set()
    # The official paired test partition already follows PrimeVul's chronological split.
    # Consecutive vulnerable/fixed rows are paired by commit/CVE and pair order.
    for index in range(0, len(prime) - 1, 2):
        left, right = prime[index : index + 2]
        if {left["target"], right["target"]} != {0, 1}:
            continue
        bad, good = (left, right) if left["target"] else (right, left)
        if bad["commit_id"] != good["commit_id"] or bad.get("cve") != good.get("cve"):
            continue
        if max(len(bad["func"]), len(good["func"])) > 12000:
            continue
        hashes = {code_hash(bad["func"]), code_hash(good["func"])}
        if len(hashes) < 2 or used.intersection(hashes):
            continue
        for row, other in ((bad, good), (good, bad)):
            cases.append(
                sample(
                    "primevul_paired",
                    f"PrimeVul test paired idx={row['idx']}",
                    other["func"],
                    row["func"],
                    bool(row["target"]),
                    row.get("cwe") or [],
                    "c",
                    row["commit_id"],
                    row.get("cve"),
                )
            )
        used.update(hashes)
        if len(cases) == 120:
            break
    if len(cases) != 120:
        raise ValueError("Need 60 distinct eligible PrimeVul test pairs")
    all_prime_hashes = {code_hash(row["func"]) for row in prime}
    counts = {True: 0, False: 0}
    # Do not reuse C/C++ rows from aggregated BigVul/PrimeVul sources.
    eligible = sorted(enumerate(code), key=lambda item: code_hash(item[1]["code"]))
    for index, row in eligible:
        extension = EXTENSIONS.get(row["language"].lower())
        vulnerable = row["is_vulnerable"]
        digest = code_hash(row["code"])
        if (
            not extension
            or len(row["code"]) > 12000
            or not row["code"].strip()
            or digest in used
            or digest in all_prime_hashes
            or counts[vulnerable] >= (48 if vulnerable else 12)
        ):
            continue
        if vulnerable and not str(row["cwe_id"]).startswith("CWE-"):
            continue
        # The aggregated dataset contains incorrect language labels. Reject these records
        # instead of feeding Swift/Ruby/Go text to a JavaScript or Python scanner.
        if not valid_language(row["code"], extension):
            continue
        cases.append(
            sample(
                "code_security",
                f"Code Security test row={index}; upstream={row['source']}",
                "",
                row["code"],
                vulnerable,
                [row["cwe_id"]] if vulnerable else [],
                extension,
            )
        )
        used.add(digest)
        counts[vulnerable] += 1
    if counts != {True: 48, False: 12}:
        raise ValueError("Need 48 vulnerable and 12 clean Code Security test samples")
    validate_cases(cases)
    return cases


def validate_cases(cases: list[EvaluationCase]) -> None:
    if not 150 <= len(cases) <= 200:
        raise ValueError("Held-out split must contain 150 to 200 records")
    if len({c.id for c in cases}) != len(cases) or len(
        {c.normalized_code_hash for c in cases}
    ) != len(cases):
        raise ValueError("Duplicate benchmark record")
    if not 0.35 <= sum(not c.vulnerable for c in cases) / len(cases) <= 0.45:
        raise ValueError("Expected approximately 40% clean negatives")
    if {c.dataset for c in cases} != {"primevul_paired", "code_security"}:
        raise ValueError("Both benchmark sources are required")
    for case in cases:
        if case.vulnerable and not case.cwe_ids:
            raise ValueError("Vulnerable samples need CWE ground truth")
        if code_hash(next(iter(case.source.files.values()))) != case.normalized_code_hash:
            raise ValueError("Benchmark code hash mismatch")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--primevul", type=Path, required=True)
    parser.add_argument("--code-security", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=Path("evaluation/data/heldout_testset.jsonl"))
    args = parser.parse_args()
    import pyarrow.parquet as pq

    for path, expected in ((args.primevul, PRIME_SHA), (args.code_security, CODE_SHA)):
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f"Source checksum mismatch: {path}")
    cases = build_cases(
        [json.loads(s) for s in args.primevul.read_text().splitlines()],
        pq.read_table(args.code_security).to_pylist(),
    )
    content = "".join(c.model_dump_json() + "\n" for c in cases)
    if args.out.exists() and args.out.read_text() != content:
        raise ValueError("Refusing to overwrite a different held-out split")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(content)
    print(
        json.dumps(
            {
                "dataset_size": len(cases),
                "clean": sum(not c.vulnerable for c in cases),
                "dataset_hash": hashlib.sha256(content.encode()).hexdigest(),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
