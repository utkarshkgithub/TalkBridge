# TalkBridge

**Distilled AI Code Security Reviewer & Unit Test Bot (QLoRA Fine-Tuned 8B LLM + GitHub App)**

TalkBridge is a developer platform that plugs straight into GitHub Pull Requests, strips noisy diffs down to minimal AST/SAST context, scans them via an isolated multi-agent 8B LLM pipeline, and opens concise inline PR review comments with verified patches and optional unit tests — powered by a compact QLoRA fine-tuned model instead of expensive frontier APIs.

- **ML / GenAI Core:** Knowledge distillation + QLoRA fine-tuning of a compact 8B coding model (`Qwen3-8B` / `Qwen3-Coder` or `Llama-3-8B`) via Unsloth, served with vLLM automatic KV prefix caching, constrained JSON (`guided_json`), and multi-LoRA hot-swapping (`finder-lora` + `verifier-lora`).
- **Full-Stack App:** GitHub App Webhook integration, FastAPI + Redis/Celery async orchestrator, deterministic Tree-sitter + Semgrep Stage 0 pipeline, SQLite/PostgreSQL telemetry store, and a Next.js/React PR diff-viewer dashboard with a live confidence threshold slider (`0–100`).

---

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
- **Backend / Orchestrator (1 person):** FastAPI + Redis/Celery worker for GitHub Webhooks, diff cleaning, Tree-sitter + Semgrep Stage 0, parallel async Stages 1–4, GitHub PR Review API, and telemetry DB.
- **Frontend Dashboard (1 person):** Next.js/React dashboard with repo security trends, interactive PR diff viewer with inline comments, live confidence threshold slider (`0–100`), and latency/cost telemetry charts.

### The 4 Ablation Charts for Evaluation

1. **Single-Agent vs. Multi-Agent + Verifier:** Precision jump and false-positive rate drop when adding Stage 2 adversarial verification.
2. **Base 8B vs. Fine-Tuned 8B vs. Frontier Teacher:** Bug-detection F1, CWE classification accuracy, and JSON schema validity on the held-out `150–200` diff split.
3. **Confidence Threshold Curve (`40 → 60 → 80 → 90`):** Precision vs. Recall curve empirically justifying `80` as the PR-posting threshold.
4. **Latency & Cost Benchmark:** Prefix-cached 8B pipeline (seconds, fractions of a cent per PR) vs. frontier API pricing (`$15–$25/PR` for deep multi-agent reviews).
