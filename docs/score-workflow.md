# `/score` workflow

`node src/score/index.mjs <url>` fetches an offer, builds a prompt comparing it against your CV, calls `claude -p` in stripped mode, and appends a structured result to `data/evaluations.jsonl`.

## Entry point

```bash
node src/score/index.mjs <url>
```

## Flow

1. Run a deterministic prefilter on the URL (`src/score/prefilter.mjs`) — drop anything matching obvious skip patterns (wrong geography, wrong contract type).
2. Fetch the job description page (or ATS API if available).
3. Truncate the JD to a token budget (`src/lib/jd-truncate.mjs`).
4. Build the prompt (`src/score/prompt-builder.mjs`) using `config/cv.md` directly as the candidate profile — no separate `profile-condensed.md` file is involved.
5. Shell out to `claude -p <prompt>` from a temp directory with:
   - `--disable-slash-commands`
   - `--no-chrome`
   - `--strict-mcp-config`
   - `--setting-sources ""`
     These flags strip all Claude Code overhead (no MCP servers, no history, no auto-context), cutting the per-call cost from ~$0.14 to ~$0.03.
6. Parse the returned JSON and append a line to `data/evaluations.jsonl`.

## Prerequisites

- `claude` CLI in `$PATH` (the [Claude Code](https://claude.ai/code) CLI, signed in to an account with API access).
- `config/cv.md` filled in.
- `config/candidate-profile.yml` valid.

## Output line

```json
{
  "id": "042",
  "date": "2026-04-13",
  "company": "Example Co",
  "role": "ML Engineering Intern",
  "url": "https://jobs.lever.co/example/abc-123",
  "score": 7.8,
  "verdict": "apply",
  "reason": "Strong ML + Python match, 6-month internship Paris",
  "status": "Evaluated"
}
```

### Score scale and verdict

- `score` is on a **0-10 scale**, emitted by the LLM (10 = perfect match, ≥7 = good, <5 = weak).
- `verdict` ∈ `apply | skip` is **computed deterministically** by `src/score/index.mjs`, not by the LLM:
  `verdict = score >= profile.auto_apply_min_score ? 'apply' : 'skip'`
  (default threshold: `7` when `auto_apply_min_score` is absent from `config/candidate-profile.yml`).
- To change the bar for `apply`, edit `auto_apply_min_score` in your profile — no prompt change needed.

## Cost

~$0.03 per offer in stripped mode. Running `score` on a 30-offer pipeline costs ~$1.

## Batch mode

Score all unscored offers from the pipeline in parallel:

```bash
node src/score/index.mjs --batch --parallel 5
```

Reads `data/pipeline.md`, filters out offers already in `evaluations.jsonl`, and scores the remainder with N concurrent workers (default: 5). Each worker fetches the job page, runs the prefilter, calls `claude -p`, and appends the result.

Progress is logged to stderr:

```
[batch]  [3/25] ✓ Mistral AI — Research Intern          4.2 apply
[batch]  [4/25] ✗ Qonto — Backend Intern                skipped (prefilter: location)
```

Summary printed at the end:

```
[batch] Done: 22 scored, 2 filtered, 1 error (25 total)
[batch] Results: 14 apply, 8 skip
[batch] Time: 58s (5 parallel workers)
```

Individual errors don't abort the batch — failed offers are retried on the next `--batch` run.

With 5 workers, up to 5 headless Chromium instances may run simultaneously (~200MB each, ~1GB total). Lower with `--parallel 2` on memory-constrained machines.
