# `/scan` workflow

`node src/scan/index.mjs` scans Group A career pages (Lever, Greenhouse, Ashby) via their public APIs, filters by keyword, dedups against history and applications, and writes new offers to `data/pipeline.md`.

## Entry point

```bash
node src/scan/index.mjs [--dry-run] [--only <slug>] [--json]
```

## Flow

1. Load `config/portals.yml`.
2. For each company with a `careers_url`:
   - Call `atsDetect(url)` → `{ platform, slug }` or `null`.
   - If `platform` is unsupported, skip with a warning.
   - Fetch the company's open jobs via the platform's public API.
3. For each raw job, run `title_filter` (`required_any` + `excluded_any`).
4. Dedup against `data/scan-history.tsv` and `data/applications.md`.
5. Append new rows to `data/pipeline.md` and to `scan-history.tsv`.
6. Rejected rows (title_filter) go to `data/filtered-out.tsv`.

## Supported ATSes

| Platform   | URL pattern                       | API endpoint                                                                    |
| ---------- | --------------------------------- | ------------------------------------------------------------------------------- |
| Lever      | `jobs.lever.co/<slug>`            | `https://api.lever.co/v0/postings/<slug>?mode=json`                             |
| Greenhouse | `job-boards.greenhouse.io/<slug>` | `https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true`           |
| Ashby      | `jobs.ashbyhq.com/<slug>`         | `https://api.ashbyhq.com/posting-api/job-board/<slug>?includeCompensation=true` |

A URL that doesn't match these patterns is skipped silently. To add a new ATS, see [`docs/extending.md`](extending.md).

## Title filter

`portals.yml.title_filter.positive` / `negative` are whole-word regexes matched against the job **title**. `required_any` is a domain filter matched against the **job title only**: at least one keyword must appear in the title. This ensures non-tech roles at tech companies (e.g. "General Secretary Associate intern") are filtered out even when their descriptions mention tech terms casually. Use `skip_required_any: true` per company to bypass this filter for ATS portals whose job titles do not include the domain keyword (e.g. Mistral AI, where the company name alone implies the domain).

Example:

```yaml
title_filter:
  required_any:
    - Intern
    - Internship
    - Stage
    - Stagiaire
  excluded_any:
    - Senior
    - Manager
```

### Per-company override: `skip_required_any`

For companies where the domain is implicit in the name (e.g. Mistral AI, DeepMind), the `required_any` filter can be bypassed per-company:

```yaml
tracked_companies:
  - name: Mistral AI
    careers_url: https://jobs.lever.co/mistral
    skip_required_any: true
```

When set, `positive` and `negative` filters still apply — only `required_any` is skipped.

### Per-company override: `target_locations`

For companies where the acceptable locations differ from your global preference (e.g. a remote-first employer where "Berlin" is de-facto Remote, or a dream company where you'd accept a specific foreign city), declare a per-company `target_locations` array:

```yaml
tracked_companies:
  - name: DeepMind
    careers_url: https://boards.greenhouse.io/deepmind
    target_locations:
      - London
      - Remote
      - France
```

Semantics:

- **Key absent** → the global `target_locations` from `candidate-profile.yml` applies (default, unchanged behavior).
- **Array present** → strict override; the global list is ignored for this company.
- **Empty array `[]`** → treated as a deliberate strict override with zero accepted locations — every offer is rejected on the location check. Omit the key instead if you want the global fallback.

## Deduplication

`data/scan-history.tsv` is the source of truth. Every offer ever seen is recorded with its URL, title, company, and `first_seen` timestamp. On subsequent scans, known URLs are dropped before writing anything. `data/applications.md` is also consulted — if you already tracked an offer (manually or via `/apply`), it won't be re-added to the pipeline.

## Output example

```
[mistral]      42 raw  →  3 pass filter  →  1 new
[anthropic]    28 raw  →  2 pass filter  →  0 new
[photoroom]    11 raw  →  0 pass filter  →  0 new

Summary: 81 raw, 5 after filter, 1 new.
Written 1 row to data/pipeline.md.
```

## Flags

- `--dry-run` — compute everything, write nothing.
- `--only <slug>` — restrict to one company by ATS slug (e.g. `--only mistral`).
- `--json` — machine-readable summary on stdout.

## Cost

Zero LLM calls. Scans are bounded by HTTP latency (~5–20 s for 8 companies).
