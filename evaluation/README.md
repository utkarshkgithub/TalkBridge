# Brick 2 evaluation

The scripts require a running, untouched base 8B vLLM server. They never generate fake baseline
metrics from fixtures. The committed split is prepared; live inference results are not present yet.

## Server

On a Linux machine with an NVIDIA GPU, Docker and NVIDIA Container Toolkit:

```bash
docker compose -f compose.vllm.yaml --profile inference up -d
```

This optional service uses Qwen's Apache-2.0, ungated, four-bit Qwen3-8B-AWQ weights with a
pinned model revision and vLLM 0.15.0. It enables prefix caching and disables thinking per
request. No LoRA adapter is loaded. We use "base_8b" to mean this untouched model before
project fine-tuning, not an unaligned pretrained checkpoint. GPU memory requirements vary
with concurrency and context; reduce model context or concurrency if the GPU cannot fit it.
The image and weights need downloading. This service has not been executed on this Mac.

A remote server is also supported with `VLLM_BASE_URL`, `VLLM_MODEL` and optional
`VLLM_API_KEY`. Keep the endpoint private, or use an SSH tunnel. The Compose port binds to
loopback. No paid API or automatic cloud provisioning is required.

vLLM 0.12 removed `guided_json`. The default `VLLM_SCHEMA_MODE=structured_outputs` sends the
same Pydantic JSON schema through the supported replacement. Legacy vLLM servers can use
`VLLM_SCHEMA_MODE=guided_json`. Both transport modes have offline contract tests.
References: [structured outputs](https://docs.vllm.ai/en/v0.15.0/features/structured_outputs/),
[model and license](https://huggingface.co/Qwen/Qwen3-8B-AWQ).

## Live checks

Use a dedicated server because the cache test explicitly resets its prefix cache:

```bash
LIVE_VLLM=1 ALLOW_CACHE_RESET=1 backend/.venv/bin/pytest tests/brick2 -m live_vllm -v -s
```

These tests validate four parallel finder calls, measure first-content-token latency for
three cold/warm pairs, and check adversarial verification of safe/unsafe SQL. They are skipped
unless explicitly enabled. Byte-identical prefixes permit cache reuse, but parallel cold
requests alone do not prove caching or speedup. Only observed cache counts and live latency
measurements can demonstrate it.

## Baselines

Run from the repository root after configuring the endpoint in `backend/.env` or shell
environment variables. The evaluator and live tests read `backend/.env` independent of the
working directory; shell variables take precedence:

```bash
PYTHONPATH=backend backend/.venv/bin/python -m evaluation.run_eval \
  --split evaluation/data/heldout_testset.jsonl --mode single_agent --model-profile base_8b \
  --out evaluation/results/single_agent_metrics.json \
  --errors-out evaluation/results/single_agent_errors.jsonl

PYTHONPATH=backend backend/.venv/bin/python -m evaluation.run_eval \
  --split evaluation/data/heldout_testset.jsonl --mode multi_agent --model-profile base_8b \
  --out evaluation/results/baseline_metrics.json \
  --errors-out evaluation/results/baseline_errors.jsonl
```

Single-agent runs A without the verifier; multi-agent uses adaptive routing and verification.
Both consume the exact same split and deterministic Stage 0. The evaluator checks the model
is served and refuses to freeze a baseline with inference failures or incomplete SAST scans.
It refuses result overwrites. Output records include model identity, dataset hash, script hash,
metric formula hash and per-sample predictions. No GitHub writes occur during evaluation.

Precision, recall, F1 and FPR use the highest non-refuted score in each sample, default threshold
80. Threshold curves use 40, 60, 80 and 90. CWE top-1 counts a sample correct only when a
vulnerable sample is detected at 80 and its top CWE matches ground truth; missed positives
count as wrong. JSON validity divides successful schema-validated calls by attempted calls.
Transport or budget errors therefore lower it. P50/P95 use nearest-rank wall-clock sample
latency including Stage 0. Verifier specificity is the fraction of candidates on clean samples
that the verifier refutes; it is zero when no such candidates exist. A single-agent run has
no verifier calls. These formula definitions must remain frozen with the live baseline.

Results include suppressed findings in error records. Dashboard persistence comes in Brick 3.
A full Stage 0-4 test uses real Stage 0 and sandboxed HTTP transports for inference and GitHub;
it proves payload flow, not model quality or real GitHub authorization.
