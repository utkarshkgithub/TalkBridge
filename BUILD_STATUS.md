# Build status

## Brick 1: deterministic pipeline

Implemented and verified steps 1.1 through 1.5.

- Shared Pydantic contracts with strict integer confidence bounds and JSON schemas.
- Raw-body HMAC verification, bounded payloads, delivery TTL deduplication, event filtering,
  and queue backpressure with retry-safe delivery claims.
- Mockable GitHub App reader using installation credentials, head-SHA-pinned contents,
  paginated changed files, repository rules, and commit subjects.
- Diff noise filtering with original head/base line numbers and GitHub positions.
- Tree-sitter extraction for Python, JavaScript, TypeScript/TSX, Java, C, and C++.
  Parse failures and unsupported extensions use a 15-line context window on either side.
- Local Semgrep rules, explicit scan status, five-second subprocess timeout, and depth routing.
- Three offline fixtures plus a CLI to print Stage 0 bundles.
- PostgreSQL Docker Compose service and repeatable backend/frontend check commands.

## Deliberate limits

The application uses one Uvicorn process and a bounded asyncio queue. No Celery, Redis,
durable queue, automatic job retry, database persistence, or public review-result API is
implemented in this brick. The worker holds the last 100 successful bundles and last 100
failure statuses in memory. Restarting clears this state and the delivery cache.

Caller/callee context uses syntactic symbol matching within touched files. It is not a compiler
or whole-repository type resolver. Function bodies are capped at 200 lines per chunk by default;
large changes can create multiple bounded chunks. Source reads are limited to 1 MB per file and
10 MB per PR. Missing or inaccessible head source is recorded in bundle warnings.

Semgrep rules currently target Python and JS/TS. Java and C/C++ have AST context extraction,
but no dedicated local security rules yet. Semgrep hints are not final findings.
The webhook-to-worker integration uses a mocked GitHub transport; no real GitHub App installation
or external PR has been used for this brick.

## Verification

Validated on November 27, 2026:

- Brick 1 and existing backend tests: 71 passed in 4.31 seconds.
- Strict mypy: passed across 20 application source files.
- Ruff lint and formatting: passed.
- Backend wheel build: passed, including packaged Semgrep rules.
- Locked backend virtual-environment installation: passed.
- Frontend type check and ESLint: passed locally and in Docker.
- Next.js production build: passed in Docker. The host blocks Turbopack's build port,
  including after escalation; this is an environment constraint.
- Docker PostgreSQL: healthy and `SELECT current_database()` returned `talkbridge`.

The installed FastAPI/Starlette test client emits a dependency deprecation warning about
`httpx`; it does not affect the passing application checks.

The pre-commit review added regressions for malformed webhook actions, Git-quoted UTF-8
filenames, deletion-only AST context, fallback windows overlapping changed functions,
and Semgrep targets whose names begin with a dash. All pass.

## Brick 2: implementation ready for live inference validation

Implemented steps 2.1 through 2.4 and the Step 2.5 dataset/evaluation tooling:

- HTTP-only async vLLM client with Pydantic schema validation, timeout/error contracts,
  token/cache usage, request timing, prompt budgets, and modern/legacy constrained JSON modes.
- Byte-identical shared prefixes, independent adaptive A/B/C/D finders, host-assigned IDs,
  and SAST evidence restricted to A.
- Bounded single-candidate adversarial verification, mismatch/error handling that fails closed,
  and an uncertainty cap below the publication threshold.
- Deterministic duplicate clustering, confidence gates, severity labels, retained suppression
  metadata, zero-inference noise-only reviews, and stage/call telemetry.
- GitHub App publishing with head-pinned anchors, one review summary, neutral Check Runs,
  dry-run default, 422 summary fallback, paginated review deduplication, and check repair on retry.
- Application worker wiring controlled by `REVIEW_ENABLED`, with live writes separately controlled
  by `GITHUB_PUBLISH_ENABLED`. The last 100 review results remain in memory.
- A Deep-mode sandbox hook exists behind the flag. No sandbox runner or generated-code execution
  is enabled by default. Persistence, replay UI, and LoRA routing are still later-brick work.
- A reproducible 180-record held-out dataset, 108 vulnerable and 72 clean, plus baseline CLI,
  single-agent ablation, metric formulas, error records and dataset/formula freeze guards.
- An optional pinned vLLM/NVIDIA Compose service for a separate Linux GPU host. No paid services.

Dataset SHA-256: `2f659a8b4d78c51e75493942d0c71e14bb78e15d92b5155645212191801bae85`.
See [evaluation/data/README.md](./evaluation/data/README.md) for source hashes, upstream label and
synthetic-data limitations, proxy-diff methodology and reproducibility. Initial full preflight
exposed mislabeled Code Security snippets. The importer now rejects declared-language parse
errors before selection. All 180 samples in the revised split passed actual Stage 0 scans
(the unchanged 120 PrimeVul records plus a rerun of all 60 revised Code Security records).
No benchmark measurements from those scans are represented as LLM inference results.

### Brick 2 checks

Validated on November 27, 2026:

- Full regression suite: 119 passed, 3 live-inference tests skipped, one existing dependency warning.
- Strict mypy: 32 application/evaluation source files passed.
- Ruff lint and formatting passed across backend, tests and evaluation.
- Backend wheel build passed. Locked dependency verification and eval-group installation passed.
- Frontend type check and ESLint passed locally. Docker production build passed using the
  unchanged frontend's cached validation layer.
- PostgreSQL readiness and optional inference Compose configuration validation passed.
- Sandbox HTTP integration exercised real Stage 0 through Stage 4 with inline publication and
  a neutral Check Run. Inference and GitHub responses were mocked, not live model results.
- Held-out split rebuild matched the committed hash. Metric formulas and freeze protections
  passed known-result regression tests.

### Remaining Brick 2 exit gates

Brick 2 is not complete. The user explicitly approved committing and pushing the implementation
checkpoint after gap review. This checkpoint does not certify the live exit gates. No baseline
result files were fabricated. No Brick 3 work has started.

This environment is Apple ARM. No vLLM endpoint, model credentials, or free GPU access was
provided. `http://localhost:8001/v1/models` has no running server. The optional NVIDIA service
was validated as configuration only, not launched here.

To finish:

1. Provide a reachable dedicated free GPU/vLLM endpoint serving the untouched 8B model.
2. Run the three live tests: parallel schema validity/cache TTFT, safe SQL refutation, unsafe
   SQL confirmation. Cache reset must be explicitly enabled on a dedicated server.
3. Run all 180 samples in both single-agent and multi-agent modes. Freeze genuine
   `baseline_metrics.json` and `baseline_errors.jsonl` and preserve dataset/formula hashes.
4. Review actual results against the gates and rerun required checks after any fixes. Obtain
   approval for the subsequent baseline commit before declaring Brick 2 complete.

Exact commands are in [evaluation/README.md](./evaluation/README.md). Real GitHub App installation
and external publication have not been exercised; sandbox transport coverage satisfies only
that portion of the explicitly allowed sandboxed dry-run gate.

### Pre-commit gap review

- Excess finder candidates and locations outside the reviewed diff now return explicit errors
  instead of silently dropping output and claiming a complete review.
- Partial SAST scans and missing context are disclosed in both the PR summary and neutral check.
- Review deduplication requires the authenticated App's bot identity. Checks are filtered by App
  ID, so a copied marker or another App's identically named check cannot suppress publication.
- App identity uses authenticated metadata and is cached per client. Retry/check repair and
  cross-App ownership have transport regression coverage.
- Evaluation and live tests load the documented backend `.env` independent of working directory.
  Baseline freeze lookup also uses a repository-relative absolute path. Metrics and errors cannot
  use the same output path.
- Fresh checks: 119 tests passed, 3 live tests skipped; strict mypy, Ruff, backend wheel build,
  locked dependencies, frontend type/lint, Docker build, Compose validation and database readiness
  passed. The existing test-client dependency warning remains.
