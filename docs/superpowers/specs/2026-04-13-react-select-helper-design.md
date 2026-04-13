# Fix issue #41 — react-select helper for `/apply`

**Date**: 2026-04-13
**Issue**: [#41](https://github.com/.../issues/41) — `/apply` cannot fill react-select custom dropdowns (Greenhouse + Doctolib)
**Severity**: Critical — blocks the whole apply flow on any Greenhouse offer with a custom dropdown.

## Problem

On a Doctolib Greenhouse form (`https://job-boards.greenhouse.io/doctolib/jobs/7642865003`), 4 required dropdowns are implemented as `react-select` components with `.select__control` wrappers. Neither `mcp__claude-in-chrome__form_input` nor the React native-value setter pattern from `.claude/commands/apply.md` updates react-select's internal state: the visible label stays `"Sélectionner une option…"` and the form refuses to submit.

The root cause is that react-select listens to `mousedown` (not `click`) on its control, and its options do not exist in the DOM until the menu opens. `form_input` only writes the input's `value` attribute, which react-select ignores.

Impact: effectively every Greenhouse application is currently unfillable because EEO, country, and eligibility selects are almost always react-select.

## Goal

Provide a reliable, reusable helper for selecting a react-select option during `/apply`, plus a short playbook that the agent reads when it detects `.select__control` in the DOM. Generic — not Greenhouse-specific — because react-select is also used on Ashby and many custom ATSes.

## Non-goals

- URL-based routing to a Greenhouse-specific playbook (react-select is cross-ATS).
- Replacing `form_input` for native `<select>` elements.
- Automated end-to-end tests against a live Greenhouse page (validated manually).

## Architecture

### New module — `src/apply/react-select-helper.mjs`

ESM, ~120 lines. Exports:

1. **`REACT_SELECT_SNIPPET`** — a self-contained JS string to be passed to `mcp__claude-in-chrome__javascript_tool`. It is a single expression that, given `controlSelector` and `optionText` bound as variables in the surrounding eval, runs the full DOM sequence and returns a JSON-serializable result `{ ok: true, value }` or `{ ok: false, code, found? }`.

2. **`matchOptionText(options, target)`** — pure function, testable in Node. Takes an array of strings (option labels) and a target string. Returns the matched label or `null`. Matching rules, applied in order:
   - Exact match after `trim()`
   - Case-insensitive exact match after `trim()`
   - Case-insensitive `startsWith` match after `trim()`
   - Otherwise `null`

3. **`ReactSelectError`** — typed error class extending `Error`. Fields: `code` (string), `message`, optional `found` (string[] of options seen). Codes:
   - `CONTROL_NOT_FOUND`
   - `MENU_NOT_OPENED`
   - `OPTION_NOT_FOUND`
   - `SELECTION_NOT_APPLIED`

The agent reads the snippet result and, if `ok: false`, constructs a `ReactSelectError` for logging or retries.

### Snippet DOM sequence

Runs entirely inside the page via `javascript_tool`:

1. `const control = document.querySelector(controlSelector)` → if falsy, return `{ ok: false, code: 'CONTROL_NOT_FOUND' }`.
2. Dispatch a `mousedown` event (`bubbles: true`, `button: 0`) on `control` — react-select opens its menu on `mousedown`, not `click`.
3. Poll up to 1500ms in 50ms steps for a `.select__menu` sibling or descendant of the control's nearest `.select__container` (or document-level if not scoped).
4. If the menu never appears, return `{ ok: false, code: 'MENU_NOT_OPENED' }`.
5. Collect `Array.from(menu.querySelectorAll('.select__option'))`. Map each to its `textContent.trim()`.
6. Apply the same matching rules as `matchOptionText` (inlined — the snippet cannot import).
7. If no match: return `{ ok: false, code: 'OPTION_NOT_FOUND', found: [...labels] }`.
8. Dispatch `mousedown` on the matched option element. (`click` does not always work; react-select binds `onMouseDown`.)
9. Poll up to 500ms for `.select__single-value` (or `.select__multi-value__label` for multi-selects) whose `textContent` contains the target text.
10. If found, return `{ ok: true, value: element.textContent }`. Otherwise, return `{ ok: false, code: 'SELECTION_NOT_APPLIED' }`.

The snippet is a single IIFE so it can be injected verbatim and produces a serializable return value for `javascript_tool`.

### Fallback — physical click via `computer`

Documented in the playbook. If the snippet returns `ok: false` twice in a row (e.g., `MENU_NOT_OPENED` under a tricky portal wrapper), the agent should:

1. Use `javascript_tool` with `document.querySelector(controlSelector).getBoundingClientRect()` to get viewport coordinates.
2. Call `mcp__claude-in-chrome__computer` with `left_click` on the control's center.
3. `type` the first 3–5 characters of the target option text — this filters the visible options.
4. `key Return` to select the first suggestion.
5. Verify via `javascript_tool` that `.select__single-value` now contains the expected text; otherwise STOP and ask the user.

This fallback is never tried automatically by the snippet — it is an explicit agent decision documented in the playbook.

## Documentation changes

### New — `docs/playbooks/apply-greenhouse.md` (~80 lines)

Sections:
- **When to consult**: during `/apply` step 5, if the DOM contains `.select__control` on any required field.
- **Why**: react-select ignores native value setters; `form_input` is a no-op.
- **Primary path**: inject `REACT_SELECT_SNIPPET` via `javascript_tool` with `controlSelector` and `optionText` bound in the eval preamble. Example snippet call included.
- **Error codes**: one paragraph per `ReactSelectError.code` explaining the typical cause and next step.
- **Fallback**: `computer`-based physical click sequence (above).
- **Not Greenhouse-specific**: note that the same helper works on Ashby and any site using react-select.

### Patch — `.claude/commands/apply.md` (step 5, line ~185)

Replace the current one-liner:
> **Custom dropdowns (React Select, etc.)**: use `find` + `click` on the option element.

with:
> **Custom dropdowns (`.select__control`)**: use `REACT_SELECT_SNIPPET` from `src/apply/react-select-helper.mjs` via `javascript_tool`. See `docs/playbooks/apply-greenhouse.md` for the error codes and the `computer`-based fallback.

### Patch — `docs/apply-workflow.md`

In the custom-dropdown subsection, add a one-paragraph reference to the helper and the playbook.

## Tests

### `tests/apply/react-select-helper.test.mjs` (~60 lines)

Unit tests only. Pure-function and surface-level checks; no jsdom simulation of react-select (unreliable).

- `matchOptionText`:
  - Exact trimmed match wins over case-insensitive
  - Case-insensitive exact match wins over `startsWith`
  - `startsWith` picks the shortest matching option
  - Returns `null` when no match
  - Handles empty option arrays
- `REACT_SELECT_SNIPPET`:
  - Is a non-empty string
  - Contains all four selectors: `.select__control`, `.select__menu`, `.select__option`, `.select__single-value`
  - Contains all four error codes
  - References `mousedown` (not relying on `click` alone)
- `ReactSelectError`:
  - `instanceof Error` and `instanceof ReactSelectError`
  - Exposes `code` and optional `found` fields

### Manual validation (documented, not automated)

After merge, run `/apply https://job-boards.greenhouse.io/doctolib/jobs/7642865003` and verify that the four dropdowns (Pays, Établissement, Fonctionnaire, Identité de genre) are filled via the helper. Record the result in a follow-up note.

## Files touched

| File | Change |
|---|---|
| `src/apply/react-select-helper.mjs` | new, ~120 lines |
| `tests/apply/react-select-helper.test.mjs` | new, ~60 lines |
| `docs/playbooks/apply-greenhouse.md` | new, ~80 lines |
| `.claude/commands/apply.md` | patch line ~185 |
| `docs/apply-workflow.md` | patch custom-dropdown section |

## Invariants

- No PII added anywhere.
- No captcha bypass, no anti-bot evasion — the helper only dispatches standard DOM events on a visible element the user explicitly consented to interact with by running `/apply`.
- Typed error class mirrors `UploadError` in `src/apply/upload-file.mjs`.
- ESM, Node 20+, Prettier defaults, no comments unless the why is non-obvious.
- New code covered by tests before merge.

## Open questions

None — Q1 (C: helper + fallback), Q2 (B: generic, no URL routing), Q3 (B: pure-function unit tests + manual validation) all answered during brainstorming.
