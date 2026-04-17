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

Detect the language from the CV content (usually `fr` or `en`) and copy the source PDF to `config/cv.<lang>.pdf`. Use this absolute path as `cv_fr_path` or `cv_en_path` later.

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
  - `edit` — "Re-ask all four"

Behaviour:

- `confirm` → the extracted values are locked. Treat them as already-answered for step 3.
- `edit` → reset **all four** extracted values to `null`. Step 3 will re-ask the entire "Job search" sub-block. (Per-field correction is intentionally not offered — the all-or-nothing reset keeps the UX one click and reuses step 3 verbatim.)

If step 1 extracted **zero** of the four fields, skip this section entirely and go straight to step 3.

## 3. One question block

Use **`AskUserQuestion`** once with everything you could not extract, grouped logically. Do not loop back with follow-ups unless the user's answer is internally inconsistent.

**Job search** (skip the entire sub-block if step 2.5 confirmed all four fields. Otherwise, only include the bullets whose value is still `null`.)

- **Job type**: internship / apprenticeship / entry-level / mid-level / senior / other
- **Target start date** (ISO date)
- **Duration** (if internship/apprenticeship): months
- **Target role / domain keywords**: free text — drives both `title_filter` and company discovery (phase 2). Example: "AI/ML engineering", "backend Python", "devtools".

**Location & remote**

- **Locations**: cities or regions, comma-separated
- **Remote preference**: onsite / hybrid / remote

**Admin**

- **Date of birth** (may skip if user refuses)
- **Nationality**
- **Work authorization** — free text (e.g. "EU citizen — no sponsorship needed")
- **Requires visa sponsorship**: yes / no

**Setup choices** (used later by `/apply-onboard:setup`)

- **Clone your existing Chrome profile** into the CDP profile? yes / no
- **Cover letter auto-generation**: enable now? yes / no (default no)

Anything the user declines → `null`.

## 4. Ensure npm dependencies are installed

The schema validator and the YAML writer need `node_modules`. Install lightly if missing — `/apply-onboard:setup` runs the full `scripts/setup.sh` later and will skip the install since it is idempotent:

```bash
[[ -d node_modules ]] || npm install
```

## 5. Write `config/candidate-profile.yml`

Assemble one **flat** YAML file — no nested `identity:` / `address:` / `availability:` subtrees. Every field at the top level. The schema is defined in `src/lib/candidate-profile.schema.mjs` — read it for the exact required and optional keys.

Sources:

- Extracted from the CV: `first_name`, `last_name`, `email`, `phone`, `linkedin_url`, `github_url`, `city`, `country`, `school`, `degree`, `graduation_year`, `education[]`, `experiences[]`, `languages[]`.
- From the question block: `availability_start`, `internship_duration_months`, `work_authorization`, `requires_sponsorship`, `auto_apply_min_score`, optionally `blacklist_companies` and `min_start_date`.
- From step 2: `cv_fr_path` and `cv_en_path`.
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
  "clone_chrome_profile": true
}
```

## 7. Done

Report briefly: `config/cv.md`, `config/cv.<lang>.pdf`, `config/candidate-profile.yml`, `data/.onboard-state.json` written and validated. If you were called from the `/apply-onboard` orchestrator, control returns there. Otherwise tell the user to run `/apply-onboard:companies` next.
