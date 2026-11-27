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
result files were fabricated. Brick 3 was subsequently requested; see its checkpoint below.

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

## Brick 3: dashboard, persistence and offline replay checkpoint

The user explicitly requested Brick 3, shadcn components and Linear inspiration after being told
that Brick 2's live GPU gates were still pending. This authorizes the current build-order
exception. The held-out split, metric formulas and missing real baseline remain unchanged.
No Brick 4 training or adapter routing is implemented.

Implemented:

- A small async psycopg connection pool for Docker PostgreSQL. Canonical review results and
  normalized diff/finding child records are saved together in one transaction. All confidence
  tiers, refutation notes, telemetry and publication state survive application restarts.
- A worker completion hook stores actual review results. The bounded asyncio job queue and
  webhook delivery cache remain ephemeral, with no Celery, Redis or durable retry mechanism.
- Paginated review and detail APIs, telemetry summary, and three packaged illustrative replay
  records. Replay requires local PostgreSQL but no network, GitHub credentials, model server,
  scanner subprocess, or GPU. The SQL example includes confidence scores 92, 65 and 35.
- Explicit live sample execution, bounded to one request, uses actual inference and persists
  Base 8B results. It is disabled in replay mode and never publishes sample PRs to GitHub.
- The Next.js frontend uses real shadcn-generated Base UI components, a dark Linear-inspired
  workspace, responsive navigation, review search/filter/pagination, health heuristics,
  severity distribution, stage timing, cache and cost panels.
- Review detail contains unified diffs with line-anchored finding cards, verifier refutation,
  suggested patches, copy controls, file navigation, suppressed metadata, and a keyboard slider.
  The confidence threshold changes entirely in the browser with no API or inference calls.
- A same-origin, allowlisted Next.js backend proxy keeps server configuration out of browser
  credentials. Fonts use the system stack without runtime internet access.
- Replay labels distinguish illustrative findings/telemetry from actual inference. Eligibility
  for a PR comment is separate from actual posted state. Missing cache counters display as
  unavailable rather than a fabricated zero-percent measured hit rate.

### Brick 3 verification

- Backend regression suite: 124 passed, 3 live-inference tests skipped, existing test-client
  dependency deprecation warning remains.
- Real PostgreSQL integration covers normalized artifacts, repeated replay without duplication,
  process restart persistence, worker persistence, disabled storage, invalid IDs/pagination,
  offline transport isolation and replay completion under 500 ms.
- Mocked live sample API coverage proves the live endpoint calls inference rather than returning
  a replay record. This is transport coverage, not actual Base 8B validation.
- Strict mypy passes across 36 backend/evaluation files. Ruff lint and format checks pass.
- Locked backend install and wheel build pass; all three replay JSON files are packaged.
- Eight frontend unit tests pass, covering loading, errors/retry, health calculations, review pagination and
  exact local confidence filtering. Both desktop and mobile Playwright tests pass, covering offline replay,
  keyboard thresholds, patch display, responsive navigation, no horizontal page overflow,
  zero slider API calls and no client runtime errors.
- TypeScript and ESLint pass. Next.js production build passes in Docker. A clean npm lockfile
  installation is verified with the local Sites workflow helper.
- Native browser inspection verified the dashboard styling. Playwright screenshots also verified
  desktop/mobile review layout. Browser artifacts are ignored in `frontend/test-results/`.

### Remaining gates and deliberate limits

The offline dashboard/replay path is ready for review. Brick 3's full exit gate requires live
vLLM validation as well as offline replay; that live half is still pending together with Brick
2's true baseline. No frozen baseline or live cache speedup is claimed. Cost panels show local
API estimates excluding infrastructure; a frontier API comparison has not been configured.

The dashboard is a local college-project surface without account authentication. Schema setup
creates the initial PostgreSQL tables rather than introducing a migration framework. Telemetry
aggregation reads stored reviews directly and is intended for this small deployment. Health
scores are explicit heuristics, not vulnerability-detection accuracy measurements.

The user explicitly approved committing and pushing this Brick 3 checkpoint after gap review.
This approval does not certify the pending live GPU exit gates.
Run instructions and exact frontend/backend checks are in README.md.

### Brick 3 pre-commit gap review

- Live sample reviews have a bounded whole-request deadline below the frontend proxy timeout.
  Timeout coverage verifies HTTP 504, no incomplete database record and a released review slot.
- Publishable findings are labeled as ready for review rather than automatically called important.
  Nits and pre-existing findings retain their actual severity in detail views.
- Incomplete inference/context processing marks a review partial, keeps it out of the clean filter,
  and excludes it from health scores and health trends. Publication warnings are visible in detail.
- Frontend API errors normalize non-text validation details to a readable message.
- Final validation includes 124 backend tests, eight frontend unit tests, desktop/mobile replay,
  strict mypy, Ruff/Prettier, TypeScript, ESLint, backend wheel and Next.js Docker production build.
  Three live inference tests remain skipped. The held-out split and evaluator are unchanged.
