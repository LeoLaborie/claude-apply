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
- `npm run scan` / `npm run score <url>` / `npm run score:batch` / `npm run dashboard` — module entry points
- `npm run explain -- "<title>"` — trace why a title is accepted or filtered by the current config
- `npm run workday:seed` / `npm run workday:validate` — maintain the known-Workday-slugs registry

## First-time setup

**If `config/candidate-profile.yml` does not exist, the user is a first-time user — run `/apply-onboard`.** That slash command handles everything: CV PDF extraction, building `config/cv.md` + `candidate-profile.yml`, discovering ~30 target companies via WebSearch, and running `scripts/setup.sh` non-interactively with the right flags. Read `.claude/commands/apply-onboard.md` before starting. (The command is namespaced `apply-onboard` rather than `onboard` to avoid colliding with the `onboard` skill from the `frontend-design` plugin — see issue #35.)

The `/scan`, `/score`, and `/apply` commands each have a first-run guard that redirects the user to `/apply-onboard` if the config is missing. Do not try to work around the guard by copying templates manually.

`scripts/setup.sh` accepts `--yes`, `--clone-chrome-profile`, `--no-clone-chrome-profile`, and `--no-rc` for non-interactive runs. Run `bash scripts/setup.sh --help` for details. Re-running is always safe — every step is idempotent.

## Entry points

### Slash commands (`.claude/commands/`)

| Command                      | Contract                                                                                                                                      |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `/apply-onboard [cv.pdf]`    | First-run onboarding — extract CV, build `config/cv.md` + `candidate-profile.yml`, discover ~30 companies, run `scripts/setup.sh` non-interactively. Sub-commands: `:profile`, `:companies`, `:setup`. |
| `/add-company <name or URL>` | Discover and append a new company to `config/portals.yml` (wraps `src/scan/discover-company.mjs` + `add-company.mjs`).                        |
| `/scan`                      | `node src/scan/index.mjs` → appends new rows to `data/pipeline.md`; dedups via `scan-history.tsv`. Flags: `--dry-run`, `--only <slug>`, `--json`. |
| `/score <url>`               | Reads `config/cv.md`; appends one JSON line to `data/evaluations.jsonl`. Also supports `--batch` and `--from-pipeline` (mutually exclusive).  |
| `/explain "<title>"`         | Trace which prefilter rule accepts or rejects a given title. Flags: `--company <name>`, `--location <loc>`.                                   |
| `/tune-filter`               | Interactive calibration of `portals.yml` `title_filter` against cached `scan-history.tsv`. No network calls.                                  |
| `/apply <url>`               | Opens the URL in Chrome, classifies/fills the form, uploads the CV via CDP, submits, updates `data/applications.md` + `data/apply-log.jsonl`. |
| `/dashboard`                 | Rebuild `dashboard.html` from `data/` + `reports/`.                                                                                           |

All commands support `--help` / `-h` and have a first-run guard that redirects to `/apply-onboard` if `config/candidate-profile.yml` is missing.

### Modules (`src/`)

- `src/lib/` — shared utilities (YAML/TSV/JSONL I/O, pipeline-md writer, dedup, prefilter rules, title n-grams, load-profile, repo-root, extension permission probe, onboard state, portals writer, p-limit).
- `src/scan/` — ATS scanner: `index.mjs`, `ats-detect.mjs`, fetchers in `ats/` (Lever, Greenhouse, Ashby, Workable, Workday + `workday-slugs.mjs`), plus `add-company.mjs`, `discover-company.mjs`, `explain.mjs`, `tune-filter.mjs`, `fetch-offer-body.mjs`.
- `src/score/` — lightweight offer evaluator wrapping `claude -p` in stripped mode (`index.mjs`, `jd-truncate.mjs`, `location-extractor.mjs`, `prefilter.mjs`, `prompt-builder.mjs`).
- `src/apply/` — form classifier, language detector, confirmation detector, CDP upload helper, letter/cover-letter generator, apply-log writer, profile schema, React-select helper, DOM-label extractor, Workday step detector (`workday/`).
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

| Need                           | Location                                  |
| ------------------------------ | ----------------------------------------- |
| Architecture overview          | `docs/architecture.md`                    |
| `/apply` step-by-step          | `docs/apply-workflow.md`                  |
| `/scan` details                | `docs/scan-workflow.md`                   |
| `/score` details               | `docs/score-workflow.md`                  |
| CDP setup (Linux/macOS)        | `docs/cdp-setup.md`                       |
| ATS support matrix + gotchas   | `docs/ats-support.md`                     |
| ATS-specific apply playbooks   | `docs/playbooks/` (Greenhouse, Workday)   |
| Adding a new ATS               | `docs/extending.md`                       |
| Agent-specific guidance        | `docs/for-agents.md`                      |
| Running tests, E2E checklist   | `docs/testing.md`                         |
| Release notes & breaking changes | `CHANGELOG.md`                          |
| PII gate                       | `scripts/check-no-pii.sh`                 |
| User config                    | `config/` (ignored)                       |
| User data                      | `data/` (ignored)                         |
| Example persona                | `templates/candidate-profile.example.yml` |
