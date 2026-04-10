# CLAUDE.md

Instructions for Claude Code (and other LLM agents) working in this repository.

## What this project is

`claude-apply` is an end-to-end job application pipeline — scan ATSes, score offers with a lightweight LLM call, and fill/submit forms in a real Chrome window via CDP. The repository ships code, Claude Code slash commands, and docs; users supply their own CV, profile, and target companies under `config/` and `data/` (both `.gitignore`d).

## Invariants (read before every task)

- **Never commit personal data.** No real names, emails, phone numbers, address, company applications, or CV contents. The only allowed example persona is "Alice Martin" in `templates/`. The PII gate (`scripts/check-no-pii.sh`) runs in CI — if you break it, the PR is blocked.
- **Never solve a captcha, bypass a login, or evade anti-bot measures.** If `/apply` encounters any of these, it must stop and ask the user.
- **Never submit an application without a filled-in, verified required field.** Guessed EEO values are also forbidden — use the explicit profile value or `Prefer not to say`.
- **Never invent experience** in cover letters or free-text answers. Ground everything in `config/cv.md` and `config/candidate-profile.yml`.
- **Default to `Submitted (unconfirmed)`** if confirmation detection is ambiguous. Writing `Applied` requires a matched success text or URL.
- **Stop on ambiguity.** Login wall, captcha, unknown required field, unrecognized multi-step page → stop, surface what you see, ask.

## Entry points

### Slash commands (`.claude/commands/`)

| Command         | Contract                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------- |
| `/scan`         | `node src/scan/index.mjs` → appends new rows to `data/pipeline.md`; dedups via `scan-history.tsv`. |
| `/score <url>`  | Reads `config/cv.md`; appends one JSON line to `data/evaluations.jsonl`.                       |
| `/apply <url>`  | Opens the URL in Chrome, classifies/fills the form, uploads the CV via CDP, submits, updates `data/applications.md` + `data/apply-log.jsonl`. |

### Modules (`src/`)

- `src/lib/` — shared utilities (YAML/TSV/JSONL I/O, pipeline-md writer, dedup, prompt builder).
- `src/scan/` — ATS scanner (`ats-detect.mjs` + fetchers in `ats/`).
- `src/score/` — lightweight offer evaluator wrapping `claude -p` in stripped mode.
- `src/apply/` — form classifier, language detector, confirmation detector, CDP upload helper, letter generator, apply-log writer, profile schema.
- `src/dashboard/` — self-contained HTML generator from `data/` + `reports/`.

## Conventions

- **ESM only.** All files are `.mjs`. `package.json` has `"type": "module"`.
- **Node 20+.** Use stable built-ins (`node:fs`, `node:test`, `node:http`, Web `fetch`).
- **Tests.** `node --test tests/**/*.test.mjs`. New code needs tests before merge. Prefer pure functions with fixture-driven tests; use Playwright CDP only where truly necessary (upload + integration).
- **Style.** Prettier default, 2-space indent, single quotes, trailing commas. `npm run lint` and `npm run format`.
- **Commits.** [Conventional Commits](https://www.conventionalcommits.org/) (`feat(scope): …`, `fix(scope): …`, `docs: …`, `test: …`, `chore: …`).
- **No comments unless the *why* is non-obvious.** Good names beat comments.
- **Errors.** Typed error classes (see `UploadError` in `upload-file.mjs`). Never swallow errors silently.

## Where to find what

| Need                             | Location                                |
| -------------------------------- | --------------------------------------- |
| Architecture overview            | `docs/architecture.md`                  |
| `/apply` step-by-step            | `docs/apply-workflow.md`                |
| `/scan` details                  | `docs/scan-workflow.md`                 |
| `/score` details                 | `docs/score-workflow.md`                |
| CDP setup (Linux/macOS)          | `docs/cdp-setup.md`                     |
| ATS support matrix + gotchas     | `docs/ats-support.md`                   |
| Adding a new ATS                 | `docs/extending.md`                     |
| Agent-specific guidance          | `docs/for-agents.md`                    |
| Running tests, E2E checklist     | `docs/testing.md`                       |
| PII gate                         | `scripts/check-no-pii.sh`               |
| User config                      | `config/` (ignored)                     |
| User data                        | `data/` (ignored)                       |
| Example persona                  | `templates/candidate-profile.example.yml` |
