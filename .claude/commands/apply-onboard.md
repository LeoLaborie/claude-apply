---
description: First-time setup for claude-apply — extract the user's CV, build config files, discover ~30 target companies, and run setup.sh non-interactively
argument-hint: [path-to-cv.pdf]
---

# /apply-onboard $ARGUMENTS

You are guiding a **first-time user** through the end-to-end setup of `claude-apply`. This command is an **orchestrator**: it detects existing state, then chains three focused sub-skills in sequence. Each sub-skill is also a slash command and can be rerun independently if one phase fails.

| Phase | Sub-skill                  | Outputs                                                                    |
| ----- | -------------------------- | -------------------------------------------------------------------------- |
| 1     | `/apply-onboard:profile`   | `config/cv.md`, `config/cv.<lang>.pdf`, `config/candidate-profile.yml`     |
| 2     | `/apply-onboard:companies` | `config/portals.yml`                                                       |
| 3     | `/apply-onboard:setup`     | `node_modules/`, CDP Chrome profile, `chrome-apply` alias, Chrome on :9222 |

**Hard rules** (override any instinct to "just do it"):

- **Never invent PII.** Every field in `config/candidate-profile.yml` must come from the CV or an explicit user answer. `null` is always a valid answer.
- **Never commit anything.** Everything you write lives under `config/` or `data/`, both gitignored. No `git add`, no `git commit`.
- **Never write `portals.yml` without explicit user approval** of the final company list.
- **Stop on ambiguity.** Unreadable CV, contradictory answers, WebSearch returns nothing useful, login wall on a verified URL → stop and ask.

The sub-skills contain the detailed hard rules for their own phase. You must follow them fully.

## 0. Detect existing state

1. If `config/candidate-profile.yml` already exists, ask the user: "An existing profile was found. Do you want to (a) **abort** and keep it, (b) **rerun onboarding and overwrite** it, or (c) **only regenerate `portals.yml`**?"
   - **(a) abort** → stop here.
   - **(b) rerun** → run all three phases below.
   - **(c) portals only** → skip phase 1, run phase 2, then skip phase 3 (Chrome is already set up from a previous run). If `node_modules/` is missing, run `bash scripts/setup.sh --yes --no-clone-chrome-profile` first.
2. If `config/candidate-profile.yml` does **not** exist, run all three phases.

## 1. Phase 1 — profile (`/apply-onboard:profile`)

Follow the instructions in `.claude/commands/apply-onboard/profile.md` end-to-end. Pass `$ARGUMENTS` through as the CV path if the user provided one.

Phase 1 writes `config/cv.md`, `config/cv.<lang>.pdf`, `config/candidate-profile.yml`, and `data/.onboard-state.json`. Do not proceed until the profile validates against `validateProfile`.

## 2. Phase 2 — companies (`/apply-onboard:companies`)

Follow the instructions in `.claude/commands/apply-onboard/companies.md` end-to-end.

Phase 2 reads `data/.onboard-state.json` for the user's job-type and domain answers, builds `title_filter`, runs WebSearch + `verifyCompany`, gets the user's approval on the final list, and writes `config/portals.yml`. Do not proceed until the file is written.

## 3. Phase 3 — setup (`/apply-onboard:setup`)

Follow the instructions in `.claude/commands/apply-onboard/setup.md` end-to-end.

Phase 3 runs `scripts/setup.sh`, launches Chrome in CDP mode, and prints the extension install + host permission instructions. It ends with the final summary — do **not** run `/scan` or `/apply` yourself afterwards.

## Absolute rules (recap)

- **One question block per phase** — never pepper the user with follow-ups.
- **Approve before writing `portals.yml`** — always.
- **Validate the profile** before writing it — never write an invalid YAML.
- **Never guess PII** — `null` is always a valid answer.
- **Never `git commit`** — `config/` and `data/` are gitignored on purpose.
- **Stop on ambiguity** — login wall on an ATS URL during verification, unreadable PDF, contradictory answers → stop and ask.
