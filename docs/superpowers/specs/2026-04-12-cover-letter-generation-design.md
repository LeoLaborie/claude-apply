# Cover Letter Generation — Design Spec

**Issue:** #16 — feat(apply): Automatic cover letter generation  
**Date:** 2026-04-12  
**Status:** Approved

## Overview

When the `/apply` playbook encounters a `cover_letter_upload` or `cover_letter_text` field, it generates a tailored cover letter via `claude -p`, renders it as a PDF through LaTeX compilation, and fills the form field. All generated letters are saved to `data/cover-letters/` for audit.

## Module: `src/apply/cover-letter.mjs`

### Export

```js
generateCoverLetter({ company, role, jdText, language, cvMd, profile })
  → { pdfPath, textContent, usage }
```

### Internal Flow

1. Call `buildLetterPrompt()` (existing in `letter-generator.mjs`) to build system + user prompt.
2. Spawn `claude -p --system-prompt <sys> --output-format text` — retrieve the raw letter text.
3. Escape LaTeX special characters (`&`, `%`, `$`, `#`, `_`, `{`, `}`, `~`, `^`, `\`) in all placeholder values.
4. Inject text + metadata (`company`, `role`, date, candidate name) into the LaTeX template via placeholder replacement.
5. Write a temporary `.tex` file to `data/cover-letters/`.
6. Compile via `pdflatex -output-directory data/cover-letters/ <file>.tex`.
7. Clean up auxiliary files (`.aux`, `.log`, `.out`, `.tex`).
8. Return `{ pdfPath, textContent, usage }`.

### File Naming

`data/cover-letters/{YYYY-MM-DD}_{company}_{role-slug}.pdf`

### Error Handling

- `pdflatex` fails → `CoverLetterError` with code `LATEX_COMPILATION_FAILED`, includes LaTeX log content.
- `claude -p` fails → `CoverLetterError` with code `LLM_GENERATION_FAILED`.
- `data/cover-letters/` created automatically if missing (`mkdirSync({ recursive: true })`).

## Template: `templates/cover-letter.tex`

### Layout

- **Header:** candidate name, email, phone (from `profile`).
- **Recipient:** company name, role.
- **Date:** formatted by `language` (FR: `12 avril 2026`, EN: `April 12, 2026`).
- **Body:** LLM-generated text, injected as-is.
- **Closing:** candidate name (no manuscript signature).

### Placeholders

`<<CANDIDATE_NAME>>`, `<<EMAIL>>`, `<<PHONE>>`, `<<COMPANY>>`, `<<ROLE>>`, `<<DATE>>`, `<<BODY>>`

Double angle brackets (`<<>>`) avoid conflicts with LaTeX braces.

### Packages

- `geometry` (margins)
- `fontenc` (`T1`)
- `inputenc` (`utf8`)
- `hyperref` (PDF metadata)

No exotic dependencies — everything ships with `texlive-base` + `texlive-latex-recommended`.

## Playbook Integration

### Insertion Point

In `.claude/commands/apply.md`, replace the "leave blank and report as skipped" instruction for cover letter fields.

### Flow for `cover_letter_upload`

1. `classifyField()` returns `cover_letter_upload`.
2. Call `generateCoverLetter()` with job metadata (company, role, jdText from page, detected language).
3. Receive `{ pdfPath }`.
4. Use `uploadFile()` (existing CDP helper) to upload the PDF on the field selector.
5. Log result.

### Flow for `cover_letter_text`

1. Same detection and generation.
2. Receive `{ textContent }` — raw text before LaTeX.
3. Use `form_input` (chrome tool) to paste text into the textarea.
4. PDF still saved to `data/cover-letters/` for audit.

### JD Extraction

The playbook already has page text via `get_page_text`. Pass it truncated to 3000 chars (as `buildLetterPrompt` already does).

### Doc Update

Line 215 of `docs/apply-workflow.md` changes from "not currently supported" to a description of the generation flow.

## Setup: `scripts/setup.sh`

- Detect `pdflatex` via `command -v pdflatex`.
- If absent: install `texlive-latex-base` + `texlive-latex-recommended` (Debian/Ubuntu) or `basictex` (macOS via brew).
- Idempotent — skip with message if already installed.
- Positioned after Node installation, before final message.

## Tests: `tests/cover-letter.test.mjs`

1. **LaTeX escaping** — special characters are escaped in placeholders.
2. **Placeholder injection** — generated `.tex` contains correct values (company, role, date, body).
3. **File naming** — format `{YYYY-MM-DD}_{company}_{role-slug}.pdf`.
4. **Date formatting** — FR vs EN.
5. **LLM call** — mock `claude -p` spawn, verify `buildLetterPrompt()` args and `usage` return.
6. **LaTeX compilation** — mock `pdflatex`, verify auxiliary file cleanup.
7. **LLM error** — mock `claude -p` failure, verify `CoverLetterError` with `LLM_GENERATION_FAILED`.
8. **LaTeX error** — mock `pdflatex` failure, verify `CoverLetterError` with `LATEX_COMPILATION_FAILED`.
9. **Directory creation** — verify `data/cover-letters/` is created if missing.

No CDP integration tests — the playbook is tested manually (consistent with the rest of `/apply`).
