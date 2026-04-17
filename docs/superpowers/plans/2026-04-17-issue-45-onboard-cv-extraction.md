# Issue #45 — `/apply-onboard:profile` CV-extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `/apply-onboard:profile` from re-asking the user for `job_type`, `target_start`, `duration_months`, and `target_role` when those values are explicit in the CV.

**Architecture:** Edit the prompt file `.claude/commands/apply-onboard/profile.md`. Extend the step-1 extraction list to include the four job-search fields, insert a new step 2.5 that confirms the extracted values via a single `AskUserQuestion`, and modify step 3 to skip the "Job search" sub-block for fields that are already known. No code, schema, or fixture changes.

**Tech Stack:** Markdown (Claude Code slash-command prompt). Verification commands: `npm run lint`, `npm test`, `cat`/`grep` for the prompt file.

**Spec:** `docs/superpowers/specs/2026-04-17-issue-45-onboard-cv-extraction-design.md`

**Note on TDD:** This plan modifies a prompt file consumed by an LLM, not executable code. There is no unit-test harness for prompt behaviour. The TDD red/green cycle is replaced by (a) targeted re-reads of the modified file to confirm the textual change is exact, and (b) a final `npm test` regression check to catch any accidental damage to neighbouring code paths.

---

## File Structure

**Modified files:**

- `.claude/commands/apply-onboard/profile.md` — single file. All four tasks edit it.

**Created files:** none.

**Test files:** none. (See note above.)

---

## Task 1: Extend step-1 extraction list with the four job-search fields

**Files:**

- Modify: `.claude/commands/apply-onboard/profile.md` — section "## 1. Locate the CV PDF", lines 26–32

- [ ] **Step 1: Confirm the current extraction bullets**

Run:

```bash
sed -n '24,33p' .claude/commands/apply-onboard/profile.md
```

Expected (literal):

```
Verify the file exists and is a PDF, then read it with the `Read` tool (Claude Code reads PDFs natively). Extract:

- **Identity**: first name, last name, email, phone, LinkedIn URL, GitHub URL, personal website.
- **Address**: city (country only if explicit).
- **Education**: each entry with school, degree, field, start, end, graduation year, 1-line description.
- **Experiences**: each entry with company, title, start, end, description (3–5 lines max).
- **Languages**: list with `{code, level}` — levels in CEFR (A1…C2) or `native`.

Anything genuinely missing becomes a question in step 3.
```

If the output differs, stop and reconcile — the file has drifted from the plan baseline.

- [ ] **Step 2: Apply the edit**

Use `Edit` with `old_string` and `new_string` set to:

`old_string`:

```markdown
- **Languages**: list with `{code, level}` — levels in CEFR (A1…C2) or `native`.

Anything genuinely missing becomes a question in step 3.
```

`new_string`:

````markdown
- **Languages**: list with `{code, level}` — levels in CEFR (A1…C2) or `native`.
- **Job-search header** — extract these four fields **only if the CV states them explicitly**. Vague phrasing ("looking for opportunities", "available soon", "open to relocation") does NOT count — leave the field `null` and let step 3 ask the user.
  - `job_type` — one of `internship | apprenticeship | entry-level | mid-level | senior | other`. Map common synonyms (`stage` → `internship`, `alternance` → `apprenticeship`). No clear match → `null`.
  - `target_start` — ISO date `YYYY-MM-DD`. If the CV gives only a month (`September 2026`), normalize to the first of that month (`2026-09-01`). Seasons (`fall 2026`) or vague phrases (`as soon as possible`) → `null`.
  - `duration_months` — integer, only set if `job_type` is `internship` or `apprenticeship`. `6 months`, `6-month`, `semestre` → `6`. Ranges (`4–6 months`) → `null`.
  - `target_role` — short free-text domain phrase. Extract from a clear "looking for X" / "seeking Y" / role headline. A bare job title with no domain framing → `null`.

Hold these four extracted values (and their `null`s) in mind for step 2.5.

Anything genuinely missing becomes a question in step 3.
````

- [ ] **Step 3: Verify the edit landed**

Run:

```bash
sed -n '26,38p' .claude/commands/apply-onboard/profile.md
```

Expected: the new "Job-search header" bullet block is present immediately after the Languages bullet, and the "Anything genuinely missing" sentence is preserved at the end.

- [ ] **Step 4: Format check**

Run:

```bash
npm run lint
```

Expected: passes (Prettier does not reformat `.md` aggressively, but catches gross issues).

- [ ] **Step 5: Commit**

```bash
git add .claude/commands/apply-onboard/profile.md
git commit -m "feat(onboard): extract job-search header from CV in step 1 (#45)"
```

---

## Task 2: Insert step 2.5 — confirm extracted job-search fields

**Files:**

- Modify: `.claude/commands/apply-onboard/profile.md` — insert a new section between current "## 2. Write `config/cv.md`" (ends ~line 38) and "## 3. One question block" (~line 40)

- [ ] **Step 1: Locate the boundary**

Run:

```bash
sed -n '34,42p' .claude/commands/apply-onboard/profile.md
```

Expected: section header `## 2. Write \`config/cv.md\` and copy the PDF`, two paragraphs, blank line, `## 3. One question block`.

- [ ] **Step 2: Apply the edit**

Use `Edit` with:

`old_string`:

```markdown
Detect the language from the CV content (usually `fr` or `en`) and copy the source PDF to `config/cv.<lang>.pdf`. Use this absolute path as `cv_fr_path` or `cv_en_path` later.

## 3. One question block
```

`new_string`:

````markdown
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
````

- [ ] **Step 3: Verify the edit landed**

Run:

```bash
grep -n "^## " .claude/commands/apply-onboard/profile.md
```

Expected: section headers in this order — `## 1.`, `## 2.`, `## 2.5.`, `## 3.`, `## 4.`, `## 5.`, `## 6.`, `## 7.`.

- [ ] **Step 4: Sanity-read the new section**

Run:

```bash
sed -n '/^## 2.5/,/^## 3/p' .claude/commands/apply-onboard/profile.md
```

Expected: the full new section is printed, ending right before `## 3. One question block`.

- [ ] **Step 5: Commit**

```bash
git add .claude/commands/apply-onboard/profile.md
git commit -m "feat(onboard): add step 2.5 to confirm CV-extracted job-search fields (#45)"
```

---

## Task 3: Make the step-3 "Job search" sub-block conditional

**Files:**

- Modify: `.claude/commands/apply-onboard/profile.md` — section "## 3. One question block", the "**Job search**" sub-block (lines ~44–49 in the pre-edit file; offsets shift after Task 2)

- [ ] **Step 1: Locate the current sub-block**

Run:

```bash
grep -n -A 5 "^\*\*Job search\*\*" .claude/commands/apply-onboard/profile.md
```

Expected: the four bullets currently live directly under the `**Job search**` heading.

- [ ] **Step 2: Apply the edit**

Use `Edit` with:

`old_string`:

```markdown
**Job search**

- **Job type**: internship / apprenticeship / entry-level / mid-level / senior / other
- **Target start date** (ISO date)
- **Duration** (if internship/apprenticeship): months
- **Target role / domain keywords**: free text — drives both `title_filter` and company discovery (phase 2). Example: "AI/ML engineering", "backend Python", "devtools".
```

`new_string`:

```markdown
**Job search** (skip the entire sub-block if step 2.5 confirmed all four fields. Otherwise, only include the bullets whose value is still `null`.)

- **Job type**: internship / apprenticeship / entry-level / mid-level / senior / other
- **Target start date** (ISO date)
- **Duration** (if internship/apprenticeship): months
- **Target role / domain keywords**: free text — drives both `title_filter` and company discovery (phase 2). Example: "AI/ML engineering", "backend Python", "devtools".
```

- [ ] **Step 3: Verify the edit landed**

Run:

```bash
grep -n -A 1 "^\*\*Job search\*\*" .claude/commands/apply-onboard/profile.md
```

Expected: the heading line now ends with the parenthetical "(skip the entire sub-block if step 2.5 confirmed all four fields. Otherwise, only include the bullets whose value is still `null`.)".

- [ ] **Step 4: Commit**

```bash
git add .claude/commands/apply-onboard/profile.md
git commit -m "feat(onboard): make step-3 job-search bullets conditional on step 2.5 (#45)"
```

---

## Task 4: End-to-end coherence check + regression

**Files:**

- Read-only: `.claude/commands/apply-onboard/profile.md`
- Run: full test suite

- [ ] **Step 1: Read the whole modified file end-to-end**

Run:

```bash
cat .claude/commands/apply-onboard/profile.md
```

Manually verify:

- Section order: `## 1.`, `## 2.`, `## 2.5.`, `## 3.`, `## 4.`, `## 5.`, `## 6.`, `## 7.`.
- Step 1 mentions all four extracted fields and the explicit-only rule.
- Step 2.5 references the four field names exactly as they appear in step 1.
- Step 3 "Job search" heading carries the conditional preface.
- Step 5 still exists and still references `availability_start` and `internship_duration_months` (the YAML keys for `target_start` / `duration_months`). If those mappings are missing, the extracted values would be lost on write — fail the task.

- [ ] **Step 2: Lint + format**

Run:

```bash
npm run lint
```

Expected: passes. If Prettier reports a formatting diff, run `npm run format` and re-commit on the next step.

- [ ] **Step 3: Full test regression**

Run:

```bash
npm test
```

Expected: 410 tests pass, 0 fail. (No new tests, no removed tests — the file modified is a prompt, not source code.)

- [ ] **Step 4: PII gate (defensive)**

Run:

```bash
npm run check:pii
```

Expected: passes. The new prompt content uses no PII (only field names and example phrases like "AI/ML engineering"), so this is a belt-and-braces check.

- [ ] **Step 5: Commit any cleanup**

If Prettier reformatted in step 2:

```bash
git add .claude/commands/apply-onboard/profile.md
git commit -m "chore(onboard): prettier formatting after #45 edits"
```

If nothing changed, skip this step (no empty commit).

- [ ] **Step 6: Push and convert PR #59 from draft to ready**

```bash
git push
gh pr ready 59
```

Then comment on the PR with a short note that implementation is in and ready for review.
