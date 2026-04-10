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
4. Build the prompt (`src/lib/prompt-builder.mjs`) using `config/cv.md` + `config/candidate-profile.yml`.
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
  "url": "https://jobs.lever.co/example/abc-123",
  "company": "Example Co",
  "role": "ML Engineering Intern",
  "score": 0.78,
  "verdict": "apply",
  "reasoning": "Strong match on ML systems + Python; internship-friendly, 6-month duration, Paris.",
  "timestamp": "2026-04-10T13:00:00.000Z"
}
```

`verdict` ∈ `apply | maybe | skip`.

## Interpreting results

- **`apply`** with `score > 0.7` → good candidates. Run `/apply <url>`.
- **`maybe`** or `score` in `[0.4, 0.7]` → read the `reasoning` before deciding.
- **`skip`** → the prefilter or LLM found a dealbreaker; move on.

## Cost

~$0.03 per offer in stripped mode. Running `score` on a 30-offer pipeline costs ~$1.
