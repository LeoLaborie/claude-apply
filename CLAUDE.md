# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## Big picture

The three stages are independent and communicate only via files in `data/`: `scan` writes `pipeline.md`, `score` reads a URL and appends to `evaluations.jsonl`, `apply` reads a URL and writes `applications.md` + `apply-log.jsonl`. No shared in-memory state, no DB — everything is resumable by re-reading the files. `/apply` additionally requires a running Chrome launched via the `chrome-apply` alias (CDP on port 9222) with the `claude-in-chrome` extension installed; without it, the browser tools will fail.

## Common commands

- `npm test` — full suite (`node --test tests/**/*.test.mjs`)
- `node --test tests/path/to/file.test.mjs` — single test file
- `node --test --test-name-pattern="<regex>" tests/**/*.test.mjs` — single test by name
- `npm run test:watch` — watch mode
- `npm run lint` / `npm run format` — Prettier check / write
- `npm run check:pii` — PII gate (run locally before pushing)
- `npm run scan` / `npm run score <url>` / `npm run dashboard` — module entry points

## First-time setup (what the agent must do)

If the user is running the project for the first time (no `config/candidate-profile.yml`, no `node_modules`, or `chrome-apply` alias missing), **do not silently run commands** — the setup writes to the shell rc file and can clone the user's Chrome profile. Walk through it explicitly:

1. **Run `bash scripts/setup.sh`.** It is idempotent. It will, in order:
   - Check prereqs via `scripts/check-prereqs.sh` (Node 20+, Chrome, etc.). If it fails, stop and report the missing tool — do not try to install it for the user.
   - `npm ci` (or `npm install` if no lockfile) when `node_modules` is absent.
   - Create a dedicated Chrome CDP profile at `~/.config/google-chrome-claude-apply` (Linux) or `~/Library/Application Support/Google/Chrome-claude-apply` (macOS). **This step is interactive** — it asks `y/N` whether to clone the user's default Chrome profile (cookies, extensions). Do not answer for the user; let them type it. If running non-interactively, warn them that the script will block.
   - Append an `alias chrome-apply='…'` to `~/.zshrc` or `~/.bashrc` (with a timestamped backup). If neither rc exists, print the alias and ask the user to add it manually.
   - Copy templates from `templates/` to `config/` and `data/` (only if the destination is missing) — `candidate-profile.yml`, `cv.md`, `portals.yml`, `applications.md`.
2. **Tell the user to edit the four config files** before doing anything else: `config/candidate-profile.yml`, `config/cv.md`, `config/portals.yml`, and optionally `data/applications.md`. Do not guess or pre-fill values — especially not PII (see invariants). The only allowed example persona is "Alice Martin" and it belongs in `templates/`, not `config/`.
3. **Have the user reload their shell** (`source ~/.zshrc` or `source ~/.bashrc`) — a new Claude Code session may not pick up the alias otherwise.
4. **Have the user launch `chrome-apply` themselves** in their own terminal. It is a GUI process that must keep running; do not background it from an agent session. Remind them to install the [claude-in-chrome](https://chromewebstore.google.com/) extension in that Chrome window if they have not already.
5. **Verify before `/apply`**: run `node src/scan/index.mjs --dry-run` to confirm scan works without network writes, and confirm `mcp__claude-in-chrome__tabs_context_mcp` returns tabs (meaning the extension is reachable). If either fails, stop and diagnose — do not jump to `/apply`.
6. **Only then** run `/scan`, `/score <url>`, `/apply <url>` in that order.

If any step above is already done (e.g., `node_modules` present, alias already in rc), `setup.sh` will skip it and say so — re-running is safe.

## Entry points

### Slash commands (`.claude/commands/`)

| Command        | Contract                                                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `/scan`        | `node src/scan/index.mjs` → appends new rows to `data/pipeline.md`; dedups via `scan-history.tsv`.                                            |
| `/score <url>` | Reads `config/cv.md`; appends one JSON line to `data/evaluations.jsonl`.                                                                      |
| `/apply <url>` | Opens the URL in Chrome, classifies/fills the form, uploads the CV via CDP, submits, updates `data/applications.md` + `data/apply-log.jsonl`. |

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
- **No comments unless the _why_ is non-obvious.** Good names beat comments.
- **Errors.** Typed error classes (see `UploadError` in `upload-file.mjs`). Never swallow errors silently.

## Where to find what

| Need                         | Location                                  |
| ---------------------------- | ----------------------------------------- |
| Architecture overview        | `docs/architecture.md`                    |
| `/apply` step-by-step        | `docs/apply-workflow.md`                  |
| `/scan` details              | `docs/scan-workflow.md`                   |
| `/score` details             | `docs/score-workflow.md`                  |
| CDP setup (Linux/macOS)      | `docs/cdp-setup.md`                       |
| ATS support matrix + gotchas | `docs/ats-support.md`                     |
| Adding a new ATS             | `docs/extending.md`                       |
| Agent-specific guidance      | `docs/for-agents.md`                      |
| Running tests, E2E checklist | `docs/testing.md`                         |
| PII gate                     | `scripts/check-no-pii.sh`                 |
| User config                  | `config/` (ignored)                       |
| User data                    | `data/` (ignored)                         |
| Example persona              | `templates/candidate-profile.example.yml` |
