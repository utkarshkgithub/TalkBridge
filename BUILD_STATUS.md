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

## Next gates

Brick 2 follows the verified Brick 1 checkpoint. Its live baseline requires a compatible
8B inference server and genuine held-out dataset records. Synthetic fixtures must not be
presented as live model results. The 150 to 200 diff baseline must pass before Brick 3 starts.

Brick 3 adds PostgreSQL persistence, review APIs, the Next.js dashboard, and offline replay.
Brick 4 adds training only after the real baseline is frozen. GPU training, adapter artifacts,
and measured improvements must not be claimed without running them.
