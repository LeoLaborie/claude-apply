---
description: Evaluate a job offer URL against config/cv.md using a lightweight LLM call
argument-hint: <job-url>
---

# /score $ARGUMENTS

Fetch the offer at `$ARGUMENTS`, build a prompt that compares it against `config/cv.md` + `config/candidate-profile.yml`, and append the structured result to `data/evaluations.jsonl`.

## First-run guard

Before running the scorer, check that `config/candidate-profile.yml` **and** `config/cv.md` exist. If either is missing, **stop** and tell the user:

> "No config found. Run `/apply-onboard` first — it will extract your CV and build the profile."

## Prerequisites

- `config/cv.md` is filled with your real CV.
- `config/candidate-profile.yml` is valid.
- `claude` CLI is on your `PATH` (the Anthropic Claude Code CLI). The script uses `claude -p` in stripped mode.

## Run

**Preferred:** if the URL is already in `data/pipeline.md` (i.e. it came from a recent `/scan`), use `--from-pipeline` so the scorer reuses the authoritative `{company, role, location}` that the ATS fetchers already extracted:

```bash
node src/score/index.mjs $ARGUMENTS --from-pipeline
```

**Fallback:** if the URL is not in `data/pipeline.md`, you can either (a) let the scorer scrape the page (best-effort, sometimes mis-extracts the company/role — see `metadata_source: "scrape"` in the output), or (b) pass the metadata explicitly:

```bash
node src/score/index.mjs $ARGUMENTS \
  --company "Mistral AI" \
  --role "Research Intern - Inference" \
  --location "Paris, France"
```

The three metadata flags are **all-or-nothing**: pass all three or none. Mixing with scraped fields is disallowed to keep `metadata_source` honest.

## Flags

- `--from-pipeline` — look up `{company, role, location}` in `data/pipeline.md` by URL; exit 2 if not found. Mutually exclusive with the explicit metadata flags below.
- `--company "..."` `--role "..."` `--location "..."` — authoritative metadata overrides. Must be passed together.
- `--id NNN` — force the evaluation id (default: auto-increment from the last line of `evaluations.jsonl`).
- `--json-input <path>` — bypass URL fetch; read a pre-built offer JSON blob (used by tests and agent pipelines).
- `--re-score` — re-evaluate an offer already present in `data/evaluations.jsonl`. Preserves the existing `id`; refreshes `score`, `reason`, `date`, `verdict`, `company`, `role`, `location`. Compatible with single URL, `--from-pipeline`, and `--batch`. `--id` is ignored when `--re-score` is used.

## Output

Appends one JSON line to `data/evaluations.jsonl`:

```json
{
  "id": "042",
  "date": "2026-04-11",
  "company": "Mistral AI",
  "role": "Research Intern",
  "url": "...",
  "location": "Paris, France",
  "metadata_source": "pipeline",
  "score": 0.78,
  "verdict": "apply",
  "reason": "...",
  "status": "Evaluated"
}
```

`metadata_source` is one of `pipeline` (from `data/pipeline.md` via `--from-pipeline`), `flags` (from `--company/--role/--location`), `scrape` (from Playwright DOM extraction), or `json-input` (from `--json-input`). Use it to audit whether a surprising `company` value came from the ATS or from a best-effort scrape.

## Cost

Around USD 0.03 per offer when using the stripped `claude -p` mode (around USD 0.14 otherwise). The script runs from a temp directory with `--disable-slash-commands --no-chrome --strict-mcp-config --setting-sources ""` to avoid Claude Code overhead.

## Batch mode

Score all unscored offers from `data/pipeline.md` in parallel:

```bash
node src/score/index.mjs --batch [--parallel N]
```

- `--batch` — read all offers from `data/pipeline.md`, skip those already in `evaluations.jsonl` (dedup by URL), score the rest.
- `--parallel N` — number of concurrent workers (default: 5). Implies `--batch`.
- `--batch` is mutually exclusive with `<url>`, `--from-pipeline`, and `--company/--role/--location`.

Progress is logged to stderr. Each scored record is printed to stdout as a JSON line.

Idempotent: re-running `--batch` only scores offers not yet in `evaluations.jsonl`.

## Re-scoring existing evaluations

Use `--re-score` after updating `config/cv.md`, changing the scoring prompt, or noticing a stale score. It re-fetches the page and rewrites the matching entry in `data/evaluations.jsonl` in place.

```bash
# Single URL (must already be in evaluations.jsonl)
node src/score/index.mjs <url> --re-score

# Preferred: pull metadata from pipeline.md
node src/score/index.mjs <url> --from-pipeline --re-score

# Batch: re-score every offer in pipeline.md.
# Already-scored offers are overwritten; offers not yet scored are scored for the first time.
node src/score/index.mjs --batch --re-score
```

Behaviour:

- The `id` of the existing entry is preserved so report links do not break.
- The old `data/tracker-additions/<id>-*.tsv` files are deleted before a new TSV is written (useful when company/role — hence the slug — change).
- If the page is now closed/broken during a re-score, the existing entry is **kept** (not overwritten, not moved to `filtered-out.tsv`). A warning is logged.
- Single-URL re-score exits 2 if the URL is absent from `evaluations.jsonl`.

## Next step

If `verdict === "apply"`, run `/apply <url>` to start the automated application flow.
