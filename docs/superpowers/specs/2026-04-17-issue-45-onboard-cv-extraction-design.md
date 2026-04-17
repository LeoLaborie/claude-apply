# Issue #45 — `/apply-onboard:profile` re-asks questions whose answers are already in the CV

**Date:** 2026-04-17
**Issue:** [#45](https://github.com/LeoLaborie/claude-apply/issues/45) — `/onboard:profile` re-asks questions whose answers are already in the CV
**Branch:** `fix/issue-45-onboard-cv-extraction`
**Severity:** Low (UX) — but it is the literal first impression of the tool.

## Problem

`/apply-onboard:profile` step 3 always emits a 4-question `AskUserQuestion` block for `job_type`, `target_start`, `duration_months`, and `target_role`. These four fields are frequently present in the CV header (e.g. `6-month internship starting September 2026, looking for AI/ML roles`). A new user typing the same information they just put in their CV feels bureaucratic and lowers trust.

## Goal

When the CV contains an explicit value for any of the four job-search fields, the skill must:

1. Extract it during the initial PDF read.
2. Show extracted values for one-click confirmation.
3. Only `AskUserQuestion` for the fields that remain `null` after confirmation.

## Non-goals

- Extracting `locations`, `remote_preference`, or any other field beyond the four named in the issue. CV addresses often reflect current residence, not search target; remote preference is rarely explicit. Adding them inflates the false-positive risk without UX gain.
- Confidence scoring or probabilistic extraction. The rule is binary: explicit in the CV or `null`.
- Schema or YAML changes. Target keys (`availability_start`, `internship_duration_months`, `job_type`, `target_role`) already exist.
- Code changes. The skill is a markdown prompt; the fix is a prompt edit.
- New tests. There is no executable surface; verification is a manual re-run of `/apply-onboard:profile` against a test CV.

## Design

### Files touched

- `.claude/commands/apply-onboard/profile.md` — single file edit.

### Modified flow

```
Step 1 — Read CV PDF
  └── Extract identity, address, education, experiences, languages (existing).
  └── Extract job_type, target_start, duration_months, target_role  ← NEW
      Rule: set a field only if the CV states it explicitly.
      Vague signals ("looking for opportunities", "open to relocation")
      do not count. Anything not explicit → null.

Step 2 — Write cv.md and copy PDF (unchanged)

Step 2.5 — Confirm extracted job-search fields  ← NEW
  └── If at least one of the four was extracted:
        AskUserQuestion ("Confirm CV-extracted job-search fields"):
          Body: human-readable summary, one line per extracted field,
                "<not found>" for nulls.
          Options: confirm | edit
        └── confirm → values are locked, treated as already-answered
        └── edit    → all four fields reset to null

Step 3 — AskUserQuestion (modified)
  └── The "Job search" section only includes fields that are still null.
  └── If all four are confirmed: omit the "Job search" section entirely.
  └── The existing conditional ("Duration: only if internship/apprenticeship")
      remains: when job_type is confirmed as "mid-level", duration_months is
      not asked even if null.
  └── Other sections (Location & remote, Admin, Setup choices) unchanged.

Steps 4–7 unchanged.
```

### Confirmation block — exact format

```
Question: "I extracted these from your CV. Confirm or edit?"
Header (multi-line, in the question body):
  - Job type:      internship
  - Target start:  2026-09-01
  - Duration:      6 months
  - Target role:   AI/ML engineering

Options:
  - confirm  ("Use these values")
  - edit     ("Re-ask all four — they are wrong or incomplete")
```

`edit` resets all four to `null` rather than entering a per-field correction loop. This keeps the option simple (one click) and reuses the existing `AskUserQuestion` step 3 verbatim. The cost of re-typing is small — at most four short fields — and avoids a bespoke per-field UI.

### Extraction rules (as written in the prompt)

- `job_type` — match against the closed enum `internship | apprenticeship | entry-level | mid-level | senior | other`. Map common synonyms (`stage` → `internship`, `alternance` → `apprenticeship`). If no clear match: `null`.
- `target_start` — must be an ISO date (`YYYY-MM-DD`). If the CV says only a month (`September 2026`), normalize to the first day of that month (`2026-09-01`). If only a season (`fall 2026`) or a vague phrase (`as soon as possible`): `null`.
- `duration_months` — integer, only set if `job_type` is `internship` or `apprenticeship`. `6 months`, `6-month`, `semestre` → `6`. Ranges (`4–6 months`) → `null`.
- `target_role` — short free-text domain phrase. Extract from a clear "looking for X" / "seeking Y" / role headline. If only a job title with no domain framing: `null`.

## Architecture decisions

- **Inline extraction, not a separate `claude -p` call.** The skill already runs in a Claude Code session that read the PDF in step 1; the model has the CV in context. A separate process would re-pay the file-read cost and add a fork point with no benefit.
- **Confirmation always shown when ≥ 1 field is extracted.** Even one extracted field is worth confirming because a wrong `target_start` silently flowing into `availability_start` would degrade `/scan` filtering. Cost of confirmation: one extra `AskUserQuestion` with two options. Trade decided in brainstorming Q2.
- **All-or-nothing edit reset.** Per-field edit would require either a multi-question follow-up flow or a structured input. Both add complexity without addressing a common case (most CVs either state all four cleanly or state none).

## Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Model hallucinates a precise date from a vague phrase. | Explicit "explicit only, else null" rule, restated for `target_start`. Confirmation step is the safety net. |
| User clicks `confirm` without reading. | Summary is short (≤ 4 lines), printed in the question body — visible above the answer buttons. |
| Two parallel sources of truth (extraction state vs. step 3 answers). | One mental table of four fields, populated in step 1, optionally cleared in step 2.5, read in step 3. No duplication. |
| Regression in the no-extraction case. | When zero fields are extracted, behaviour is byte-identical to today: confirmation block is skipped, step 3 asks all four. |

## Verification

Manual, since the skill has no executable surface:

1. **No-extraction CV**: a CV with no job-search header. Expected: confirmation block skipped, step 3 asks all four. Identical to current behaviour.
2. **Partial-extraction CV**: header `Looking for an AI/ML internship` (no start date, no duration). Expected: confirmation shows `internship`, `AI/ML`, `<not found>` × 2; on `confirm`, step 3 asks only for `target_start` (and `duration_months` since job_type is internship).
3. **Full-extraction CV**: header `6-month internship starting September 2026, looking for AI/ML roles`. Expected: confirmation shows all four; on `confirm`, step 3 has no "Job search" section. On `edit`, step 3 asks all four.
4. **Vague CV**: header `Open to opportunities in tech, available fall 2026`. Expected: zero extraction (no enum match for job_type, no ISO date), confirmation skipped, step 3 asks all four.

## Out of scope

- Companies-discovery or setup phases (`/apply-onboard:companies`, `/apply-onboard:setup`) are unaffected.
- The `data/.onboard-state.json` shape is unchanged. The same keys are written, just sourced from CV when available.
