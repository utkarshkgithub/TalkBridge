import hashlib
from pathlib import Path

import pytest
from app.schemas import EvaluationCase, EvaluationPrediction

from evaluation.prepare_testset import validate_cases
from evaluation.run_eval import metrics

SPLIT = Path("evaluation/data/heldout_testset.jsonl")


def test_real_split_integrity():
    cases = [EvaluationCase.model_validate_json(s) for s in SPLIT.read_text().splitlines()]
    validate_cases(cases)
    assert len(cases) == 180 and sum(not c.vulnerable for c in cases) == 72
    assert sum(c.dataset == "primevul_paired" for c in cases) == 120
    assert (
        hashlib.sha256(SPLIT.read_bytes()).hexdigest()
        == "2f659a8b4d78c51e75493942d0c71e14bb78e15d92b5155645212191801bae85"
    )
    assert all(not c.source.commit_subjects for c in cases)
    assert all("CVE-" not in c.source.context.model_dump_json() for c in cases)
    with pytest.raises(ValueError, match="Duplicate"):
        validate_cases(cases[:-1] + [cases[0]])
    with pytest.raises(ValueError, match="hash mismatch"):
        cases[0].normalized_code_hash = "wrong"
        validate_cases(cases)


def test_metric_formulas_and_thresholds():
    rows = [
        EvaluationPrediction(
            id=str(i),
            vulnerable=target,
            score=score,
            cwe_ids=["CWE-89"],
            predicted_cwe=cwe,
            latency_ms=latency,
            calls=1,
            valid_calls=valid,
        )
        for i, (target, score, cwe, latency, valid) in enumerate(
            [
                (True, 90, "CWE-89", 1, 1),
                (True, 65, "CWE-89", 2, 1),
                (False, 85, "CWE-79", 3, 1),
                (False, 0, None, 100, 0),
            ]
        )
    ]
    result = metrics(rows)
    assert (result["tp"], result["fp"], result["fn"], result["tn"]) == (1, 1, 1, 1)
    assert result["precision"] == result["recall"] == result["f1"] == result["fpr"] == 0.5
    assert result["cwe_accuracy"] == 0.5 and result["json_validity_pct"] == 75
    assert result["p50_latency_ms"] == 2 and result["p95_latency_ms"] == 100
    assert set(result["threshold_curve"]) == {"40", "60", "80", "90"}
    assert result["threshold_curve"]["60"]["recall"] == 1
    assert result["threshold_curve"]["90"]["precision"] == 1
    with pytest.raises(ValueError):
        metrics([])


def test_baseline_freeze_guard(tmp_path):
    import json

    from evaluation.run_eval import check_freeze, formula_hash

    baseline = tmp_path / "baseline.json"
    baseline.write_text(
        json.dumps(
            {
                "dataset_hash": hashlib.sha256(SPLIT.read_bytes()).hexdigest(),
                "metric_formula_hash": formula_hash(),
            }
        )
    )
    check_freeze(SPLIT, baseline)
    changed = tmp_path / "split.jsonl"
    changed.write_text("changed")
    with pytest.raises(ValueError, match="split differs"):
        check_freeze(changed, baseline)
    baseline.write_text(
        json.dumps(
            {
                "dataset_hash": hashlib.sha256(SPLIT.read_bytes()).hexdigest(),
                "metric_formula_hash": "changed",
            }
        )
    )
    with pytest.raises(ValueError, match="formulas differ"):
        check_freeze(SPLIT, baseline)


def test_reject_mislabeled_upstream_language():
    from evaluation.prepare_testset import valid_language

    assert not valid_language("import Foundation\nfunc unsafeCopy(_ source: String) {}", "js")
    assert not valid_language("class VulnerableClass\n  def initialize(input)\n  end\nend", "py")
    assert valid_language(
        'def lookup(uid, cursor):\n    return cursor.execute("SELECT %s", (uid,))', "py"
    )


def test_evaluation_reads_backend_environment(tmp_path, monkeypatch):
    from evaluation import run_eval

    backend_env = tmp_path / ".env"
    backend_env.write_text("VLLM_BASE_URL=http://127.0.0.1:8765/v1\n")
    monkeypatch.setattr(run_eval, "BACKEND_ENV", backend_env)
    monkeypatch.delenv("VLLM_BASE_URL", raising=False)
    monkeypatch.chdir(tmp_path.parent)
    assert run_eval.evaluation_settings().vllm_base_url == "http://127.0.0.1:8765/v1"
