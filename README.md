# claude-apply

> End-to-end job application automation piloted by [Claude Code](https://claude.ai/code).

[![Test](https://github.com/LeoLaborie/claude-apply/actions/workflows/test.yml/badge.svg)](https://github.com/LeoLaborie/claude-apply/actions/workflows/test.yml)
[![No PII](https://github.com/LeoLaborie/claude-apply/actions/workflows/no-pii.yml/badge.svg)](https://github.com/LeoLaborie/claude-apply/actions/workflows/no-pii.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)

`claude-apply` is a toolkit for running your entire job search as a pipeline — **scan** ATS career pages, **score** offers with a small LLM call, and **apply** to them in a real browser, all orchestrated by Claude Code. The heavy lifting happens in deterministic JavaScript modules; Claude is only in charge of the loose, hard-to-script bits (reading the DOM, generating cover letters, deciding when to stop and ask).

## What it does

- **Scans** Lever / Greenhouse / Ashby career pages via their public APIs (zero LLM cost).
- **Filters** offers by keyword (`required_any`, `excluded_any` in `config/portals.yml`).
- **Scores** individual offers with a stripped-down `claude -p` call (~$0.03/offer) using your CV.
- **Applies** to offers in a real Chrome window via Chrome DevTools Protocol (CDP):
  - classifies form fields using label + name patterns,
  - fills text/email/select inputs (with React-safe setters),
  - uploads your CV via Playwright CDP (bypasses all page-level file restrictions),
  - optionally generates a cover letter,
  - submits, detects the confirmation page, updates your tracker.
- **Tracks** applications in `data/applications.md` and `data/apply-log.jsonl`.
- **Dashboards** everything to a self-contained `dashboard.html`.

## What it does not do

- **No headless scraping of logged-in accounts.** If an offer requires a login, claude-apply stops and asks you to sign in manually in the open Chrome tab.
- **No captcha solving.** Same — it stops and asks.
- **No lying on forms.** Cover letters and free-text answers are grounded strictly in your CV (`config/cv.md`).
- **No stealth / anti-bot evasion.** It runs in your own Chrome profile, as you.
- **No scraping of non-API career pages (v0.1).** Only Lever, Greenhouse, and Ashby are auto-scanned.

## Quickstart

```bash
git clone https://github.com/LeoLaborie/claude-apply.git
cd claude-apply
bash scripts/setup.sh
```

Then:

1. Edit `config/candidate-profile.yml` with your identity, availability, preferences.
2. Edit `config/cv.md` with your CV (markdown).
3. Edit `config/portals.yml` with the companies to scan.
4. Reload your shell (`source ~/.zshrc` or `~/.bashrc`).
5. Launch Chrome with CDP: `chrome-apply`.
6. Install the [claude-in-chrome](https://chromewebstore.google.com/) extension in that Chrome window.
7. From Claude Code: `/scan`, then `/score <url>`, then `/apply <url>`.

## Architecture

```
          ┌──────────────┐
          │  portals.yml │
          └──────┬───────┘
                 │
                 ▼
    ┌─────────────────────────┐        ┌───────────────────┐
    │  src/scan (Lever/GH/A)  │◄──────►│ scan-history.tsv  │
    └──────────┬──────────────┘        └───────────────────┘
               ▼
        data/pipeline.md
               │
               ▼
    ┌─────────────────────────┐        ┌───────────────────┐
    │  src/score (claude -p)  │───────►│ evaluations.jsonl │
    └──────────┬──────────────┘        └───────────────────┘
               ▼
     (human / agent triage)
               │
               ▼
    ┌─────────────────────────┐        ┌───────────────────┐
    │  src/apply (Chrome CDP) │◄──────►│  applications.md  │
    │    + /apply command     │        │  apply-log.jsonl  │
    └──────────┬──────────────┘        └───────────────────┘
               ▼
         dashboard.html
```

## Commands reference

| Command                          | Purpose                                                             |
| -------------------------------- | ------------------------------------------------------------------- |
| `node src/scan/index.mjs`        | Scan Group A ATSes; append new offers to `data/pipeline.md`.        |
| `node src/score/index.mjs <url>` | LLM-evaluate an offer; append to `data/evaluations.jsonl`.          |
| `node src/apply/upload-file.mjs` | CDP file upload helper (called by `/apply`).                        |
| `node src/dashboard/build.mjs`   | Regenerate `dashboard.html` from `data/` and `reports/`.            |
| `bash scripts/setup.sh`          | Interactive first-time setup (Chrome CDP profile + templates + rc). |
| `bash scripts/check-no-pii.sh`   | Grep the tree for personal data patterns (CI gate).                 |
| `npm test`                       | Run the node test suite.                                            |
| `/scan`                          | Claude Code slash command wrapping `node src/scan/index.mjs`.       |
| `/score <url>`                   | Claude Code slash command wrapping `node src/score/index.mjs`.      |
| `/apply <url>`                   | Claude Code orchestrator: open → classify → fill → upload → submit. |

## Configuration

All user data lives under `config/` and `data/` — both are `.gitignore`d. Templates live in `templates/` and are copied by `scripts/setup.sh` on first run.

- `config/candidate-profile.yml` — identity, availability, CV paths, preferences.
- `config/cv.md` — plain markdown CV used by `score` and cover-letter generation.
- `config/portals.yml` — companies to scan + title filter.
- `data/applications.md` — tracker (Markdown table).
- `data/pipeline.md` — inbox of new offers from `/scan`.
- `data/scan-history.tsv` — dedup source of truth.
- `data/evaluations.jsonl` — output of `/score`.
- `data/apply-log.jsonl` — output of `/apply`.

## For AI agents

**Read `CLAUDE.md` first.** It lays out the invariants (no PII in commits, no guessed values, stop on ambiguity), entry points, conventions, and where to find things.

See also `docs/for-agents.md` for typical workflows, patterns to follow, and anti-patterns to avoid.

## Supported ATS

| ATS                                       | Scanner    | Form fill | File upload | Notes                                                    |
| ----------------------------------------- | ---------- | --------- | ----------- | -------------------------------------------------------- |
| Lever                                     | ✅ auto    | ✅        | ✅ CDP      | Dedup by URL; blocks re-submission for ~3 months.        |
| Greenhouse                                | ✅ auto    | ✅        | ✅ CDP      | Splits first/last name; many optional subforms.          |
| Ashby                                     | ✅ auto    | ✅        | ✅ CDP      | `_systemfield_*` naming; custom questions are free text. |
| WTTJ                                      | ⚠️ partial | ✅        | ✅ CDP      | Aggregator — jumps to the real ATS in most cases.        |
| Workable                                  | ❌         | ✅        | ✅ CDP      | Scanner not shipped (requires auth for the public API).  |
| SmartRecruiters, Teamtailor, custom pages | ❌         | —         | —           | Manual fallback; PRs welcome (see `docs/extending.md`).  |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Short version: `npm test`, `bash scripts/check-no-pii.sh`, Conventional Commits, one logical change per PR.

## License

[MIT](LICENSE).

## Credits

`claude-apply` was bootstrapped from the private workspace driving the author's own internship search, and its `scan` / `score` / dashboard layers are inspired by and initially derived from [`santifer/career-ops`](https://github.com/santifer/career-ops) (MIT). The `apply` module, the CDP upload helper, the Claude Code commands, and the AI-agent documentation are original to this project.
