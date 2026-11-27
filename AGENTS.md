# AGENTS.md — Build Playbook & Runtime Agent Specifications

This file governs **both**:
1. **Part A (Coding Agent Playbook):** How coding agents build TalkBridge **brick by brick** and **step by step** without breaking architectural invariants or jumping ahead of verified tests.
2. **Part B (Runtime Review Agent Contracts):** Exact boundaries, inputs, and prompt behaviors for TalkBridge's Stage 1–3 LLM agents.

---

## Part A: Coding Agent Rules & Brick-by-Brick Playbook

### Golden Rules for Coding Agents

1. **Strict Brick Gating:** Never implement Brick `N+1` before every step test and the Brick `N` exit gate in [TESTING.md](./TESTING.md) pass.
2. **No LLMs in Brick 1:** Brick 1 must be 100% deterministic (`FastAPI`, `diff`, `tree-sitter`, `semgrep`). Do not import `openai`, `vllm`, or LLM clients inside `backend/app/pipeline/`.
3. **Schema Stability:** All inter-stage communication uses canonical Pydantic models in `backend/app/schemas.py`. Never pass unstructured strings between Stage 0, Stage 1, Stage 2, and Stage 3.
4. **Prefix-Cache Byte Order:** Always assemble Stage 1 prompts as `[SHARED_PREFIX][AGENT_SUFFIX]`. Never inject agent-specific instructions or Semgrep hints above the shared prefix boundary.
5. **Stage 1 Isolation:** Agents `A`, `B`, `C`, and `D` must never receive outputs from one another, and Agents `B`, `C`, `D` must **not** receive Semgrep hints (Semgrep hints go to Agent A only so Agents B–D avoid deterministic anchoring bias).
6. **Freeze Brick 2 Evaluation Before Brick 4:** Once `evaluation/results/baseline_metrics.json` is generated in Step 2.5, never alter the held-out test split (`150–200` diffs) or evaluation metric formulas before Brick 4 completes.
7. **Keep Viva-Safe Fallback Intact:** `LORA_ENABLED=false` and `DEMO_REPLAY_MODE=true` must always work cleanly from Brick 3 onward.

---

### Brick 1 — Deterministic Pipeline (No LLM Yet)

> **Brick Goal:** Accept GitHub PR webhooks, strip noise, extract enclosing functions + immediate callers with Tree-sitter, run Semgrep SAST hints, and output a minimal `ReviewBundle`.

#### Step 1.1 — Project Bootstrap, Config & Core Schemas
- **Objective:** Initialize `backend/` Python project, environment settings, and shared Pydantic contracts.
- **Files:** `backend/pyproject.toml`, `backend/app/config.py`, `backend/app/schemas.py`
- **Key Contracts:** Define `PRContext`, `CleanedHunk`, `AstChunk`, `SastHint`, `DepthMode` (`quick` | `standard` | `deep`), `ReviewBundle`, `FinderCandidate`, `FinderOutput`, `VerifierOutput`, `RankedFinding`, and `ReviewTelemetry`. Enforce `confidence: int` bounds (`0..100`).
- **Done When:** `Test 1.1` in [TESTING.md](./TESTING.md) passes.

#### Step 1.2 — GitHub Webhook Intake & Signature Verification
- **Objective:** Securely receive PR events, verify HMAC signatures, deduplicate deliveries, and enqueue work.
- **Files:** `backend/app/main.py`, `backend/app/webhooks/github.py`, `backend/app/workers/tasks.py`
- **Key Constraints:** Constant-time HMAC check on raw request body (`X-Hub-Signature-256`); idempotency check on `X-GitHub-Delivery`; allow `pull_request` actions `opened`, `synchronize`, `reopened`; mockable GitHub App API fetcher for PR diff + files + `REVIEW.md`.
- **Done When:** `Test 1.2` in [TESTING.md](./TESTING.md) passes.

#### Step 1.3 — Diff Cleaning & GitHub Line-Position Mapping
- **Objective:** Eliminate non-code noise and map every kept hunk line to exact head line numbers and GitHub diff positions.
- **Files:** `backend/app/pipeline/diff_cleaner.py`
- **Key Constraints:** Drop lockfiles (`package-lock.json`, `poetry.lock`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`), minified files (`*.min.*`), binaries, generated build dirs, and whitespace/formatting-only hunks. Compute exact `github_position` per line so Stage 4 never fails with `422`.
- **Done When:** `Test 1.3` in [TESTING.md](./TESTING.md) passes.

#### Step 1.4 — Tree-sitter AST Function/Caller Extraction & `REVIEW.md` Loader
- **Objective:** Replace raw full-file dumps with minimal enclosing function AST slices + immediate caller signatures + repo rules.
- **Files:** `backend/app/pipeline/ast_extractor.py`
- **Key Constraints:** Support Python, JS/TS, Java, and C/C++. Extract enclosing function(s) overlapping changed lines, immediate callers/callees in touched files, and `±15` line fallback on parse errors. Load `REVIEW.md` (or fallback `CLAUDE.md`) from repo root if present.
- **Done When:** `Test 1.4` in [TESTING.md](./TESTING.md) passes.

#### Step 1.5 — Semgrep Pre-Scan, Adaptive Depth Router & Stage 0 Assembly
- **Objective:** Run fast local Semgrep rules and assemble final `ReviewBundle` with `Quick`/`Standard`/`Deep` classification.
- **Files:** `backend/app/pipeline/sast_scanner.py`, `backend/app/pipeline/depth_router.py`, `backend/app/pipeline/stage0.py`, `semgrep_rules/`
- **Key Constraints:** Semgrep runs with explicit timeout (`<= 5s`) and emits `SastHint` items mapped to Agent A. Depth router classifies `quick` (`<50 LOC`, non-critical), `standard` (`50–300 LOC`), or `deep` (`>300 LOC` or touching `auth/`, `db/`, `payments/`, `crypto/`).
- **Done When:** `Test 1.5` and **Brick 1 Exit Gate** in [TESTING.md](./TESTING.md) pass.

---

### Brick 2 — Base 8B Multi-Agent Orchestrator + Baseline Eval

> **Brick Goal:** Connect untouched Base 8B on vLLM with KV prefix caching and `guided_json`, wire Stages 1–4 end-to-end, and freeze baseline metrics on 150–200 held-out diffs.

#### Step 2.1 — vLLM Client, Prefix-Cache Prompt Builder & Guided JSON
- **Objective:** Create async vLLM wrapper enforcing `guided_json` schemas and KV-cache-friendly prompt splitting.
- **Files:** `backend/app/llm/vllm_client.py`, `backend/app/llm/prompts.py`
- **Key Constraints:** Split prompt builders explicitly into `build_shared_prefix(bundle)` + `build_finder_suffix(agent_role, hints)` so prefix strings are byte-identical across Stage 1 agents. Always pass `guided_json` schema; record prompt tokens, cached tokens (if exposed), and latency ms.
- **Done When:** `Test 2.1` in [TESTING.md](./TESTING.md) passes.

#### Step 2.2 — Stage 1 Parallel Isolated Finders (Agents A, B, C, D)
- **Objective:** Run specialist finders concurrently according to `DepthMode` without cross-agent leakage.
- **Files:** `backend/app/agents/finders.py`
- **Key Constraints:**
  - `quick` -> `[Agent A]`
  - `standard` -> `[Agent A, Agent B, Agent C]`
  - `deep` -> `[Agent A, Agent B, Agent C, Agent D]`
  - Execute via `asyncio.gather`; tag each candidate with `source_agent`. Never pass Semgrep hints to `B`, `C`, or `D`.
- **Done When:** `Test 2.2` in [TESTING.md](./TESTING.md) passes.

#### Step 2.3 — Stage 2 Adversarial Verifier Agent
- **Objective:** Refute false positives skeptically and output calibrated `0–100` confidence scores.
- **Files:** `backend/app/agents/verifier.py`
- **Key Constraints:** Run concurrently per Stage 1 candidate (bounded concurrency via semaphore). Prompt demands searching for input validation, sanitization, type guarantees, or unreachable paths that refute the bug before scoring `0–100`.
- **Done When:** `Test 2.3` in [TESTING.md](./TESTING.md) passes.

#### Step 2.4 — Stage 3 Dedupe/Rank & Stage 4 GitHub PR Publisher
- **Objective:** Cluster duplicate findings, apply `80 / 50–79 / <50` gating, tag severities, and post to GitHub PRs safely.
- **Files:** `backend/app/agents/dedupe_rank.py`, `backend/app/agents/orchestrator.py`, `backend/app/github/pr_publisher.py`
- **Key Constraints:** Merge overlapping findings (`same file`, line delta `<= 3`, matching category/CWE). Tag `🔴 Important`, `🟡 Nit`, `🟣 Pre-existing`. Post `>= 80` inline comments + 1 summary + `neutral` GitHub Check Run. Optional Deep-mode unit-test check hook sits behind `SANDBOX_TEST_ENABLED`.
- **Done When:** `Test 2.4` in [TESTING.md](./TESTING.md) passes.

#### Step 2.5 — Held-Out Evaluation Set (150–200 Diffs) & Baseline Freeze
- **Objective:** Build the deterministic held-out benchmark and record untouched Base 8B metrics + failure cases.
- **Files:** `evaluation/prepare_testset.py`, `evaluation/run_eval.py`, `evaluation/results/baseline_metrics.json`, `evaluation/results/baseline_errors.jsonl`
- **Key Constraints:** Pull `150–200` held-out diffs combining chronological `PrimeVul-Paired` splits + `CVEfixes`/`Code Security Vulnerability Dataset` slices + `~40%` clean/patched negatives. Log Single-Agent vs. Multi-Agent+Verifier comparison, Precision, Recall, F1, FPR, CWE accuracy, JSON validity %, latency, and threshold curve (`40/60/80/90`).
- **Done When:** `Test 2.5` and **Brick 2 Exit Gate** in [TESTING.md](./TESTING.md) pass.

---

### Brick 3 — Frontend Dashboard & Demo Flow

> **Brick Goal:** Deliver the interactive PR diff viewer, live `0–100` confidence slider, telemetry charts, and a viva-safe demo fallback.

#### Step 3.1 — Persistence Layer, Telemetry Logger & Replay API
- **Objective:** Persist all review artifacts (`>=50` & `<50` metadata, stage timings, diff chunks) and expose REST + offline replay endpoints.
- **Files:** `backend/app/storage/db.py`, `backend/app/storage/api.py`, `evaluation/fixtures/*.json`
- **Key Constraints:** SQLite default (`aiosqlite`) requiring zero external DB install for demo portability (overridable via `DATABASE_URL`). `/api/demo/replay/{id}` serves realistic deterministic demo PR reviews even without internet/GPU.
- **Done When:** `Test 3.1` in [TESTING.md](./TESTING.md) passes.

#### Step 3.2 — Dashboard Shell & Repo Security Health Overview
- **Objective:** Build the Next.js/React dashboard home and PR review list with security trend metrics.
- **Files:** `frontend/src/app/page.tsx`, `frontend/src/components/RepoHealthCard.tsx`, `frontend/src/lib/api.ts`
- **Key Constraints:** Display security score trend across PRs, severity distribution (`Important`/`Nit`/`Pre-existing`), and noise-suppression rate (candidates vs. posted).
- **Done When:** `Test 3.2` in [TESTING.md](./TESTING.md) passes.

#### Step 3.3 — Interactive PR Diff Viewer & Live Confidence Threshold Slider
- **Objective:** Display cleaned diffs with inline AI annotations controlled live by a `0–100` confidence slider.
- **Files:** `frontend/src/app/reviews/[id]/page.tsx`, `frontend/src/components/PrDiffViewer.tsx`, `frontend/src/components/ConfidenceSlider.tsx`
- **Key Constraints:** Default slider at `80`. Sliding between `0–100` filters visible findings **instantly in the browser**, visually distinguishing `Posted to PR (>=80)`, `Logged Only (50–79)`, and `Noise Suppressed (<50)`, alongside the Stage 2 `refutation_attempt` and `suggested_patch`.
- **Done When:** `Test 3.3` in [TESTING.md](./TESTING.md) passes.

#### Step 3.4 — Latency/Cost Telemetry Charts & Viva-Safe Demo Flow
- **Objective:** Visualize Stage `0–4` latencies, KV prefix-cache speedup, and PR cost vs. frontier APIs, plus one-click viva demo controls.
- **Files:** `frontend/src/components/TelemetryCharts.tsx`, `frontend/src/components/DemoControls.tsx`
- **Key Constraints:** Show live + recorded replay trigger buttons and clearly indicate active runtime profile (`Base 8B` vs `QLoRA 8B` vs `Replay`).
- **Done When:** `Test 3.4` and **Brick 3 Exit Gate (Viva-Safe Milestone)** in [TESTING.md](./TESTING.md) pass.

---

### Brick 4 — QLoRA Fine-Tuning (The Upgrade Layer)

> **Brick Goal:** Fix Base 8B's specific failure modes with `finder-lora` + `verifier-lora`, hot-swap into vLLM, and prove improvement on the exact Brick 2 test script.

#### Step 4.1 — Baseline Error Inspection & Curated Dataset Builder
- **Objective:** Analyze `baseline_errors.jsonl` and generate non-leaking training splits for both LoRA adapters.
- **Files:** `ml/mine_errors.py`, `ml/build_dataset.py`
- **Key Constraints:** Zero overlap (by commit SHA, CVE ID, and function hash) with the `150–200` held-out test set. Enforce `~40%` clean/no-bug diffs in finder training data and balanced `confirmed` vs. `refuted` pairs in verifier training data (`1,500–2,500` total examples).
- **Done When:** `Test 4.1` in [TESTING.md](./TESTING.md) passes.

#### Step 4.2 — Unsloth QLoRA Training (`finder-lora` & `verifier-lora`)
- **Objective:** Fine-tune both `~50 MB` adapters using 4-bit QLoRA with structured JSON targets.
- **Files:** `ml/train_finder.py`, `ml/train_verifier.py`
- **Key Constraints:** Train strictly on the same base 8B model family used in Brick 2; export standard PEFT LoRA adapter directories compatible with vLLM `--lora-modules`.
- **Done When:** `Test 4.2` in [TESTING.md](./TESTING.md) passes.

#### Step 4.3 — vLLM Multi-LoRA Hot-Swap & Toggle Routing
- **Objective:** Serve both adapters on one quantized 8B vLLM instance and route Stage 1 -> `finder-lora`, Stage 2 -> `verifier-lora`.
- **Files:** `backend/app/llm/vllm_client.py`, `backend/app/config.py`
- **Key Constraints:** Controlled by `LORA_ENABLED` env flag so flipping back to `false` restores Brick 2 Base 8B with zero code edits.
- **Done When:** `Test 4.3` in [TESTING.md](./TESTING.md) passes.

#### Step 4.4 — Post-Fine-Tuning Re-Eval & 4 Report Ablation Charts
- **Objective:** Re-run the exact Brick 2 evaluation script (`evaluation/run_eval.py`) and produce side-by-side metrics + 4 publication-ready charts.
- **Files:** `evaluation/plot_ablations.py`, `evaluation/results/lora_metrics.json`, `evaluation/results/*.png`
- **Key Constraints:** Compare `Base 8B` vs `QLoRA 8B` on the **identical** held-out split and generate:
  1. Single-Agent vs. Multi-Agent + Verifier chart
  2. Base 8B vs. Fine-Tuned 8B vs. Frontier Teacher comparison
  3. Confidence Threshold Curve (`40 → 60 → 80 → 90`)
  4. Latency & Cost Benchmark chart
- **Done When:** `Test 4.4` and **Brick 4 Exit Gate** in [TESTING.md](./TESTING.md) pass.

---

## Part B: Runtime Review Agent Specifications

Every runtime agent receives the **shared KV prefix** (`System rules` + `REVIEW.md` + `Cleaned Diff` + `Tree-sitter AST & Callers`) followed by its isolated role suffix:

| Runtime Agent | Stage | Active Modes | Exclusive Inputs | Core Focus & Behavioral Rules |
| :--- | :---: | :--- | :--- | :--- |
| **Agent A: Security & OWASP** | 1 | `Quick`, `Standard`, `Deep` | Shared prefix + **Semgrep `SastHints`** | SQLi (`CWE-89`), XSS (`CWE-79`), command injection (`CWE-78`), SSRF (`CWE-918`), auth bypass, hardcoded secrets. Validate or reject Semgrep hints against AST context; never parrot unverified SAST blindly. |
| **Agent B: Logic & Edge Cases** | 1 | `Standard`, `Deep` | Shared prefix **ONLY** | Null/None derefs, off-by-one, unhandled async errors, race conditions, resource leaks, broken state transitions. Ignore formatting/style. |
| **Agent C: Repo Rules Compliance** | 1 | `Standard`, `Deep` | Shared prefix **ONLY** (focuses on `REVIEW.md` / `CLAUDE.md`) | Enforces explicit rules declared in `REVIEW.md`. If no `REVIEW.md` exists or no explicit rule is violated, return empty `[]` — never invent style nits. |
| **Agent D: Git History & Callers** | 1 | `Deep` | Shared prefix **ONLY** (focuses on caller signatures & commit context) | Breaking signature/contract changes across callers, changed return types/nullability assumptions, regressions against recent commit intent. |
| **Adversarial Verifier** | 2 | `Quick`, `Standard`, `Deep` | **1 single candidate** + enclosing AST & callers | Skeptically attempt to **DISPROVE** the candidate by citing guards, sanitizers, ORM bindings, or unreachable branches. Output `verdict`, `refutation_attempt`, and calibrated `0–100` confidence (`>=80` only when refutation fails). |
| **Dedupe & Ranker** | 3 | Deterministic | All verified candidates (`>=50`) | Cluster overlapping spans (`same file`, `±3 lines`, matching category/CWE); assign `🔴 Important`, `🟡 Nit`, or `🟣 Pre-existing`; split `>=80` (PR) vs `50–79` (Dashboard). |
