# `/apply` workflow

The full playbook lives in [`.claude/commands/apply.md`](../.claude/commands/apply.md). This doc is the companion guide — it explains the _why_ behind each step and links to the relevant module.

## High-level pipeline

```
URL ──► pre-check ──► open tab ──► blocker detect ──► ATS resolve
  ──► metadata ──► form scan ──► classify ──► fill ──► upload CV
  ──► cover letter (optional) ──► submit ──► confirm ──► log
```

## Pre-check

Validates:

1. The profile (`config/candidate-profile.yml`) parses and matches the schema in `src/lib/candidate-profile.schema.mjs`.
2. The URL is not already in `data/applications.md` with a terminal status.
3. The CDP port (`http://127.0.0.1:9222`) is reachable — if not, the file upload step will fall back to asking for a manual drop.

## Blocker detection

Closed offers, login walls, captchas, and cookie banners are detected via text patterns before any form interaction. Patterns are deliberately conservative — false positives stop the flow and ask the user, which is the safe default.

Watch out for **newsletter forms** on aggregator pages: a visible `#email` input inside a subscribe form is not a login wall. The playbook tells the agent to check `closest('form')` before classifying.

## Field classification

`src/apply/field-classifier.mjs` maps each DOM field to a canonical key:

```js
{ name: 'urls[LinkedIn]', id: 'urls[LinkedIn]', label: 'LinkedIn URL', type: 'url' }
// → 'linkedin'
```

Rules are ordered — earlier rules win. `cover_letter_upload` comes before `cv_upload` because a file input labelled "Cover letter" must not be classified as the resume slot.

### Supported classes

- Identity: `full_name`, `first_name`, `last_name`, `email`, `phone`
- Links: `linkedin`, `github`, `website`
- Uploads: `cv_upload`, `cover_letter_upload`, `cover_letter_text`, `transcript_upload`, `portfolio_upload`, `other_upload`
- Education: `education_school`, `education_degree`, `education_field`, `education_start`, `education_end`, `graduation_year`
- Experience: `experience_company`, `experience_title`, `experience_start`, `experience_end`, `experience_summary`
- Legal: `work_auth`, `sponsorship`, `availability`
- EEO: `eeo_gender`, `eeo_ethnicity`, `eeo_veteran`, `eeo_disability`
- Fallback: `free_text`, `unknown`

## Filling

Three methods depending on the field and the framework:

| Type                                 | Method                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------- |
| Static text/email/tel/url/textarea   | `form_input`                                                              |
| React-controlled input/textarea      | Native setter + `dispatchEvent('input' + 'change')` via `javascript_tool` |
| Checkbox / radio                     | `element.click()` via `javascript_tool` — never `form_input`              |
| Custom dropdown (React Select, etc.) | `find` + `click` on the option element                                    |
| Google Places autocomplete           | Physical keyboard via `mcp__claude-in-chrome__computer`                   |
| File                                 | CDP helper `src/apply/upload-file.mjs` — **never** JS                     |

## File upload

The CDP helper:

```bash
node src/apply/upload-file.mjs \
  --url '<unique URL fragment>' \
  --selector 'input[name="resume"]' \
  --file '<absolute CV path>'
```

On success, stdout is `{ok:true, fileName, fileSize, pageUrl}`. On error, stderr has a `code` (`CDP_PORT_DOWN`, `TAB_NOT_FOUND`, `SELECTOR_NOT_FOUND`, `FILE_NOT_FOUND`, `UPLOAD_VERIFY_FAILED`, `BAD_ARGS`).

The helper connects to Chrome over CDP, finds the tab by URL fragment (string `includes()` or a JS function), calls Playwright's `setInputFiles()` on the selector, then verifies that `input.files[0].name` matches. That last verify step catches subtle cases where the file was dropped but the page cleared it.

## Confirmation detection

`src/apply/confirmation-detector.mjs` returns one of `Applied`, `Failed`, `Submitted (unconfirmed)`.

- `Applied` — success text (`thank you for applying`, `merci pour votre candidature`, `application received`, etc.) or a URL transition to `/thank-you`, `/confirmation`, `/success`, `/merci`, etc.
- `Failed` — visible validation error text (`please fix`, `required`, `invalid email`, etc.).
- `Submitted (unconfirmed)` — neither pattern matched. The playbook keeps polling for 15 s, then escalates.

See `tests/apply/confirmation-detector.test.mjs` for the exact pattern list.

## Logging

Two writes on success:

1. **`data/applications.md`** — the markdown tracker. Find or append the row for `(company, role)` and update its `Status` column.
2. **`data/apply-log.jsonl`** — append a JSON line with URL, status, duration, GIF path, errors. Used for analytics and debug.

## Failure modes and recovery

| Symptom                                    | Likely cause                                   | Recovery                                      |
| ------------------------------------------ | ---------------------------------------------- | --------------------------------------------- |
| `CDP_PORT_DOWN`                            | Chrome not launched via `chrome-apply`         | Relaunch via the alias, retry                 |
| `TAB_NOT_FOUND`                            | URL fragment too generic/specific              | Refine the fragment                           |
| `SELECTOR_NOT_FOUND`                       | File input hidden until parent expanded        | Expand subforms first (`+ Add` buttons)       |
| `Please select a location` after submit    | Google Places autocomplete not triggered       | Use physical keyboard via `computer` tool     |
| `Please attach a resume` after upload      | File set via JS then wiped by the page         | Always use the CDP helper                     |
| Submit button clicked but nothing happened | Multi-step form — clicked `Next`, not `Submit` | Re-run step 4 on the new page                 |
| React checkbox reverts after filling       | Wrong filling method                           | Use `element.click()`, verify with `.checked` |
