# TESTING.md — Step-by-Step & Brick-by-Brick Verification Suite

Every small step and every brick in TalkBridge has deterministic verification criteria. **Do not advance to the next brick until the current brick's Exit Gate passes completely.**

---

## Test Commands Quick Reference

```bash
# Run tests for a specific step or brick (from backend/ or repo root)
pytest tests/brick1/ -v
pytest tests/brick2/ -v
pytest tests/brick3/ -v
pytest tests/brick4/ -v

# Run held-out evaluation benchmark (Brick 2 baseline & Brick 4 LoRA upgrade)
python -m evaluation.run_eval --split evaluation/data/heldout_testset.jsonl --out evaluation/results/baseline_metrics.json

# Frontend component & E2E tests (Brick 3)
cd frontend && npm test && npm run build
```

---

## Brick 1 Tests — Deterministic Pipeline (No LLM Yet)

> **Global Brick 1 Assertion:** Zero LLM network calls, zero API keys required beyond optional GitHub mock fixtures, deterministic output on identical PR inputs.

### Step 1.1 Tests — Project Bootstrap, Config & Schemas (`tests/brick1/test_step1_schemas.py`)
- **Validations:**
  - `ReviewBundle`, `AstChunk`, `SastHint`, `FinderOutput`, `VerifierOutput`, `RankedFinding` serialize/deserialize cleanly to JSON.
  - Confidence bounds check: `confidence = -1` and `confidence = 101` raise `ValidationError`; `0`, `50`, `80`, `100` pass.
  - `FinderOutput.model_json_schema()` and `VerifierOutput.model_json_schema()` return valid JSON Schemas usable by vLLM `guided_json`.
- **Command:** `pytest tests/brick1/test_step1_schemas.py -v`

### Step 1.2 Tests — GitHub Webhook Intake & Signature Verification (`tests/brick1/test_step2_webhook.py`)
- **Test Cases:**
  1. Valid HMAC-SHA256 `X-Hub-Signature-256` + `pull_request` (`opened`) -> HTTP `202`, task enqueued once.
  2. Invalid or missing signature -> HTTP `401`, no task enqueued.
  3. Duplicate `X-GitHub-Delivery` UUID -> HTTP `200` (`duplicate_ignored`), task **not** re-enqueued.
  4. Non-review event (`issues`, `pull_request.labeled`) -> HTTP `200` (`ignored`), no task enqueued.
- **Command:** `pytest tests/brick1/test_step2_webhook.py -v`

### Step 1.3 Tests — Diff Cleaning & Line Mapping (`tests/brick1/test_step3_diff_cleaner.py`)
- **Fixture:** Multi-file PR diff containing `package-lock.json` (2,000 lines), `public/bundle.min.js`, a whitespace-only hunk in `utils/format.py`, and a real 6-line edit in `auth/login.py`.
- **Assertions:**
  - Lockfile, minified JS, and formatting-only hunks are completely stripped.
  - Only `auth/login.py` survives with exact `line_start`, `line_end`, and GitHub `position` index matching the raw unified diff.
  - Token/character count reduction is logged (`>90%` reduction on lockfile-heavy PR fixture).
- **Command:** `pytest tests/brick1/test_step3_diff_cleaner.py -v`

### Step 1.4 Tests — Tree-sitter AST Extraction & `REVIEW.md` Loader (`tests/brick1/test_step4_ast_extractor.py`)
- **Test Cases:**
  1. Python file (300+ lines, 8 functions) with 2 lines modified in `authenticate_user()` and a call site in `login_handler()` -> returns **only** `authenticate_user` body + `login_handler` caller signature (unrelated 6 functions excluded).
  2. TypeScript/JavaScript Express route handler edit -> extracts enclosing route handler + called service signature.
  3. Intentionally malformed syntax snippet -> does **not** crash; falls back cleanly to `±15` line window.
  4. Fixture repo containing `REVIEW.md` -> rules loaded verbatim into `ReviewBundle.review_rules`; absent `REVIEW.md` -> uses default correctness-over-style policy.
- **Command:** `pytest tests/brick1/test_step4_ast_extractor.py -v`

### Step 1.5 Tests — Semgrep Pre-Scan & Adaptive Depth Router (`tests/brick1/test_step5_sast_router.py`)
- **Test Cases:**
  1. Fixture with hardcoded API key + `eval(user_input)` + raw SQL f-string -> Semgrep emits structured `SastHint` objects with file, line range, and CWE/rule ID.
  2. Clean parameterized SQL fixture -> `0` Semgrep false-positive hints.
  3. Depth routing assertions:
     - `20 LOC` in `src/helpers.py` -> `quick`
     - `120 LOC` in `src/orders.py` -> `standard`
     - `350 LOC` in `src/orders.py` -> `deep`
     - `12 LOC` in `src/auth/jwt.py` -> `deep` (critical path trigger)
- **Command:** `pytest tests/brick1/test_step5_sast_router.py -v`

### Brick 1 Exit Gate
- Run end-to-end deterministic Stage 0 on 3 PR fixtures (`clean_small_pr`, `noisy_lockfile_pr`, `auth_sqli_pr`):
  ```bash
  pytest tests/brick1/ -v
  ```
- **Pass Criteria:** All unit + Stage 0 integration tests pass in `<10s` total; `ReviewBundle` contains clean minimal AST chunks, accurate GitHub line positions, and Semgrep hints; `0` LLM calls invoked.

---

## Brick 2 Tests — Base 8B Multi-Agent Orchestrator + Baseline Eval

### Step 2.1 Tests — vLLM Client, Prefix Caching & Guided JSON (`tests/brick2/test_step1_vllm_prefix.py`)
- **Offline (Mocked vLLM) Assertions:**
  - Prefix strings returned by `build_shared_prefix(bundle)` are **100% byte-identical** across Agent A, B, C, and D calls for the same PR.
  - `guided_json` payload sent to vLLM matches `FinderOutput.model_json_schema()` / `VerifierOutput.model_json_schema()`.
  - Invalid JSON / timeout triggers clean structured error handling without crashing orchestrator.
- **Live vLLM Smoke Test (`@pytest.mark.live_vllm`):**
  - Sends 4 parallel Stage 1 calls on one PR bundle to live Base 8B vLLM -> `100%` responses validate via `FinderOutput.model_validate_json()`, and repeated prefix shows measurable TTFT/prefill reduction vs. uncached baseline.
- **Command:** `pytest tests/brick2/test_step1_vllm_prefix.py -v` (add `-m live_vllm` when GPU/Modal vLLM is running).

### Step 2.2 Tests — Stage 1 Isolated Parallel Finders (`tests/brick2/test_step2_finders.py`)
- **Assertions:**
  - `quick` depth invokes exactly 1 agent (`A`); `standard` invokes 3 (`A, B, C`); `deep` invokes 4 (`A, B, C, D`).
  - **Isolation Audit:** Inspect prompt payloads sent to Agents `B`, `C`, and `D` — assert **zero** presence of Agent A findings and **zero** presence of `SastHint` blocks.
  - Verify async parallel execution (`total_stage1_ms` roughly equals `max(agent_ms)`, not `sum(agent_ms)`).
- **Command:** `pytest tests/brick2/test_step2_finders.py -v`

### Step 2.3 Tests — Stage 2 Adversarial Verifier (`tests/brick2/test_step3_verifier.py`)
- **Fixture Pairs:**
  1. **False-positive candidate:** Agent A flags SQLi on `cursor.execute("SELECT * FROM users WHERE id = %s", (uid,))` -> Verifier cites parameterized binding in `refutation_attempt`, returns `verdict="refuted"` or `calibrated_confidence < 80`.
  2. **True-positive candidate:** Agent A flags SQLi on `cursor.execute(f"SELECT * FROM users WHERE id = '{uid}'")` with unsanitized route param -> Verifier returns `verdict="confirmed"` and `calibrated_confidence >= 80`.
- **Command:** `pytest tests/brick2/test_step3_verifier.py -v`

### Step 2.4 Tests — Stage 3 Dedupe/Rank & Stage 4 GitHub Publisher (`tests/brick2/test_step4_publish.py`)
- **Assertions:**
  - Two overlapping findings on `auth/login.py:42-46` (from Agent A & Agent D) merge into 1 finding preserving highest confidence/severity.
  - Confidence gating assertions:
    - Finding score `88` -> included in GitHub PR inline comments payload AND dashboard DB.
    - Finding score `67` -> excluded from GitHub PR inline comments, preserved in dashboard payload (`posted_to_pr=False`).
    - Finding score `32` -> excluded from PR comments and flagged `discarded`.
  - GitHub Check Run payload asserts `conclusion == "neutral"` (never `"failure"`).
  - Invalid diff line position gracefully falls back to PR summary mention instead of throwing `422` and dropping the entire review.
- **Command:** `pytest tests/brick2/test_step4_publish.py -v`

### Step 2.5 Tests — Held-Out Baseline Evaluation (`150–200` Diffs) (`tests/brick2/test_step5_eval_harness.py`)
- **Harness Integrity Tests:**
  - Held-out dataset contains between `150` and `200` diffs, includes both vulnerable and clean/patched negatives (`~40%` clean), and has deterministic IDs/hashes.
  - Eval script computes Precision, Recall, F1, False Positive Rate, CWE Top-1 Accuracy, JSON Schema Validity %, P50/P95 Latency, and Threshold Sensitivity (`40`, `60`, `80`, `90`) without errors.
- **Live Baseline Execution:**
  ```bash
  python -m evaluation.run_eval \
    --split evaluation/data/heldout_testset.jsonl \
    --mode multi_agent \
    --model-profile base_8b \
    --out evaluation/results/baseline_metrics.json \
    --errors-out evaluation/results/baseline_errors.jsonl
  ```
  *(Also run `--mode single_agent` once to capture the Single-Agent vs. Multi-Agent + Verifier ablation data.)*

### Brick 2 Exit Gate
- `pytest tests/brick2/ -v` passes 100%.
- `evaluation/results/baseline_metrics.json` and `evaluation/results/baseline_errors.jsonl` exist and contain complete metrics across all `150–200` held-out diffs.
- At least 1 live or sandboxed GitHub PR dry-run executes Stage `0 → 1 → 2 → 3 → 4` end-to-end posting inline comments (`>=80`) and a `neutral` Check Run.

---

## Brick 3 Tests — Frontend Dashboard & Viva-Safe Demo Flow

### Step 3.1 Tests — Persistence & Replay/API Endpoints (`tests/brick3/test_step1_api.py`)
- **Assertions:**
  - Creating a review stores `reviews`, `diff_hunks`, and `findings` (across all confidence tiers).
  - `GET /api/reviews/{id}` returns full cleaned diff + findings with `calibrated_confidence`, `refutation_attempt`, and `posted_to_pr`.
  - `POST /api/demo/replay/auth_sqli_pr` completes in `<500ms` with **no** GPU/vLLM/GitHub network access required.
- **Command:** `pytest tests/brick3/test_step1_api.py -v`

### Step 3.2 Tests — Dashboard Shell & Repo Health Overview (`frontend/__tests__/RepoHealth.test.tsx`)
- **Assertions:**
  - Renders repo security trend chart, severity counts (`Important`, `Nit`, `Pre-existing`), and noise suppression metric matching mocked API fixture.
  - Loading and API-error states render cleanly without unhandled runtime exceptions.
- **Command:** `cd frontend && npm test -- RepoHealth`

### Step 3.3 Tests — Diff Viewer & Live Confidence Threshold Slider (`frontend/__tests__/ConfidenceSlider.test.tsx`)
- **Assertions:**
  - Fixture PR has 3 findings at confidence `92`, `65`, and `35`.
  - At default slider `80`: `1` finding shows as `Posted to PR`, `1` in `Suppressed / Logged (50–79)`, `1` hidden/discarded (`<50`).
  - Moving slider to `60` immediately updates visible PR-threshold preview to `2` findings (`92`, `65`) **with zero extra API/LLM network requests** (`fetch` spy called `0` additional times).
  - Moving slider to `90` hides `65` and keeps `92`.
- **Command:** `cd frontend && npm test -- ConfidenceSlider`

### Step 3.4 Tests — Telemetry Charts & Viva-Safe E2E Flow (`tests/brick3/test_step4_e2e.py` / Playwright)
- **Assertions:**
  - Stage latency chart displays non-negative `Stage 0..4` bars and KV cache hit percentage matching `/api/telemetry/summary`.
  - Cost chart displays local 8B PR cost vs. frontier API benchmark.
  - **Viva-Safe Offline Test:** Stop vLLM server and block outbound GitHub calls -> trigger Demo Replay flow in browser -> PR diff, inline patches, confidence slider (`80` -> `55` -> `85`), and latency charts all work smoothly.
- **Command:** `cd frontend && npm run build && npx playwright test` (or `pytest tests/brick3/ -v`)

### Brick 3 Exit Gate (Viva-Safe Milestone)
- Backend API tests + Frontend unit/build + E2E Demo Replay pass **both** with live vLLM and with vLLM/GitHub disconnected.
- Repo is officially **demo-ready and viva-safe** at this checkpoint.

---

## Brick 4 Tests — QLoRA Fine-Tuning (The Upgrade Layer)

### Step 4.1 Tests — Error Mining & Dataset Leakage/Balance Audit (`tests/brick4/test_step1_dataset.py`)
- **Assertions:**
  - `ml/mine_errors.py` categorizes Brick 2 `baseline_errors.jsonl` into `over_flagged_safe`, `sycophantic_verifier`, and `bad_calibration`.
  - **Zero Data Leakage:** Intersection of `(commit_sha, cve_id, normalized_code_hash)` between training set and `evaluation/data/heldout_testset.jsonl` is strictly **empty (`set()`)**.
  - **Clean Negative Balance:** Clean / no-bug ratio in `finder` training set lies strictly within `35%–45%` (target `~40%`).
  - `100%` of serialized assistant target outputs in `finder` and `verifier` training `.jsonl` files pass Pydantic schema validation.
- **Command:** `pytest tests/brick4/test_step1_dataset.py -v`

### Step 4.2 Tests — Unsloth QLoRA Adapter Validation (`tests/brick4/test_step2_adapters.py`)
- **Assertions:**
  - `finder-lora` and `verifier-lora` artifact directories contain valid `adapter_config.json` + safetensors weights (`<150 MB` each, target `~50 MB`).
  - Training log confirms monotonically decreasing loss without NaN spikes.
  - Held-aside validation slice achieves `>=99%` valid JSON output before `guided_json` fallback.
- **Command:** `pytest tests/brick4/test_step2_adapters.py -v`

### Step 4.3 Tests — vLLM Multi-LoRA Hot-Swap & Fallback (`tests/brick4/test_step3_multilora.py`)
- **Assertions:**
  - With `LORA_ENABLED=true`: Stage 1 request uses `model="finder-lora"` and Stage 2 request uses `model="verifier-lora"` on the same running vLLM server without restarting vLLM.
  - Flipping `LORA_ENABLED=false` seamlessly routes Stage 1 & 2 back to Base 8B (`Brick 2/3` behavior) on the next request.
- **Command:** `pytest tests/brick4/test_step3_multilora.py -v`

### Step 4.4 Tests — Identical Held-Out Re-Eval & 4 Ablation Charts (`tests/brick4/test_step4_ablation.py`)
- **Execution Command (must use exact same split and script as Step 2.5):**
  ```bash
  python -m evaluation.run_eval \
    --split evaluation/data/heldout_testset.jsonl \
    --mode multi_agent \
    --model-profile lora_8b \
    --out evaluation/results/lora_metrics.json \
    --errors-out evaluation/results/lora_errors.jsonl

  python -m evaluation.plot_ablations \
    --baseline evaluation/results/baseline_metrics.json \
    --lora evaluation/results/lora_metrics.json \
    --out-dir evaluation/results/plots
  ```
- **Assertions (`tests/brick4/test_step4_ablation.py`):**
  - `lora_metrics.json` evaluates the exact same `dataset_hash` and `dataset_size` (`150–200`) as `baseline_metrics.json`.
  - Measurable regression checks vs. Brick 2 baseline:
    - Overall F1 improves (`lora.f1 > baseline.f1`)
    - False Positive Rate on safe/patched functions drops (`lora.fpr < baseline.fpr`)
    - Stage 2 refutation accuracy on paired patched negatives improves (`lora.verifier_specificity > baseline.verifier_specificity`)
    - JSON schema validity remains `100%` (with `guided_json`)
  - All 4 ablation chart PNG/SVG files are generated and non-empty in `evaluation/results/plots/`:
    1. `ablation_single_vs_multi.png`
    2. `ablation_base_vs_lora_vs_teacher.png`
    3. `ablation_confidence_curve.png`
    4. `ablation_latency_cost.png`
- **Command:** `pytest tests/brick4/test_step4_ablation.py -v`

### Brick 4 Exit Gate (Final Release Gate)
- Full regression suite passes (`pytest tests/ -v`), `LORA_ENABLED=true` and `LORA_ENABLED=false` both pass smoke tests, all 4 ablation charts are verified, and dashboard displays side-by-side `Base 8B` vs `QLoRA 8B` metrics cleanly.
