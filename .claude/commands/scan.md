---
description: Scan ATS career pages listed in config/portals.yml and append new offers to data/pipeline.md
argument-hint: [--dry-run] [--only <slug>] [--json]
---

# /scan $ARGUMENTS

Run the ATS scanner over the companies in `config/portals.yml` and append new offers to `data/pipeline.md`.

## First-run guard

Before running the scanner, check that `config/candidate-profile.yml` **and** `config/portals.yml` exist. If either is missing, **stop** and tell the user:

> "No config found. Run `/apply-onboard` first — it will extract your CV, build the configs, and find ~30 target companies for you."

Do not try to run the scanner against the example templates.

## Prerequisites

- `config/portals.yml` exists and contains at least one company with a `careers_url` pointing to a supported ATS (Lever, Greenhouse, or Ashby).
- `data/scan-history.tsv` is writable (created on first run).

## Run

```bash
node src/scan/index.mjs $ARGUMENTS
```

## Flags

- `--dry-run` — print what would be written without touching any file.
- `--only <slug>` — scan a single company by its ATS slug (e.g. `--only mistral`).
- `--json` — emit machine-readable output.

## Output

- **`data/pipeline.md`** — new offers appended as a Markdown table (deduped against `scan-history.tsv` and `applications.md`).
- **`data/scan-history.tsv`** — source of truth for deduplication. Never edit by hand.
- **`data/filtered-out.tsv`** — offers rejected by the title filter (`portals.yml.title_filter`).

## Interpreting the output

The scanner prints a summary per company:

```
[mistral] 42 raw offers → 3 after title_filter → 1 new
```

- **raw offers**: total jobs returned by the ATS API.
- **after title_filter**: offers matching `required_any` and not matching `excluded_any`.
- **new**: offers not already present in `scan-history.tsv` or `applications.md`.

If a company reports `0 raw offers`, check that its `careers_url` points to an ATS slug supported by `src/scan/ats-detect.mjs`. Group B (custom career pages) companies are skipped silently.

## Next step

Once `data/pipeline.md` has new rows, run `/score <url>` on each to get an LLM evaluation.
