"""Live inference evaluation. Sample-level classification, not localization accuracy."""

import argparse
import asyncio
import hashlib
import inspect
import json
import math
import time
from pathlib import Path
from typing import Any

import httpx
from app.agents.orchestrator import ReviewOrchestrator
from app.config import Settings
from app.llm.vllm_client import VLLMClient
from app.pipeline.stage0 import Stage0
from app.schemas import EvaluationCase, EvaluationPrediction, InferenceError

from evaluation.prepare_testset import validate_cases

BACKEND_ENV = Path(__file__).resolve().parents[1] / "backend" / ".env"
BASELINE_PATH = Path(__file__).resolve().parent / "results" / "baseline_metrics.json"


def evaluation_settings() -> Settings:
    """Use the same .env as the documented backend launch, independent of cwd."""
    # Pydantic's generated constructor signature omits BaseSettings' runtime options.
    options: dict[str, Any] = {"_env_file": BACKEND_ENV}
    return Settings(**options)


def ratio(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0


def classification(rows: list[EvaluationPrediction], threshold: int) -> dict[str, float | int]:
    tp = sum(r.vulnerable and r.score >= threshold for r in rows)
    fp = sum(not r.vulnerable and r.score >= threshold for r in rows)
    fn = sum(r.vulnerable and r.score < threshold for r in rows)
    tn = len(rows) - tp - fp - fn
    precision, recall = ratio(tp, tp + fp), ratio(tp, tp + fn)
    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "tn": tn,
        "precision": precision,
        "recall": recall,
        "f1": 2 * precision * recall / (precision + recall) if precision + recall else 0.0,
        "fpr": ratio(fp, fp + tn),
    }


def metrics(rows: list[EvaluationPrediction]) -> dict[str, Any]:
    latencies = sorted(r.latency_ms for r in rows)
    if not latencies:
        raise ValueError("No evaluation predictions")
    positives = [r for r in rows if r.vulnerable]
    clean = [r for r in rows if not r.vulnerable]
    calls = sum(r.calls for r in rows)
    return {
        **classification(rows, 80),
        "cwe_accuracy": ratio(
            sum(r.score >= 80 and r.predicted_cwe in r.cwe_ids for r in positives), len(positives)
        ),
        "json_validity_pct": 100 * ratio(sum(r.valid_calls for r in rows), calls),
        "p50_latency_ms": latencies[math.ceil(0.5 * len(rows)) - 1],
        "p95_latency_ms": latencies[math.ceil(0.95 * len(rows)) - 1],
        "verifier_specificity": ratio(
            sum(r.verifier_refutations for r in clean), sum(r.verifier_attempts for r in clean)
        ),
        "threshold_curve": {str(t): classification(rows, t) for t in (40, 60, 80, 90)},
    }


def select_predicted_cwe(result: Any) -> tuple[int, str | None, bool]:
    eligible = [f for f in result.findings if f.verification.verdict != "refuted"]
    best = max(eligible, key=lambda f: f.verification.calibrated_confidence, default=None)
    top_cwe = max(
        (
            f
            for f in eligible
            if f.candidate.cwe_id and f.verification.calibrated_confidence >= 80
        ),
        key=lambda f: f.verification.calibrated_confidence,
        default=best,
    )
    return (
        best.verification.calibrated_confidence if best else 0,
        top_cwe.candidate.cwe_id if top_cwe else None,
        any(f.verification.verdict == "refuted" for f in result.findings),
    )


async def evaluate(
    cases: list[EvaluationCase], settings: Settings, single: bool
) -> tuple[list[EvaluationPrediction], list[dict[str, Any]], dict[str, Any]]:
    rows: list[EvaluationPrediction] = []
    errors: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=settings.vllm_timeout_seconds) as http:
        key = settings.vllm_api_key.get_secret_value()
        response = await http.get(
            settings.vllm_base_url.rstrip("/") + "/models",
            headers={"Authorization": f"Bearer {key}"} if key else {},
        )
        response.raise_for_status()
        served = next((m for m in response.json()["data"] if m["id"] == settings.vllm_model), None)
        if served is None:
            raise ValueError("Configured base model is not served by the endpoint")
        stage0 = Stage0(settings)
        orchestrator = ReviewOrchestrator(stage0, VLLMClient(settings, http))
        for index, case in enumerate(cases):
            start = time.perf_counter()
            bundle = await stage0.run(case.source)
            if bundle.sast_status != "completed":
                sast_error = InferenceError(
                    stage="finder",
                    role="stage0",
                    code="invalid_output",
                    message=f"Deterministic SAST scan status: {bundle.sast_status}",
                )
                row = EvaluationPrediction(
                    id=case.id,
                    vulnerable=case.vulnerable,
                    cwe_ids=case.cwe_ids,
                    score=0,
                    predicted_cwe=None,
                    latency_ms=(time.perf_counter() - start) * 1000,
                    calls=0,
                    valid_calls=0,
                    errors=[sast_error],
                )
                rows.append(row)
                errors.append(
                    {
                        "id": case.id,
                        "kind": "runtime_error",
                        "prediction": row.model_dump(),
                        "review": None,
                    }
                )
                print(f"{index + 1}/{len(cases)} {case.id} sast={bundle.sast_status}", flush=True)
                continue
            result = await orchestrator.review(bundle, single=single)
            score, predicted_cwe, verifier_refuted = select_predicted_cwe(result)
            valid = result.telemetry.inference_valid_calls
            row = EvaluationPrediction(
                id=case.id,
                vulnerable=case.vulnerable,
                cwe_ids=case.cwe_ids,
                score=score,
                predicted_cwe=predicted_cwe,
                latency_ms=(time.perf_counter() - start) * 1000,
                calls=valid + len(result.errors),
                valid_calls=valid,
                verifier_refuted=verifier_refuted,
                verifier_attempts=result.telemetry.verifier_attempts,
                verifier_refutations=result.telemetry.verifier_refutations,
                errors=result.errors,
            )
            rows.append(row)
            wrong = bool(row.score >= 80) != case.vulnerable
            if (
                wrong
                or result.errors
                or (case.vulnerable and row.predicted_cwe not in case.cwe_ids)
            ):
                errors.append(
                    {
                        "id": case.id,
                        "kind": "runtime_error"
                        if result.errors
                        else "over_flagged_safe"
                        if not case.vulnerable
                        else "bad_calibration"
                        if wrong
                        else "wrong_cwe",
                        "prediction": row.model_dump(),
                        "review": result.model_dump(mode="json"),
                    }
                )
            print(f"{index + 1}/{len(cases)} {case.id}", flush=True)
    return rows, errors, served


def formula_hash() -> str:
    return hashlib.sha256(
        "".join(inspect.getsource(f) for f in (ratio, classification, metrics)).encode()
    ).hexdigest()


def check_freeze(split: Path, baseline: Path) -> None:
    if baseline.exists():
        frozen = json.loads(baseline.read_text())
        if frozen["dataset_hash"] != hashlib.sha256(split.read_bytes()).hexdigest():
            raise ValueError("Held-out split differs from the frozen baseline")
        if frozen["metric_formula_hash"] != formula_hash():
            raise ValueError("Metric formulas differ from the frozen baseline")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--split", type=Path, required=True)
    parser.add_argument("--mode", choices=["single_agent", "multi_agent"], required=True)
    parser.add_argument("--model-profile", choices=["base_8b"], default="base_8b")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--errors-out", type=Path, required=True)
    args = parser.parse_args()
    cases = [EvaluationCase.model_validate_json(s) for s in args.split.read_text().splitlines()]
    validate_cases(cases)
    check_freeze(args.split, BASELINE_PATH)
    if args.out.resolve() == args.errors_out.resolve():
        raise ValueError("Metrics and error records require separate output paths")
    if args.out.exists() or args.errors_out.exists():
        raise ValueError("Refusing to overwrite evaluation results")
    settings = evaluation_settings()
    if settings.lora_enabled:
        raise ValueError("Base baseline requires LORA_ENABLED=false")
    rows, errors, served = asyncio.run(evaluate(cases, settings, args.mode == "single_agent"))
    if any(r.errors for r in rows):
        raise RuntimeError(
            "Inference failures occurred; baseline was not frozen. Fix endpoint and rerun."
        )
    report = {
        **metrics(rows),
        "dataset_hash": hashlib.sha256(args.split.read_bytes()).hexdigest(),
        "dataset_size": len(cases),
        "model_profile": args.model_profile,
        "mode": args.mode,
        "model": settings.vllm_model,
        "server_model": served,
        "schema_mode": settings.vllm_schema_mode,
        "evaluation_script_hash": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "metric_formula_hash": formula_hash(),
        "metric_scope": "sample-level classification; CWE top-1 across all positives",
        "predictions": [r.model_dump() for r in rows],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.errors_out.parent.mkdir(parents=True, exist_ok=True)
    args.errors_out.write_text("".join(json.dumps(e) + "\n" for e in errors))
    args.out.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
