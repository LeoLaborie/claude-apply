---
description: Evaluate a job offer URL against config/cv.md using a lightweight LLM call
argument-hint: <job-url>
---

# /score $ARGUMENTS

Fetch the offer at `$ARGUMENTS`, build a prompt that compares it against `config/cv.md` + `config/candidate-profile.yml`, and append the structured result to `data/evaluations.jsonl`.

## Prerequisites

- `config/cv.md` is filled with your real CV.
- `config/candidate-profile.yml` is valid.
- `claude` CLI is on your `PATH` (the Anthropic Claude Code CLI). The script uses `claude -p` in stripped mode.

## Run

```bash
node src/score/index.mjs $ARGUMENTS
```

## Output

Appends one JSON line to `data/evaluations.jsonl`:

```json
{
  "url": "...",
  "company": "...",
  "role": "...",
  "score": 0.78,
  "verdict": "apply | skip | maybe",
  "reasoning": "...",
  "timestamp": "2026-04-10T13:00:00.000Z"
}
```

## Flags

- The script inherits the upstream flags from `career-ops` — check `node src/score/index.mjs --help` if more are needed.

## Cost

~$0.03 per offer when using the stripped `claude -p` mode (~$0.14 otherwise). The script runs from a temp directory with `--disable-slash-commands --no-chrome --strict-mcp-config --setting-sources ""` to avoid Claude Code overhead.

## Next step

If `verdict === "apply"`, run `/apply <url>` to start the automated application flow.
