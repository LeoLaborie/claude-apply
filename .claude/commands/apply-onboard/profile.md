---
description: Onboarding phase 1 — extract CV, ask the user the missing fields, and write config/cv.md + config/candidate-profile.yml
argument-hint: [path-to-cv.pdf]
---

# /apply-onboard:profile $ARGUMENTS

You are running **phase 1 of onboarding**: build the candidate profile. At the end of this skill, `config/cv.md`, `config/cv.<lang>.pdf`, and `config/candidate-profile.yml` exist and validate against the schema.

**Hard rules**

- **Never invent PII.** Every field must come from the CV or an explicit user answer. Unknown → `null`.
- **Never `git commit`.** Everything you write is under `config/` (gitignored).
- **Stop on ambiguity.** Unreadable PDF, contradictory answers, wrong path → stop and ask.

This skill can be run standalone or from the `/apply-onboard` orchestrator. It is idempotent — rerunning overwrites.

## 1. Locate the CV PDF

If `$ARGUMENTS` is a path to an existing PDF, use it. Otherwise ask:

> "Please provide the absolute path to your CV PDF (or drop the file in the conversation). I'll extract everything I can from it."

Verify the file exists and is a PDF, then read it with the `Read` tool (Claude Code reads PDFs natively). Extract:

- **Identity**: first name, last name, email, phone, LinkedIn URL, GitHub URL, personal website.
- **Address**: city (country only if explicit).
- **Education**: each entry with school, degree, field, start, end, graduation year, 1-line description.
- **Experiences**: each entry with company, title, start, end, description (3–5 lines max).
- **Languages**: list with `{code, level}` — levels in CEFR (A1…C2) or `native`.
- **Job-search header** — extract these four fields **only if the CV states them explicitly**. Vague phrasing ("looking for opportunities", "available soon", "open to relocation") does NOT count — leave the field `null` and let step 3 ask the user.
  - `job_type` — one of `internship | apprenticeship | entry-level | mid-level | senior | other`. Map common synonyms (`stage` → `internship`, `alternance` → `apprenticeship`). No clear match → `null`.
  - `target_start` — ISO date `YYYY-MM-DD`. If the CV gives only a month (`September 2026`), normalize to the first of that month (`2026-09-01`). Seasons (`fall 2026`) or vague phrases (`as soon as possible`) → `null`.
  - `duration_months` — integer, only set if `job_type` is `internship` or `apprenticeship`. `6 months`, `6-month`, `semestre` → `6`. Ranges (`4–6 months`) → `null`.
  - `target_role` — short free-text domain phrase. Extract from a clear "looking for X" / "seeking Y" / role headline. A bare job title with no domain framing → `null`.

Hold these four extracted values (and their `null`s) in mind for step 2.5.

Anything genuinely missing becomes a question in step 3.

## 2. Write `config/cv.md` and copy the PDF

Create `config/cv.md` as a clean markdown version of the CV. This file is read by `/score` and the cover-letter generator — faithful to the PDF, flowing markdown (no tables, `##` for sections). Do not paraphrase or embellish.

Copy the source PDF to `config/cv.pdf`. Record this as a **repo-relative path** (`cv_path: config/cv.pdf`) so the profile stays portable between machines. Absolute and `~/`-prefixed paths are also accepted if the user already stores their CV elsewhere.

## 2.5. Confirm extracted job-search fields

If step 1 extracted **at least one** of the four job-search fields (`job_type`, `target_start`, `duration_months`, `target_role`), show this confirmation **before** the step-3 question block:

Use `AskUserQuestion` with a single question:

- **Question header (in the body)**: `I extracted these from your CV. Confirm or edit?`
- **Body** — one line per field. Use the extracted value if set, or `<not found>` for `null`:

  ```
  - Job type:      <value or "<not found>">
  - Target start:  <value or "<not found>">
  - Duration:      <value or "<not found>" — only show this line if job_type is internship/apprenticeship>
  - Target role:   <value or "<not found>">
  ```

- **Options**:
  - `confirm` — "Use these values"
  - `edit all` — "Re-ask all four"
  - `edit missing only` — "Only re-ask fields that came back `<not found>`" _(show this option only when at least one of the four extracted fields is `null`; hide it otherwise)_

Behaviour:

- `confirm` → the extracted values are locked. Treat them as already-answered for step 3.
- `edit all` → reset **all four** extracted values to `null`. Step 3 will re-ask the entire "Job search" sub-block.
- `edit missing only` → keep non-null extracted values; reset to `null` **only** the fields that came back `<not found>`. Step 3 will re-ask just those.

If step 1 extracted **zero** of the four fields, skip this section entirely and go straight to step 3.

## 3. Question blocks (up to 3, plus one conditional)

Use **`AskUserQuestion`** up to **3** times, grouping questions logically (Block A job search / Block B location+admin / Block C setup+scoring). A 4th call (Block D) is only allowed to fill required fields missing from the CV. Never loop back with follow-ups unless the user's answer is internally inconsistent.

Each `AskUserQuestion` call accepts at most 4 questions.

**Block A — Job search** (skip the entire block if step 2.5 confirmed all four fields; otherwise include only the bullets whose value is still `null`; max 4 questions total)

- **Job type**: internship / apprenticeship / entry-level / mid-level / senior / other
- **Target start date** (ISO date)
- **Duration** (if internship/apprenticeship): months
- **Target role / domain keywords**: free text — drives both `title_filter` and company discovery (phase 2). Example: "AI/ML engineering", "backend Python", "devtools".

**Block B — Location + admin core** (4 questions)

- **Locations**: cities or regions, comma-separated
- **Remote preference**: onsite / hybrid / remote
- **Work authorization** — free text (e.g. "EU citizen — no sponsorship needed")
- **Requires visa sponsorship**: yes / no

**Block C — Setup + scoring** (up to 4 questions)

- **Auto-apply minimum score** (drives `/apply --auto`): options `6` / `7` / `8`, default `7`. Stored as `auto_apply_min_score`.
- **Clone your existing Chrome profile** into the CDP profile? yes / no.
  - `yes`: copies cookies, sessions, and extensions from your current Chrome profile — you stay logged in to ATSes and keep your existing extensions.
  - `no`: starts from scratch — every ATS will ask you to log in once.
- **Cover letter auto-generation**: yes / no (default no). Stored as `auto_generate_cover_letter` in both `candidate-profile.yml` and `.onboard-state.json`.
- **Date of birth** (optional — may skip).

`nationality` is no longer asked in Block C; set it to `null` by default (users can fill it later if a specific form requires it).

**Block D — Required fields missing from CV** (conditional; skipped if all extracted; at most 2 questions)

Trigger when **at least one** of `city`, `graduation_year` is `null` after extraction.

- **City**: _"Your CV didn't state a residential city. Please provide one (used for form pre-fill on Workday/Greenhouse)."_
- **Graduation year**: _"Your CV didn't state a graduation year. Based on your degree start year N, a typical 5-year cycle ends in N+5 — correct? Or enter a different year."_

Anything the user declines in optional fields → `null`. Required fields for `candidate-profile.yml` (city, graduation_year, work_authorization, requires_sponsorship, auto_apply_min_score) cannot be skipped — if the user refuses, stop and ask again clearly. Note: `locations` and `remote_preference` are required for `.onboard-state.json` (not `candidate-profile.yml`) and are collected in step 2.5.

## 4. Ensure npm dependencies are installed

The schema validator and the YAML writer need `node_modules`. Install lightly if missing — `/apply-onboard:setup` runs the full `scripts/setup.sh` later and will skip the install since it is idempotent:

```bash
[[ -d node_modules ]] || npm install
```

## 5. Write `config/candidate-profile.yml`

Assemble one **flat** YAML file — no nested `identity:` / `address:` / `availability:` subtrees. Every field at the top level. The schema is defined in `src/lib/candidate-profile.schema.mjs` — read it for the exact required and optional keys.

Sources:

- Extracted from the CV: `first_name`, `last_name`, `email`, `phone`, `linkedin_url`, `github_url`, `city`, `country`, `school`, `degree`, `graduation_year`, `education[]`, `experiences[]`, `languages[]`.
- From the question blocks: `availability_start`, `internship_duration_months` (only when `job_type` is internship/apprenticeship), `work_authorization`, `requires_sponsorship`, `auto_apply_min_score`, `auto_generate_cover_letter`, `date_of_birth`, optionally `blacklist_companies` and `min_start_date`.
- From step 2: `cv_path`.
- EEO fields default to `null` unless explicitly provided: `gender`, `ethnicity`, `veteran_status`, `disability_status`.

Do NOT write `config/profile.yml` or `config/profile-condensed.md` — those files are no longer read by any command (`/score` reads `config/cv.md` directly).

Validate before writing by importing `validateProfile` from `src/lib/candidate-profile.schema.mjs` and running it on the in-memory object. If `ok: false`, show the errors, ask for the missing/invalid fields, retry — never write an invalid profile.

## 6. Persist onboarding state for the next phase

Write the job-search answers to `data/.onboard-state.json` so `/apply-onboard:companies` and `/apply-onboard:setup` can pick them up without re-asking. `data/` is gitignored.

```json
{
  "job_type": "internship|apprenticeship|entry-level|mid-level|senior|other",
  "target_role": "free-text domain keywords",
  "locations": ["Paris", "Remote EU"],
  "remote_preference": "onsite|hybrid|remote",
  "clone_chrome_profile": true,
  "auto_generate_cover_letter": false
}
```

## 7. Done

Report briefly: `config/cv.md`, `config/cv.<lang>.pdf`, `config/candidate-profile.yml`, `data/.onboard-state.json` written and validated. If you were called from the `/apply-onboard` orchestrator, control returns there. Otherwise tell the user to run `/apply-onboard:companies` next.
