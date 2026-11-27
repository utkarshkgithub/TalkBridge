# Held-out evaluation split

`heldout_testset.jsonl` contains 180 source-backed records: 108 vulnerable and 72 clean
(40% clean). It contains 120 C records from 60 PrimeVul test pairs, plus 60 Code Security
test records (20 Python, 27 JavaScript and 13 Java).

Dataset SHA-256: `2f659a8b4d78c51e75493942d0c71e14bb78e15d92b5155645212191801bae85`.

## Sources and reproducibility

1. [PrimeVul authors and chronological split methodology](https://github.com/DLVulDet/PrimeVul).
   Downloaded the paired test partition from the
   [colin/PrimeVul mirror](https://huggingface.co/datasets/colin/PrimeVul/blob/81ead21/primevul_test_paired.jsonl).
   Input SHA-256: `384758c25142b640f1768bb0d334c43f315c580022ae94973c66e77128fb3821`.
   The importer retains the source partition's order, checks consecutive pair labels,
   commit identity and CVE identity, and selects the first 60 eligible distinct pairs.
2. [Code Security Vulnerability Dataset](https://huggingface.co/datasets/ayshajavd/code-security-vulnerability-dataset).
   Only `data/test-00000-of-00001.parquet` is used.
   Input SHA-256: `f16650e9ccfa2aeb2858136b055d899d4059b435b88a76c16573fb88f175fae4`.
   Selection sorts normalized function hashes and selects 48 vulnerable plus 12 clean records.
   All PrimeVul function hashes are excluded, as are unsupported languages and duplicate hashes.
   Tree-sitter must parse each Code Security snippet in its declared language without errors.
   This rejects mislabeled Swift, Ruby and Go examples found during the initial preflight.
   The selected upstream sources are `labeled_dataset` (37) and `cybernative_dpo` (23).
   These include model-generated examples. This portion is not a corpus of real CVE commits.

Both inputs are public and free to download. The script checks full file hashes before import,
so an upstream update cannot silently change the split. Original source snippets remain
unaltered apart from trailing newlines. Original comments, including CVE references where
present, remain in code. No CVE labels, descriptions, fixing messages or target labels are
injected into prompts. Their presence in original comments is a benchmark limitation.

Upstream dataset cards declare MIT for the PrimeVul mirror and Apache-2.0 for Code Security.
Underlying snippets retain their original authorship and any applicable upstream notices.
These records are research data, not newly authored application code. Review source licenses
before distributing this corpus beyond the project.

## What the diffs mean

PrimeVul vulnerable records reverse a fixing function diff, introducing the vulnerable version.
Clean paired records apply that same fixing diff. Code Security provides snippets, not original
PR patches, so these are explicit function-addition proxy diffs. Repository paths and PR context
are neutral synthetic identifiers. Commit/CVE identifiers are provenance fields outside prompts.
No original repository history or whole-program callers are supplied by this benchmark.

Metrics measure sample-level vulnerability classification, not localization, exploitability,
review precision on real production PRs, or unseen-project generalization. Ground truth follows
upstream labels. The 12,000-character sample cap bounds context; it biases the benchmark toward
smaller functions. Training exclusions must use all held-out hashes and available commits/CVEs.

## Rebuild

From the repository root, download the two files above and run:

```bash
cd backend
uv sync --locked --group eval
cd ..
PYTHONPATH=backend backend/.venv/bin/python -m evaluation.prepare_testset \
  --primevul /path/to/primevul_test_paired.jsonl \
  --code-security /path/to/test-00000-of-00001.parquet
```

The importer refuses to overwrite a different split. The split hash is asserted by tests.
Once the live baseline exists, the evaluator also enforces its dataset and metric formula
hashes. Do not change either before Brick 4 completes.
