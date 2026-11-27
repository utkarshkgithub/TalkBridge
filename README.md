# TalkBridge

**Distilled AI Code Security Reviewer & Unit Test Bot (QLoRA Fine-Tuned 8B LLM + GitHub App)**

TalkBridge is a developer platform that plugs straight into GitHub Pull Requests, strips noisy diffs down to minimal AST/SAST context, scans them via an isolated multi-agent 8B LLM pipeline, and opens concise inline PR review comments with verified patches and optional unit tests — powered by a compact QLoRA fine-tuned model instead of expensive frontier APIs.

- **ML / GenAI Core:** Knowledge distillation + QLoRA fine-tuning of a compact 8B coding model (`Qwen3-8B` / `Qwen3-Coder` or `Llama-3-8B`) via Unsloth, served with vLLM automatic KV prefix caching, constrained JSON (`guided_json`), and multi-LoRA hot-swapping (`finder-lora` + `verifier-lora`).
- **Full-Stack App:** GitHub App Webhook integration, FastAPI + bounded asyncio workers, deterministic Tree-sitter + Semgrep Stage 0 pipeline, Docker PostgreSQL telemetry store, and a Next.js/React PR diff-viewer dashboard with a live confidence threshold slider (`0–100`).

---


## Current implementation: Brick 3 checkpoint

Brick 1 implements signed GitHub webhook intake, bounded asyncio workers, diff cleaning,
Tree-sitter context extraction, local Semgrep hints, and adaptive review depth. Brick 2 adds
the async vLLM client, isolated finders, adversarial verification, ranking and GitHub publication.
Its offline flow and held-out dataset are implemented; live 8B baseline gates remain pending.
Brick 3 now adds PostgreSQL persistence, replay APIs and a shadcn dashboard inspired by Linear.
The user authorized this work while Brick 2 live validation remains deferred. Brick 4 is planned.

This college-project profile uses free local tools, a backend virtual environment, and Docker
PostgreSQL. It requires no paid API, Redis, or Celery. PostgreSQL is provisioned now; review
persistence is available with `STORAGE_ENABLED=true`. Read [BUILD_STATUS.md](./BUILD_STATUS.md) for limits and gates.

### Run locally

Requirements: Python 3.13+, uv, Node.js 20.9+, npm, and Docker Compose.

```bash
# Repository root. PostgreSQL stays local to this machine.
docker compose up -d --wait db

cd backend
uv sync --locked
cp ../.env.example .env
# Set GITHUB_WEBHOOK_SECRET and GitHub App credentials in .env for live webhooks.
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Use exactly one Uvicorn process. Its bounded worker queue and delivery cache are in memory.
Restarting the backend clears pending jobs, delivery IDs, and in-memory results.
Completed reviews remain in PostgreSQL when storage is enabled.
Do not use this development worker for deployments that require durable jobs.

The GitHub App needs repository Contents and Pull requests read access for Brick 1.
Subscribe to pull request events and point GitHub at a publicly reachable HTTPS URL ending in
`/webhooks/github`. GitHub cannot reach `localhost` directly. Later publishing permissions belong
to Brick 2. `GET /health` checks the API process, not GitHub or database connectivity.

Run an offline fixture without GitHub credentials or an LLM:

```bash
cd backend
uv run python -m app.pipeline ../evaluation/fixtures/auth_sqli_pr.json
```

The command prints a validated `ReviewBundle`. It exits nonzero if Semgrep cannot complete.
Each scan uses local rules, disables metrics/version checks, and has a five-second wall-clock cap.
A scan error remains visible in `sast_status` and `warnings`; it is never reported as a clean scan.
Current local rules cover Python eval, SQL f-strings, hardcoded API keys, and JS/TS eval.
SAST hints are review context, not verified vulnerabilities.

By default, whitespace-only edits are excluded while preserving Python indentation, literal contents,
and token boundaries. To review style changes, set `ENFORCE_STYLE_DIFF=true` or include
`<!-- talkbridge: enforce-style -->` in `REVIEW.md` (or fallback `CLAUDE.md`).

### Enable Brick 2 reviews

Set `REVIEW_ENABLED=true` in the backend environment to run Stages 0 through 4. Configure
`VLLM_BASE_URL`, `VLLM_MODEL`, and optionally `VLLM_API_KEY` for an existing inference server.
`VLLM_SCHEMA_MODE=structured_outputs` supports current vLLM; `guided_json` supports older servers.
The default, free model is Qwen3-8B-AWQ without project LoRA fine-tuning.
See [evaluation/README.md](./evaluation/README.md) for the optional NVIDIA Docker service,
live cache tests, held-out data provenance, and baseline commands.

Publication defaults to a dry run. To publish live reviews, set `GITHUB_PUBLISH_ENABLED=true`
and grant the GitHub App Contents read, Pull requests write, and Checks write permissions.
Reinstall or approve the App permission update on the target repository. Reviews post findings
at confidence 80 or above, one review summary, and a completed neutral check. Invalid inline
anchors fall back to the summary. Lower scores remain in memory and persist in PostgreSQL when storage is enabled. Inference failures, incomplete SAST scans, missing context, and candidate-budget errors are
visible as partial reviews. `GET /health` remains process health only.

The worker queue and in-memory cache remain ephemeral; completed reviews can persist in PostgreSQL.
GitHub publication checks the current head, serializes
writes within this process, and deduplicates its own bot reviews by head SHA. A retry can repair
a missing neutral check; checks are scoped to the authenticated App. Multiple API instances and automatic durable retries are not supported.
`SANDBOX_TEST_ENABLED` exposes a Deep-mode hook for an explicitly provided isolated runner;
no generated test code executes by default. Replay is available in Brick 3. LoRA routing remains Brick 4 work.

### Brick 3 dashboard and offline demo

The default `.env.example` enables PostgreSQL storage and illustrative replay mode. Start the
backend using the local commands above, then start the frontend in a second terminal:

```bash
cd frontend
npm ci
cp .env.example .env.local
npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open `http://127.0.0.1:3000` for the landing page, then sign in to reach the dashboard.
Local test credentials and provider setup are documented in [frontend/README.md](frontend/README.md).
The dashboard has Overview, All reviews, Insights, Pipeline, and Connections pages,
search/filter controls, severity and latency charts, and a paginated review list. A review
shows unified source diffs, line-anchored findings, verifier reasoning, patch copying and a
keyboard-accessible confidence slider. Changing the slider is entirely local and never
republishes findings. Suppressed/refuted metadata remains inspectable separately.

`DEMO_REPLAY_MODE=true` seeds three PostgreSQL demo reviews. Replay loads packaged records
without GitHub, vLLM, Semgrep subprocesses or internet access. Demo findings, latency and cache
counts are explicitly illustrative, and replay never posts to GitHub. Actual posted state is
separate from threshold eligibility. PostgreSQL must be running locally for persistence.

The frontend uses a same-origin `/api/backend/*` proxy with an allowlist. Its server-only
`BACKEND_URL` defaults to `http://127.0.0.1:8000`; no model or GitHub credentials enter the browser.
The frontend requires a server session before proxying dashboard requests. Production backend
APIs also require a shared `DASHBOARD_API_KEY`; set backend `APP_ENV=prod` to enforce it.
Keep the backend private and use the documented loopback bindings for local development.
This remains a single shared workspace, with account-specific OAuth connections.

To run the sample scenarios through actual inference, set `REVIEW_ENABLED=true` and
`DEMO_REPLAY_MODE=false` with a working vLLM endpoint, then use **Run live**. This review path
persists Base 8B results but never publishes the synthetic sample to GitHub. Webhook reviews
use the existing publisher when explicitly enabled. The request path admits one live sample
review at a time. `LIVE_REVIEW_TIMEOUT_SECONDS` defaults to 150 seconds and cannot exceed
150, so the backend returns an explicit timeout before the frontend proxy expires. A timed-out
request releases its slot and does not persist an incomplete result. LoRA adapters remain Brick 4 work.

API endpoints:

- `GET /api/reviews?limit=50&offset=0` and `GET /api/reviews/{id}`
- `GET /api/telemetry/summary`
- `POST /api/demo/replay/{auth_sqli_pr|logic_edge_pr|clean_small_pr}`
- `POST /api/reviews/run/{auth_sqli_pr|logic_edge_pr|clean_small_pr}`

Data is stored transactionally in `reviews`, `diff_hunks` and `findings`, including all confidence
tiers and publication state. Storage initialization creates missing tables; this project does
not introduce a general migration framework or a durable task queue.

Frontend components come from [shadcn/ui](https://ui.shadcn.com/) with Base UI primitives.
The dark workspace takes layout and visual inspiration from [Linear](https://linear.app/).
Fonts use the system stack, with no runtime font download. Health scores are labeled heuristics.
Costs exclude infrastructure, and no unmeasured frontier API comparison or cache speedup is shown.

### Checks before each phase commit

```bash
# Repository root, after uv sync in backend.
backend/.venv/bin/pytest -v
backend/.venv/bin/mypy --config-file backend/pyproject.toml backend/app evaluation
backend/.venv/bin/ruff check --config backend/pyproject.toml backend/app backend/tests tests evaluation
backend/.venv/bin/ruff format --check --config backend/pyproject.toml backend/app backend/tests tests evaluation
cd backend
uv run python -m build --wheel --no-isolation
cd ../frontend
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

If the host restricts Turbopack's local build port, run all frontend checks in Docker:

```bash
# Repository root.
docker build -f frontend/Dockerfile.check -t talkbridge-frontend-check frontend
```

The backend wheel includes the local Semgrep rules. Build it from this repository checkout.
Docker database check: `docker compose exec -T db pg_isready -U postgres -d talkbridge`.
Stop services with `docker compose stop`; named database volume remains intact.

## Documentation Map

This repository is organized for a **Brick-by-Brick** build where every brick and every small step has explicit specifications and pass/fail test gates:

| Document | Purpose |
| :--- | :--- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Complete system design: Stage 0–4 data flow, Tree-sitter + Semgrep deterministic pipeline, KV-cached prompt contracts, Pydantic JSON schemas, vLLM multi-LoRA serving, DB/API schema, and dashboard architecture. |
| [AGENTS.md](./AGENTS.md) | Step-by-step build playbook for coding agents (`Step 1.1` → `Step 4.4`), architectural non-negotiables, and behavioral specs for the runtime review agents (Finders A–D, Adversarial Verifier, Dedupe/Ranker). |
| [TESTING.md](./TESTING.md) | Concrete tests, fixtures, commands, and exit gates for **every small step** and **every brick** — including the 150–200 diff held-out eval protocol and viva-safe fallback check. |

---

## Brick-by-Brick Build Order

We build and verify each layer sequentially. Do not advance to the next brick until the current brick's exit gate in [TESTING.md](./TESTING.md) passes.

| Brick | Goal | Key Steps | Exit Milestone |
| :--- | :--- | :--- | :--- |
| **Brick 1 — Deterministic Pipeline (No LLM Yet)** | Zero-token fast path that turns raw GitHub webhooks into clean, minimal AST + SAST chunks. | `1.1` Schemas/config → `1.2` Webhook HMAC intake → `1.3` Diff cleaner → `1.4` Tree-sitter function/caller extractor + `REVIEW.md` → `1.5` Semgrep pre-scan & depth router | Clean minimal `ReviewBundle` JSON for any PR in `<2s` with `0` LLM calls. |
| **Brick 2 — Base 8B Multi-Agent Orchestrator + Baseline Eval** | Wire untouched 8B model on vLLM through Stages 1–4 and establish immutable baseline metrics. | `2.1` vLLM + prefix cache + `guided_json` → `2.2` Stage 1 parallel isolated Finders (A–D) → `2.3` Stage 2 Adversarial Verifier → `2.4` Stage 3 Dedupe/Rank + Stage 4 PR comments → `2.5` Held-out eval (150–200 diffs) | End-to-end PR review bot working + frozen `baseline_metrics.json` & error logs. |
| **Brick 3 — Frontend Dashboard & Demo Flow** | Interactive UI, telemetry, and offline/live replay capability. | `3.1` Persistence + REST/replay API → `3.2` Dashboard shell & repo score → `3.3` Diff viewer + live confidence slider (`0–100`) → `3.4` Latency/cost charts + demo mode | **Viva-safe working fallback**: complete working app & live demo even without Brick 4. |
| **Brick 4 — QLoRA Fine-Tuning (The Upgrade Layer)** | Train `finder-lora` & `verifier-lora` from Brick 2 mistakes, hot-swap into vLLM, and prove gain. | `4.1` Error mining + balanced dataset (~40% clean) → `4.2` Unsloth QLoRA training → `4.3` vLLM multi-LoRA hot-swap → `4.4` Re-run exact Brick 2 eval + 4 ablation charts | Quantified F1/precision/calibration gain on identical held-out diffs + 4 report plots. |

---

## 1. Public Datasets (Training & Held-Out Evaluation)

Do not rely on a single noisy vulnerability CSV. Combine paired security-fix datasets with real GitHub PR review datasets so the model learns both what real vulnerabilities look like and how concise inline PR comments read.

| Dataset | Repo / Source (Hugging Face) | What's Inside | Role in TalkBridge |
| :--- | :--- | :--- | :--- |
| **CVEfixes** | `hitoshura25/cvefixes` / `rufimelo/cvefixes-cwe` | ~12,987 real vulnerability-fix records across 11,726 CVEs, mapped to CWEs with commit diffs across multiple languages | Primary training data for `vulnerable diff → CWE + fix` pairs |
| **Code Security Vulnerability Dataset** | `ayshajavd/code-security-vulnerability-dataset` | Covers 16 languages with `code`, `code_fixed`, `cwe_id`, `owasp` category, and `is_vulnerable` flags | Multi-language OWASP training (Python, JS/TS, Java web apps) |
| **PrimeVul (Paired)** | `starsofchance/PrimeVul` & `Code-TREAT/PrimeVul-Paired_original_lite` | ~7k vulnerable + ~229k benign C/C++ functions across 140+ CWEs with chronological splits and paired before/after patches | Gold-standard held-out evaluation benchmark (chronological splits prevent data leakage) |
| **GitHub Code Review** | `ronantakizawa/github-codereview` & `muellerzr/github-pr-history` | Real GitHub PR diffs paired with high-signal human inline comments and code suggestions | Fine-tuning PR tone, line localization, and logic-bug reviews |

> **Dataset Balance Rule:** Keep **~40%** of the training set as clean / no-bug diffs (taken from patched `code_fixed` versions or benign functions). Training only on vulnerable snippets causes an 8B model to hallucinate a bug on every PR.

---

## 2. 4-Stage Isolated Multi-Agent Architecture

Instead of feeding a raw git diff into a single prompt (which causes high noise), TalkBridge adopts a strict 4-stage isolated multi-agent pipeline:

```text
GitHub PR Webhook
       │
       ▼
[Stage 0: Deterministic Pre-Filter & Context] ──► Diff cleaner + Tree-sitter AST callers + Semgrep + REVIEW.md
       │
       ▼
[Stage 1: Parallel Isolated Finders]          ──► Specialist agents run independently (no shared output):
   ├── Agent A: Security & OWASP                  (injection, auth bypass, secrets, SSRF + Semgrep hints)
   ├── Agent B: Logic & Edge Cases                (null refs, race conditions, off-by-one, regressions)
   ├── Agent C: Repo Rules Compliance             (checks project's REVIEW.md / CLAUDE.md guidelines)
   └── Agent D: Git History / Callers             (checks touched callers & recent commits for regressions)
       │
       ▼
[Stage 2: Adversarial Verifier]               ──► Skeptical agent tries to DISPROVE each finding against
       │                                          surrounding code; scores confidence 0–100
       │                                          (Hard gate: >=80 PR post | 50–79 dashboard | <50 drop)
       ▼
[Stage 3: Deduplicate & Rank]                 ──► Merges overlapping issues; tags severity:
       │                                          🔴 Important | 🟡 Nit | 🟣 Pre-existing
       ▼
[Stage 4: Post to GitHub PR]                  ──► Inline diff comments + 1 high-signal summary
                                                  + neutral GitHub Check Run (never auto-blocks merge)
```

### The 5 Architectural Rules

1. **Context Isolation in Stage 1:** Parallel finder agents must never see each other's outputs during scanning, preventing confirmation bias.
2. **Adversarial Verification:** Instead of asking *"Is this a bug?"*, Stage 2 actively attempts to **refute** each finding by citing surrounding code — pushing false positives below 1%.
3. **Confidence Threshold Gating (`>= 80`):** Score every verified finding `0–100`. Post `80–100` to the GitHub PR, log `50–79` in the dashboard only, and silently discard `0–49`.
4. **Correctness Over Style by Default:** Ignore formatting, naming nits, and missing docstrings unless explicitly requested in the repo's `REVIEW.md` (injected at highest priority).
5. **Non-Blocking Check Runs:** Post findings as inline comments with a `neutral` GitHub Check Run status so the bot assists engineers without blocking merges on false alarms.

---

## 3. Systems & ML Optimizations

1. **Deterministic Pre-Filter (Zero-Token Fast Path):**
   - Strip lockfiles (`package-lock.json`, `poetry.lock`), minified bundles, binaries, and formatting-only hunks.
   - Use **Tree-sitter** to extract only modified functions plus their immediate caller signatures rather than dumping entire files.
   - Run lightweight **Semgrep** rules for deterministic syntax patterns (hardcoded API keys, `eval()`, raw SQL string interpolation) and feed hints to Agent A.
2. **Automatic KV Prefix Caching:**
   - Place static PR context, `REVIEW.md`, and cleaned diff chunks at the **start** of the prompt and each agent's role instruction at the **end**.
   - Serve with vLLM `--enable-prefix-caching` so prompt prefill runs once and KV tensors are reused across parallel Stage 1 agents (`50–70%` review latency reduction).
3. **Single Base Model + Multi-LoRA Serving:**
   - Serve one 4-bit quantized 8B base model in vLLM and hot-swap tiny (`~50 MB`) task-specific adapters per stage:
     - `finder-lora`: fine-tuned on CVEfixes + Code Security + GitHub Code Review to locate bugs & CWEs.
     - `verifier-lora`: fine-tuned on paired vulnerable vs. patched/benign examples to separate true positives from false alarms.
4. **Constrained JSON Decoding (`guided_json`):**
   - Enforce Pydantic JSON schemas inside vLLM at inference time so every finding strictly conforms without regex hacks or retry loops:
     ```json
     {
       "file": "auth/login.py",
       "line_start": 42,
       "line_end": 48,
       "category": "security",
       "cwe_id": "CWE-89",
       "severity": "important",
       "confidence": 92,
       "reasoning": "...",
       "suggested_patch": "..."
     }
     ```
5. **Adaptive Depth Routing (`Quick` / `Standard` / `Deep`):**
   - **Quick** (`< 50 LOC`, non-critical paths): 1 Finder Agent + Verifier.
   - **Standard** (`50–300 LOC`): 3 Parallel Agents (Security, Logic, Repo Rules) + Verifier.
   - **Deep** (`> 300 LOC` or touches `auth/`, `db/`, `payments/`): All 4 Parallel Agents + Verifier + optional sandboxed unit-test check.

---

## 4. Team Split & Evaluation Charts

- **ML / Model Pipeline (1–2 people):** Curate `1,500–2,500` balanced examples (`~40%` clean negatives), train `finder-lora` & `verifier-lora` with Unsloth, serve via vLLM with prefix caching and `guided_json`, run held-out benchmarks.
- **Backend / Orchestrator (1 person):** FastAPI + bounded asyncio worker for GitHub Webhooks, diff cleaning, Tree-sitter + Semgrep Stage 0, parallel async Stages 1–4, GitHub PR Review API, and telemetry DB.
- **Frontend Dashboard (1 person):** Next.js/React dashboard with repo security trends, interactive PR diff viewer with inline comments, live confidence threshold slider (`0–100`), and latency/cost telemetry charts.

### The 4 Ablation Charts for Evaluation

1. **Single-Agent vs. Multi-Agent + Verifier:** Precision jump and false-positive rate drop when adding Stage 2 adversarial verification.
2. **Base 8B vs. Fine-Tuned 8B vs. Frontier Teacher:** Bug-detection F1, CWE classification accuracy, and JSON schema validity on the held-out `150–200` diff split.
3. **Confidence Threshold Curve (`40 → 60 → 80 → 90`):** Precision vs. Recall curve empirically justifying `80` as the PR-posting threshold.
4. **Latency & Cost Benchmark:** Prefix-cached 8B pipeline (seconds, fractions of a cent per PR) vs. frontier API pricing (`$15–$25/PR` for deep multi-agent reviews).

### Browser and PostgreSQL checks

The full backend suite includes real PostgreSQL integration tests. Tests create unique isolated
schemas and remove them afterward. Override `TEST_DATABASE_URL` to use a separate test server.
Start the local API and frontend in replay mode before browser tests:

```bash
cd frontend
npm run test:e2e
```

Playwright defaults to the installed Chrome channel. On another machine, install a supported
browser and set `PLAYWRIGHT_CHANNEL` accordingly. Browser tests cover desktop and mobile,
block external requests, and assert zero API calls while changing confidence. Test screenshots
and traces are ignored under `frontend/test-results/`.

Live GPU-dependent gates remain pending. Passing offline replay does not certify the real
model baseline or live vLLM cache performance. See `BUILD_STATUS.md` for the exact checkpoint.
