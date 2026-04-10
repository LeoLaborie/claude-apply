# For AI agents

This document is specifically for LLM agents (Claude Code, Cursor, Aider, Copilot agents) driving `claude-apply`. If you are a human, you can still read it, but [`README.md`](../README.md) is more ergonomic.

## Before you do anything

1. Read [`CLAUDE.md`](../CLAUDE.md). It is short and lists hard invariants.
2. Read the relevant workflow doc: [`apply-workflow.md`](apply-workflow.md), [`scan-workflow.md`](scan-workflow.md), or [`score-workflow.md`](score-workflow.md).
3. **Never run `/apply` without the user's explicit consent for that specific URL.** Applying to a job is an irreversible social action.

## Typical workflows

### Daily pipeline

```
1. /scan                      # append new offers to data/pipeline.md
2. For each new offer:        # user or agent triage
     /score <url>
3. For each offer with verdict=apply AND user-approved:
     /apply <url>
```

### Triaging by hand

Open `data/pipeline.md` and pick offers. Score a subset, then apply to the ones the user explicitly picks.

### Recovering a failed apply

1. Check `data/apply-log.jsonl` — last entry's `finalStatus` and `errors` show why it failed.
2. Open the GIF recording at the path in the log entry.
3. Reproduce in a fresh tab via `chrome-apply`.
4. If the issue is in `src/apply/*`, write a test that captures the bug first (see [`docs/testing.md`](testing.md)).

## Patterns to follow

- **Verify after every write to a form.** Read the field back (`element.value`, `element.checked`, `input.files[0].name`) before moving on.
- **Stop and ask on ambiguity.** The user pays ~0 when you ask; they pay a lot when you guess wrong on a real application.
- **Prefer deterministic code over LLM calls** when a pattern is stable. The `field-classifier` is rules for a reason — it costs $0 and is easier to debug than a prompt.
- **Quote exact strings** when reporting to the user. "I see `Please attach a resume` at the top of the form" is better than "there's an error about the CV".
- **Use Conventional Commits.** `feat(apply): handle <new case>`, `fix(scan): lever title filter regex`, `test(apply): add greenhouse fixture`.

## Anti-patterns to avoid

- **Don't silently retry after a failure.** Log the first failure, diagnose, then retry once if appropriate.
- **Don't hardcode URLs, company names, paths, or personal data.** Everything user-specific goes in `config/` or `data/`. See the PII gate.
- **Don't catch errors to "make the test pass".** The test is telling you something — fix the root cause.
- **Don't add dependencies casually.** Node standard library first. `js-yaml` and `playwright` are the only runtime deps and that's the bar.
- **Don't create documentation files the user didn't ask for.** Work from conversation context.
- **Don't narrate what you're thinking.** Tool calls + short status updates are enough. Match the user's energy.

## When you get stuck

Small, reproducible experiments beat big plans:

1. Write the smallest script that reproduces the bug.
2. Put it in `tests/` as a failing test.
3. Fix the code until the test passes.
4. Commit the test + fix together.

For `/apply` bugs specifically, the failing "test" is often a fixture HTML file under `tests/fixtures/apply/`. Add a new fixture that mimics the real form, wire it into `integration.test.mjs`, iterate locally.
