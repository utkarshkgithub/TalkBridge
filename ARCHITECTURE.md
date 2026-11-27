# TalkBridge Architecture

This document defines the end-to-end technical architecture of **TalkBridge** across all four build bricks and all four review stages. Every schema, prompt boundary, and module contract here corresponds directly to the build steps in [AGENTS.md](./AGENTS.md) and the verification gates in [TESTING.md](./TESTING.md).

---

## 1. Architectural Principles & Hard Invariants

1. **Zero-Token Fast Path (Brick 1 Isolation):** Stage 0 (webhook validation, diff cleaning, Tree-sitter AST slicing, Semgrep SAST) must operate deterministically with zero LLM dependencies.
2. **Stage 1 Context Isolation:** Finder agents (`A`, `B`, `C`, `D`) execute independently against the same PR context prefix. No finder agent may see another finder's reasoning or output.
3. **Adversarial Refutation (Stage 2):** Verifier prompts must ask the model to *disprove* each candidate finding using surrounding code and caller context before assigning confidence (`0–100`).
4. **Prefix-Cache-First Prompt Design:** Static context (`system preamble` + `REVIEW.md` + `cleaned diff` + `AST chunks`) always precedes variable per-agent instructions (`role suffix` + `SAST hints`), maximizing vLLM KV-cache reuse across parallel Stage 1 calls.
5. **Non-Blocking & Viva-Safe Design:**
   - GitHub Check Runs always conclude `neutral` (never `failure` on review findings).
   - Brick 3 stands as a fully working fallback with the Base 8B model + deterministic Replay Mode even if Brick 4 LoRA adapters are disabled (`LORA_ENABLED=false`).

---

## 2. End-to-End System Topology

```text
                        ┌────────────────────────────────────┐
                        │         GitHub Pull Request        │
                        │  (opened / synchronize / reopened) │
                        └──────────────────┬─────────────────┘
                                           │ HTTPS Webhook (X-Hub-Signature-256)
                                           ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Brick 1: Stage 0 — Deterministic Pipeline (Zero LLM Tokens)                  │
│                                                                              │
│  [1.2 Webhook Intake] ─► [1.3 Diff Cleaner] ─► [1.4 Tree-sitter Extractor]   │
│         │                 (drop lockfiles,      (enclosing functions +       │
│         │                  minified, fmt-only)   immediate callers + REVIEW.md)│
│         │                                              │                     │
│         ▼                                              ▼                     │
│  [Redis / Celery Queue] ◄─────────────── [1.5 Semgrep Pre-Scan + Depth Router]
└────────────────────────────────────────────────────────┬─────────────────────┘
                                                         │ ReviewBundle JSON
                                                         ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ Brick 2 & 4: vLLM Multi-Agent Orchestrator                                   │
│  (Base 8B in Brick 2  │  Hot-swapped finder-lora / verifier-lora in Brick 4) │
│                                                                              │
│  ┌─ Shared KV Prefix: [System Base + REVIEW.md + Diff + AST Functions] ───┐  │
│  │                                                                        │  │
│  │  Stage 1: Parallel Isolated Finders (guided_json)                      │  │
│  │   ├── Agent A (Security/OWASP + Semgrep hints)   [Quick/Std/Deep]      │  │
│  │   ├── Agent B (Logic & Edge Cases)               [Std/Deep]            │  │
│  │   ├── Agent C (REVIEW.md Compliance)             [Std/Deep]            │  │
│  │   └── Agent D (Callers & Git History)            [Deep]                │  │
│  └────────────────────────────────────┬───────────────────────────────────┘  │
│                                       ▼                                      │
│  Stage 2: Adversarial Verifier (per finding, guided_json, verifier-lora)     │
│   └─► Tries to REFUTE using AST + callers ─► calibrated confidence (0–100)   │
│                                       │                                      │
│                                       ▼                                      │
│  Stage 3: Dedupe & Rank                                                      │
│   └─► Merge overlapping spans ─► Tag 🔴 Important / 🟡 Nit / 🟣 Pre-existing │
│   └─► Gate: >=80 Post to PR | 50–79 Dashboard only | <50 Discard             │
└───────────────────┬───────────────────────────────────────┬──────────────────┘
                    │                                       │
                    ▼                                       ▼
┌──────────────────────────────────────┐   ┌───────────────────────────────────┐
│ Stage 4: GitHub PR Publisher         │   │ Brick 3: Storage & Dashboard      │
│  • Inline PR diff comments (>=80)    │   │  • SQLite/Postgres telemetry DB   │
│  • 1 high-signal summary comment     │   │  • FastAPI REST + Replay API      │
│  • Neutral Check Run status          │   │  • Next.js Diff Viewer + Slider   │
│  • Optional Docker test check (Deep) │   │  • Latency / Cost / Eval Charts   │
└──────────────────────────────────────┘   └───────────────────────────────────┘
```

---

## 3. Target Repository Layout

```text
TalkBridge/
├── backend/
│   ├── pyproject.toml
│   ├── app/
│   │   ├── main.py                  # FastAPI entrypoint (webhooks + dashboard API)
│   │   ├── config.py                # Pydantic BaseSettings (GitHub, vLLM, LoRA flags, DB)
│   │   ├── schemas.py               # Canonical Pydantic models (ReviewBundle, Finding, etc.)
│   │   ├── webhooks/
│   │   │   └── github.py            # HMAC verification, delivery dedupe, GitHub App auth
│   │   ├── pipeline/
│   │   │   ├── diff_cleaner.py      # Lockfile/minified/formatting filter + line map
│   │   │   ├── ast_extractor.py     # Tree-sitter modified function & caller slicer + REVIEW.md
│   │   │   ├── sast_scanner.py      # Semgrep CLI runner & SastHint normalizer
│   │   │   ├── depth_router.py      # Quick / Standard / Deep rule engine
│   │   │   └── stage0.py            # Deterministic Stage 0 coordinator
│   │   ├── llm/
│   │   │   ├── vllm_client.py       # Async OpenAI-compatible vLLM client + guided_json + LoRA routing
│   │   │   └── prompts.py           # Prefix-cache-aligned prompt builders (Stage 1 & Stage 2)
│   │   ├── agents/
│   │   │   ├── finders.py           # Parallel isolated Stage 1 execution (A, B, C, D)
│   │   │   ├── verifier.py          # Stage 2 adversarial refutation + confidence scoring
│   │   │   ├── dedupe_rank.py       # Stage 3 clustering, severity tagging, threshold split
│   │   │   └── orchestrator.py      # Stages 1–4 async workflow + stage telemetry timers
│   │   ├── github/
│   │   │   └── pr_publisher.py      # Inline diff comments, PR summary, neutral Check Run
│   │   ├── workers/
│   │   │   └── tasks.py             # Celery/Redis background job wrapper
│   │   └── storage/
│   │       ├── db.py                # SQLite (default) / Postgres async persistence
│   │       └── api.py               # /api/reviews, /api/metrics, /api/demo/replay
├── frontend/
│   ├── package.json
│   └── src/
│       ├── app/                     # Next.js App Router pages (overview, PR detail, eval)
│       ├── components/
│       │   ├── RepoHealthCard.tsx   # Repo security trend & FP suppression summary
│       │   ├── PrDiffViewer.tsx     # Side-by-side / unified diff + inline AI annotations
│       │   ├── ConfidenceSlider.tsx # Live 0–100 slider (re-filters findings client-side)
│       │   └── TelemetryCharts.tsx  # Stage latency breakdown, KV cache gain, PR cost
│       └── lib/api.ts
├── ml/
│   ├── mine_errors.py               # Extracts FP / sycophancy / calibration failures from Brick 2
│   ├── build_dataset.py             # Curates CVEfixes + CodeSec + GH-Review + ~40% clean negatives
│   ├── train_finder.py              # Unsloth QLoRA script for finder-lora
│   └── train_verifier.py            # Unsloth QLoRA script for verifier-lora
├── evaluation/
│   ├── prepare_testset.py           # Builds deterministic 150–200 diff held-out split
│   ├── run_eval.py                  # Evaluates Base 8B vs LoRA 8B (F1, CWE, FPR, JSON, latency)
│   ├── plot_ablations.py            # Generates the 4 report charts
│   ├── fixtures/                    # Offline PR replay bundles for Brick 1 & Brick 3 demos
│   └── results/                     # baseline_metrics.json, lora_metrics.json, plots/*.png
├── docker/
│   └── sandbox/                     # Optional isolated Docker runner for Deep-mode unit tests
├── tests/
│   ├── brick1/
│   ├── brick2/
│   ├── brick3/
│   └── brick4/
├── README.md
├── ARCHITECTURE.md
├── AGENTS.md
└── TESTING.md
```

---

## 4. Brick 1 — Deterministic Pipeline (Stage 0)

Brick 1 runs completely offline from any LLM endpoint and outputs a minimal, self-contained `ReviewBundle`.

### 4.1 Webhook Intake & Auth (`webhooks/github.py`)
- Verifies `X-Hub-Signature-256` using constant-time `hmac.compare_digest` against `GITHUB_WEBHOOK_SECRET`.
- Enforces idempotency via `X-GitHub-Delivery` UUID stored in Redis (or in-memory LRU/SQLite fallback in local dev) with TTL so GitHub retries never trigger duplicate reviews.
- Filters strictly for `pull_request` actions `opened`, `synchronize`, and `reopened` (plus optional `workflow_dispatch` / manual API trigger for demos).
- Fetches PR diff, base/head SHAs, changed file contents, recent commit subjects, and `REVIEW.md` / `CLAUDE.md` via GitHub App installation JWT.

### 4.2 Diff Cleaning & Line Mapping (`pipeline/diff_cleaner.py`)
- **Excluded Paths:** `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `poetry.lock`, `Cargo.lock`, `*.min.js`, `*.min.css`, `*.map`, `*.svg`, binary files, vendor/dist directories.
- **Formatting-Only Hunk Filter:** Strips hunks whose added and removed lines are identical after normalizing whitespace (configurable unless `REVIEW.md` explicitly requests style enforcement).
- **Position Indexing:** Preserves exact `(file, head_line_start, head_line_end, github_diff_position)` coordinates so Stage 4 inline comments land on valid PR diff lines without GitHub API `422 Unprocessable Entity` errors.

### 4.3 Tree-sitter AST Function & Caller Extractor (`pipeline/ast_extractor.py`)
- Supports Python, JavaScript/TypeScript, Java, and C/C++ grammars (matching the target web stacks and PrimeVul C/C++ benchmark).
- For every changed line range in a kept diff hunk:
  1. Walks the Tree-sitter CST upward to locate the enclosing function/method/class node.
  2. Extracts the full enclosing function source (capped cleanly by token budget) instead of dumping the whole file.
  3. Searches parsed AST symbol call sites across touched/indexed project files to extract **immediate caller signatures** and **direct callee signatures** for inter-procedural context.
  4. Falls back cleanly to a `±15` line sliding window if a file fails to parse or uses an unsupported extension.

### 4.4 Semgrep Pre-Scan & Adaptive Depth Router (`pipeline/sast_scanner.py`, `depth_router.py`)
- Executes `semgrep --json --config <local-rules>` strictly on the kept changed files in a subprocess timeout guard (`<= 5s`).
- Normalizes matches into `SastHint(file, line_start, line_end, rule_id, cwe_id, message, severity)`.
- **Adaptive Depth Routing:**
  - `quick`: total kept changed LOC `< 50` AND no critical path matched. Runs `[Agent A] + Verifier`.
  - `standard`: kept changed LOC `50–300` AND no critical path matched. Runs `[Agent A, Agent B, Agent C] + Verifier`.
  - `deep`: kept changed LOC `> 300` OR any changed path matches critical globs (`**/auth/**`, `**/db/**`, `**/payments/**`, `**/crypto/**`, `**/admin/**`). Runs `[Agent A, Agent B, Agent C, Agent D] + Verifier` (+ optional Docker test runner).

---

## 5. Brick 2 — Base 8B Multi-Agent Orchestrator & Baseline Eval

### 5.1 vLLM Inference & Automatic KV Prefix Caching (`llm/vllm_client.py`, `llm/prompts.py`)
- Single vLLM engine serving a 4-bit quantized 8B coding model (`Qwen3-8B` / `Qwen3-Coder` or `Llama-3-8B`) with `--enable-prefix-caching`.
- **Canonical Prompt Byte Layout (Prefix Cache Guarantee):**
  ```text
  [SHARED PREFIX — identical byte-for-byte across Agents A, B, C, D]
  1. System Guardrails & Output Contract Reminder
  2. Repo Rules (REVIEW.md / CLAUDE.md, or "Correctness over style default")
  3. Cleaned Diff Hunks + Line Numbers
  4. Tree-sitter Enclosing Functions & Caller Signatures
  --- CACHE BOUNDARY ---
  [VARIABLE SUFFIX — unique per agent]
  5. Agent Role Instruction (A / B / C / D)
  6. (Agent A ONLY) Semgrep Deterministic SastHints
  ```
- Because prefix blocks `1–4` are byte-identical across all parallel Stage 1 requests for the same PR, vLLM computes prefill once and reuses cached KV pages across agents.

### 5.2 Constrained JSON Decoding (`guided_json`)
Every Stage 1 request passes `extra_body={"guided_json": FinderOutput.model_json_schema()}` to vLLM. Every finding matches:

```json
{
  "file": "auth/login.py",
  "line_start": 42,
  "line_end": 48,
  "category": "security",
  "cwe_id": "CWE-89",
  "severity": "important",
  "confidence": 92,
  "reasoning": "User input `username` is interpolated directly into SQL query string.",
  "suggested_patch": "cursor.execute('SELECT * FROM users WHERE username = %s', (username,))",
  "unit_test": "def test_login_sqli_blocked(): ..."
}
```
*(Note: `unit_test` is `str | None = None`; in `Quick`/`Standard` mode it can be omitted/null, and in `Deep` mode or patchable bugs it provides a regression test candidate.)*

Every Stage 2 verification request uses `guided_json=VerifierOutput.model_json_schema()`:
```json
{
  "finding_id": "f-001",
  "verdict": "confirmed",
  "refutation_attempt": "Checked callers and sanitization; no parameterized wrapper or input validator exists before cursor.execute.",
  "calibrated_confidence": 91,
  "severity": "important",
  "pre_existing": false
}
```

### 5.3 Stage Execution & Gating Logic
- **Stage 1 (`agents/finders.py`):** Fires active finder agents concurrently via `asyncio.gather`. Each agent returns `0..N` candidate findings (`FinderOutput`).
- **Stage 2 (`agents/verifier.py`):** Runs concurrently per candidate finding (bounded by `asyncio.Semaphore`). Receives **only** the candidate finding + enclosing function + caller context (never the other agents' candidates). Actively seeks code evidence that disproves the bug (guards, type guarantees, framework auto-escaping, dead branch).
- **Stage 3 (`agents/dedupe_rank.py`):**
  1. Drops `verdict == "refuted"` or `calibrated_confidence < 50`.
  2. Clusters overlapping findings where `same file` AND line ranges overlap (`abs(a.start - b.start) <= 3`) AND same category/CWE, keeping the highest-confidence reasoning + richest patch.
  3. Assigns final display tier:
     - `80–100`: `tier = "post_to_pr"`
     - `50–79`: `tier = "dashboard_only"`
     - `0–49`: `tier = "discarded"` (not posted; counted only in summary telemetry)
  4. Tags severity: `🔴 Important` (`important`), `🟡 Nit` (`nit`), `🟣 Pre-existing` (`pre_existing=true`).
- **Stage 4 (`github/pr_publisher.py`):**
  - Posts `post_to_pr` findings as inline GitHub PR review comments anchored to valid diff positions.
  - Posts **1** summary comment containing counts across tiers, depth mode used (`Quick`/`Standard`/`Deep`), and link to the TalkBridge Dashboard PR view.
  - Updates GitHub Check Run with `status="completed"`, `conclusion="neutral"`.

### 5.4 Baseline Evaluation Architecture (`evaluation/run_eval.py`)
- Evaluates a frozen held-out test set of **150–200 diffs** built deterministically in `evaluation/prepare_testset.py` from:
  - Chronological held-out split of **PrimeVul-Paired** (vulnerable before-patch + benign after-patch pairs)
  - Held-out slice of **CVEfixes** / **Code Security Vulnerability Dataset** (Python/JS/TS/Java) + clean functions (`~40%` clean negatives)
- Saves `evaluation/results/baseline_metrics.json` (Precision, Recall, F1, False Positive Rate, CWE accuracy, JSON validity %, P50/P95 latency, threshold curve at `40/60/80/90`) and `evaluation/results/baseline_errors.jsonl` for Brick 4 error mining.

---

## 6. Brick 3 — Frontend Dashboard, Persistence & Viva-Safe Demo Flow

### 6.1 Persistence Schema (`storage/db.py` — SQLite default / Postgres optional)
- `reviews`: `id`, `repo`, `pr_number`, `commit_sha`, `depth_mode`, `model_profile` (`base_8b` | `lora_8b`), `status`, `created_at`, `stage0_ms`, `stage1_ms`, `stage2_ms`, `stage3_ms`, `stage4_ms`, `kv_cache_hit_ratio`, `estimated_cost_usd`.
- `diff_hunks`: `id`, `review_id`, `file_path`, `cleaned_diff`, `ast_context`, `sast_hints_json`.
- `findings`: `id`, `review_id`, `source_agent`, `file_path`, `line_start`, `line_end`, `category`, `cwe_id`, `severity`, `pre_existing`, `raw_confidence`, `calibrated_confidence`, `verdict`, `refutation_attempt`, `reasoning`, `suggested_patch`, `unit_test`, `posted_to_pr`.
- `eval_runs`: `id`, `run_tag`, `dataset_size`, `metrics_json`, `created_at`.

### 6.2 Dashboard APIs (`storage/api.py`)
- `GET /api/reviews` — paginated PR reviews + repo security trend aggregations.
- `GET /api/reviews/{review_id}` — full PR metadata, cleaned diffs, and **all** findings with `calibrated_confidence >= 0` (flagged with `posted_to_pr` status) so the UI slider can filter dynamically at zero inference cost.
- `GET /api/telemetry/summary` — latency breakdowns, KV cache speedup, estimated cost vs. frontier API baseline, threshold sensitivity data.
- `POST /api/demo/replay/{fixture_id}` — runs or replays deterministic PR review bundles for live viva demos without requiring external GitHub webhooks or GPU uptime if offline mode is selected.

### 6.3 Frontend Capabilities (`frontend/`)
1. **Repo Security Health Overview:** Security score trend over PRs, severity mix (`Important` / `Nit` / `Pre-existing`), and false-positive suppression ratio (Stage 1 candidates vs. Stage 2 verified).
2. **Interactive PR Diff Viewer + Live Confidence Threshold Slider (`0–100`):**
   - Renders cleaned PR diff with inline expandable AI review cards (`reasoning`, `cwe_id`, `suggested_patch`, `refutation_attempt`).
   - Slider defaulted to `80`: dragging from `80` down to `50` immediately reveals findings that were logged (`50–79`) but suppressed from GitHub PR noise; dragging to `90` demonstrates precision vs. recall tightening live.
3. **Latency & Cost Telemetry Charts:** Stage-by-stage timing stacked bars (`Stage 0..4`), prefix-caching speedup, and cost-per-PR vs. frontier API benchmark (`$15–$25/PR`).

---

## 7. Brick 4 — QLoRA Fine-Tuning & Multi-LoRA Serving

### 7.1 Targeted Error Inspection (`ml/mine_errors.py`)
Reads `evaluation/results/baseline_errors.jsonl` from Brick 2 and categorizes mistakes into:
1. **Over-flagged safe functions:** Stage 1 false alarms on patched or sanitized code -> drives `finder-lora` negative examples (`~40%` clean).
2. **Sycophantic Stage 2 approvals:** Stage 2 agreeing with weak Stage 1 guesses -> drives `verifier-lora` hard-negative refutation pairs from PrimeVul-Paired.
3. **Bad confidence calibration:** High confidence (`>=80`) on wrong findings or low confidence (`<80`) on true CVEs -> drives calibrated score targets.

### 7.2 Dual-Adapter QLoRA Training (`ml/train_finder.py`, `ml/train_verifier.py`)
- Base model: same 4-bit quantized 8B coding model used in Brick 2.
- Library: **Unsloth** QLoRA (targeting attention + MLP projections, lightweight `~50 MB` adapters).
- Dataset (`1,500–2,500` curated examples, zero leakage against the Brick 2 `150–200` held-out test IDs/commits):
  - **`finder-lora`:** Trained on `CVEfixes` + `Code Security Vulnerability Dataset` + `GitHub Code Review` + `~40%` clean/no-bug diffs emitting exact `FinderOutput` JSON (including empty finding arrays `[]` on clean code).
  - **`verifier-lora`:** Trained on `(candidate finding + context) -> VerifierOutput` using paired vulnerable/patched functions from `PrimeVul-Paired` and mined Brick 2 errors to output concrete `refutation_attempt` reasoning and well-calibrated `calibrated_confidence`.

### 7.3 Multi-LoRA Hot-Swap in vLLM (`llm/vllm_client.py`)
vLLM starts with:
```text
--enable-prefix-caching --enable-lora --lora-modules finder-lora=/weights/finder-lora verifier-lora=/weights/verifier-lora
```
- When `LORA_ENABLED=true`: Stage 1 sets `model="finder-lora"` and Stage 2 sets `model="verifier-lora"`.
- When `LORA_ENABLED=false`: Both stages transparently route to the base 8B model (instant Brick 3 fallback).
- Running the exact `evaluation/run_eval.py` script produces `evaluation/results/lora_metrics.json`, and `evaluation/plot_ablations.py` renders the 4 final report charts.
