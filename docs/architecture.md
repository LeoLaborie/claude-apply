# Architecture

`claude-apply` has four layers: **scan**, **score**, **apply**, **dashboard**. Each layer is a self-contained directory under `src/`, sharing only the generic helpers in `src/lib/`.

## Module map

```
src/
├── lib/                      # shared helpers, no domain logic
│   ├── jsonl-writer.mjs      # append JSONL / TSV atomically
│   ├── pipeline-md.mjs       # parse + write data/pipeline.md
│   ├── scan-history.mjs      # dedup source-of-truth TSV
│   ├── applications-md.mjs   # parse + update data/applications.md
│   ├── prefilter-rules.mjs   # deterministic URL filter
│   ├── prompt-builder.mjs    # build the /score LLM prompt
│   └── jd-truncate.mjs       # token budget control
│
├── scan/                     # ATS scanner (Group A)
│   ├── index.mjs             # CLI entry
│   ├── ats-detect.mjs        # URL → { platform, slug }
│   └── ats/                  # one fetcher per ATS
│       ├── lever.mjs
│       ├── greenhouse.mjs
│       └── ashby.mjs
│
├── score/                    # lightweight LLM evaluator
│   ├── index.mjs             # CLI entry
│   └── prefilter.mjs         # cheap deterministic gate
│
├── apply/                    # automated form filling
│   ├── candidate-profile.schema.mjs
│   ├── field-classifier.mjs
│   ├── language-detect.mjs
│   ├── confirmation-detector.mjs
│   ├── letter-generator.mjs
│   ├── apply-log.mjs
│   └── upload-file.mjs       # Playwright CDP helper (CLI)
│
└── dashboard/
    └── build.mjs             # generates dashboard.html
```

## Data flow

```
portals.yml ──► scan ──► pipeline.md ──► score ──► evaluations.jsonl
                  │                                      │
                  │                                      ▼
           scan-history.tsv                       (agent triage)
                                                         │
                                                         ▼
                                            /apply <url> (Claude Code)
                                                         │
                            ┌────────────────────────────┴─────────────┐
                            │                                          │
                            ▼                                          ▼
                       Chrome tab                          applications.md
                     (claude-in-chrome                     apply-log.jsonl
                       + CDP upload)                                   │
                                                                       ▼
                                                              dashboard.html
```

## Dependency rules

- `src/lib/` depends on nothing domain-specific. Pure utilities.
- `src/scan/` depends on `src/lib/`. Talks HTTP to ATS APIs. No LLM.
- `src/score/` depends on `src/lib/` + shells out to `claude -p`.
- `src/apply/` depends on `src/lib/` and Playwright (for the upload helper). Never imports `src/scan/` or `src/score/`.
- `src/dashboard/` depends on `src/lib/` only.

## External dependencies

- **`js-yaml`** — profile and portals parsing.
- **`playwright`** — CDP upload helper (the only reason Playwright is in dependencies).
- **`prettier`** — dev-only.
- **`claude` CLI** — required at runtime for `/score`; not a package dep.
- **`claude-in-chrome` browser extension** — required at runtime for `/apply`; not a package dep.

## Why CDP?

File uploads on HTTPS pages cannot be set from page-level JavaScript: `input.value` is read-only for `type=file`. Some ATSes appear to accept a JS-injected `DataTransfer` (the UI shows "Success!") but the backend silently rejects the file at submit. Playwright `connectOverCDP()` + `setInputFiles()` attaches at the browser level and bypasses the restriction entirely.

See [`docs/cdp-setup.md`](cdp-setup.md) for the Chrome launch procedure.
