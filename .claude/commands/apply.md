---
description: Fill and submit a job application on the URL provided via claude-in-chrome, detect confirmation, and update applications.md
argument-hint: <job-url>
---

# /apply $ARGUMENTS

You will apply automatically to the offer at `$ARGUMENTS`. Follow this playbook **step by step**. At the slightest anomaly (login wall, captcha, unknown required field, submit error), **STOP and ask the user** before continuing.

## First-run guard

Before anything else, check that `config/candidate-profile.yml` exists. If it does not, **stop** and tell the user:

> "No config found. Run `/onboard` first — it will extract your CV, build the profile, and prepare the target companies."

Do not try to apply with the example templates.

## 0. Tool loading and pre-check

1. Load the required `claude-in-chrome` tools via `ToolSearch`:

   ```
   select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__form_input,mcp__claude-in-chrome__find,mcp__claude-in-chrome__gif_creator,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__navigate
   ```

2. Read `config/candidate-profile.yml` with js-yaml and validate it via `validateProfile` from `src/lib/candidate-profile.schema.mjs`. If `ok: false`, print errors and stop.

3. Read `data/applications.md`. If an entry already matches `$ARGUMENTS` with status `Applied`, `Submitted (unconfirmed)`, or `Failed`, ask the user before re-applying.

4. Call `mcp__claude-in-chrome__tabs_context_mcp` to check the browser state.

5. **Check the CDP port for CV upload.** Run `curl -sf http://127.0.0.1:9222/json/version` via Bash. If it responds: OK, CV upload will work in step 5. If not: warn the user that Chrome was not launched with `--remote-debugging-port=9222` (the `chrome-apply` alias installs this). Continue without CDP — you will ask for a manual CV drop later.

## 1. Open the tab and start GIF recording

1. Open `$ARGUMENTS` in a new tab with `mcp__claude-in-chrome__tabs_create_mcp`.
2. Start the recording with `mcp__claude-in-chrome__gif_creator`. Suggested name: `apply-<slug>-<YYYYMMDD-HHMM>.gif`.
3. Wait 2 seconds for JavaScript to load.
4. Call `read_page` to capture DOM + text.

## 2. Blocker detection

Search the page text and HTML for:

- **Closed offer**: `no longer accepting applications`, `position filled`, `poste pourvu`, `cette offre n'est plus disponible`, `job expired` → status `Discarded`, log, close tab, stop.
- **Login wall**: a form with `type="password"` and no `resume/CV` field, or "Sign in" / "Log in" / "Connexion" buttons. → Stop. Ask the user to sign in and type `continue`. Watch out for **newsletter forms** (common on aggregators): a visible `#email` input inside a `<form>` labeled "Subscribe" is not a login wall. Inspect `closest('form')` before deciding.
- **Captcha / Cloudflare**: `captcha`, `cloudflare`, `challenge`, `verify you are human`. → Stop, ask the user to solve it and type `continue`.
- **Cookie banner**: dismiss first. Many aggregator pages hide the JD behind a cookie consent dialog.

## 2bis. Resolving the real ATS (aggregator case)

**Some sites (e.g. Welcome to the Jungle, Indeed Apply) are aggregators, not ATSes.** Their "Apply" button is often an `<a target="_blank">` pointing to the real ATS (Lever, Greenhouse, Workable, Ashby, Teamtailor, SmartRecruiters, etc.). A naive `click()` may open a new tab that the browser extension does not see.

**Procedure**:

1. Find visible "Apply" / "Postuler" anchors via DOM query.
2. Read their `getAttribute('href')` (not `.href`).
3. Navigate directly via `window.location.href = '<real-ats-url>'` in the same tab.
4. Re-run step 4 (form scan) on the new page.

## 3. Extract job metadata

From the page, extract:

- `company` (usually `<title>`, `<h1>`, or a clearly-marked header)
- `role` (job title)
- `jdText` (full job description)
- `language`: call `detectLanguage({ title: role, description: jdText })` from `src/apply/language-detect.mjs`

Build `slug` from `company` in kebab-case, optionally suffixed with a role keyword.

If the language is ambiguous (bilingual offer), ask the user once: `fr` or `en`.

## 4. Form scan

### 4.1 Expand optional structured sections first

Many ATSes hide education / experience / language / link / skill subforms behind `+ Add` buttons. Skipping them costs matching points.

1. Import `classifyAddButton` and `countEntriesForSection` from `src/apply/field-classifier.mjs`.
2. List visible `<button>` elements, pass each `textContent` to `classifyAddButton`. For each matched button:
   - Compute `n = countEntriesForSection(section, profile)`.
   - Click the button `n` times via `javascript_tool` with ~200ms between clicks.
   - Some ATSes require filling the current entry before `+ Add` re-appears. In that case, click once, fill, then re-click for the next.
3. **Only then**, run the full field scan.

### 4.2 Scan fields

1. Via `javascript_tool`, extract every `input`, `select`, `textarea`, `button[type=submit]` with attributes `name`, `id`, `type`, `placeholder`, `required`, and the associated `<label>` (via `for` or DOM proximity).

   ```javascript
   const out = [];
   const labelFor = (id) => {
     const l = document.querySelector(`label[for="${id}"]`);
     return l ? l.textContent.trim() : '';
   };
   for (const el of document.querySelectorAll('input, select, textarea')) {
     out.push({
       tag: el.tagName.toLowerCase(),
       name: el.name || '',
       id: el.id || '',
       type: el.type || '',
       placeholder: el.placeholder || '',
       required: el.required || el.hasAttribute('aria-required'),
       label: labelFor(el.id) || el.closest('label')?.textContent?.trim() || '',
     });
   }
   return out;
   ```

2. For each field, call `classifyField` from `src/apply/field-classifier.mjs` to get its canonical key (`email`, `first_name`, `cv_upload`, `cover_letter_upload`, `education_school`, `experience_company`, `free_text`, `unknown`, …).

3. Build `fields = [{ descriptor, classKey, value, sectionIndex }]`. For repeatable sections (education/experience), associate each field with an index based on DOM order. Use `mapProfileValue(classKey, profile, { educationIndex, experienceIndex })` to resolve values.

## 5. Structured filling

**Filling methods differ by field type and framework**:

- **Inputs (text/email/tel/url/date/number) + textareas on static sites**: `form_input` works directly.
- **Inputs on React/Next.js/Vue**: `form_input` may set the DOM value without triggering the framework's state, so it gets wiped on the next render. Use the native setter via `javascript_tool`:
  ```javascript
  const el = document.querySelector('<selector>');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, '<new-value>');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  ```
- **Checkboxes and radios (ALWAYS)**: never use `form_input`. Use `element.click()` via `javascript_tool`, then verify `element.checked` and `aria-checked`.
- **Custom dropdowns (React Select, etc.)**: use `find` + `click` on the option element.
- **Google Places autocompletes (location inputs)**: programmatic events do NOT trigger the Places API — the form will reject the submit with "please select a location from the dropdown". Use `mcp__claude-in-chrome__computer` to physically `left_click`, `type`, `wait`, then `key Return` to pick the first suggestion. Verify the canonical value is stored.

For each field, in DOM order:

- **Known structured class** (`email`, `first_name`, `phone`, …): resolve via `mapProfileValue(classKey, profile)` and fill using the appropriate method. Verify the final value matches.

- **`cv_upload`**: resolve the CV path from the profile (`profile.cv_fr_path` or `profile.cv_en_path` depending on the detected language).

  **Never use `form_input` or `javascript_tool` for file inputs** — HTTPS pages block `input.value` writes for `type=file`. Some ATSes even appear to accept a JS-injected `DataTransfer` ("Success! <filename>" in the UI) but the backend silently rejects the file at submit. **CDP is mandatory**. Call the helper:

  ```bash
  node src/apply/upload-file.mjs \
    --url '<unique URL fragment of the current tab>' \
    --selector 'input[type="file"]' \
    --file '<absolute cv path>'
  ```

  - `--url`: a fragment specific enough to identify the tab (host + path).
  - `--selector`: if multiple `input[type=file]` exist (CV + cover letter + portfolio), refine with `name`, `id`, or `aria-label`.

  On success, stdout is `{ok:true, fileName, fileSize, pageUrl}`. On error, stderr has a `code`:
  - `CDP_PORT_DOWN` → Chrome not in debug mode; ask for manual drop then `continue`.
  - `TAB_NOT_FOUND` → refine the `--url` fragment.
  - `SELECTOR_NOT_FOUND` → fix the selector from the scan list.
  - `FILE_NOT_FOUND` → wrong CV path.
  - `UPLOAD_VERIFY_FAILED` → stop and ask the user.

  After success, re-verify from `claude-in-chrome`: `document.querySelector('<selector>').files[0]?.name`.

- **`cover_letter_upload` or `cover_letter_text`**: leave blank and report as skipped. Cover letter generation is not currently supported.

- **`free_text`**: see step 6.

- **`unknown` AND `required: true`**: **STOP**. Display `{label, type, placeholder}` and ask the user for the value. Suggest adding the mapping to `candidate-profile.yml`.

- **`unknown` AND `required: false`**: leave empty, mention in the final report.

- **EEO field**: use the profile value (null → "Prefer not to say"). Never guess.

## 6. Free text questions

For each `free_text` field:

1. Extract the exact label or placeholder.
2. Produce an 80–150 word answer that addresses the question specifically, grounded in `config/cv.md` and `jdText`. **Never invent experience**.
3. Fill via `form_input`.

## 7. Submit

1. Capture `beforeUrl = window.location.href`.
2. Note `startTime = Date.now()`.
3. Use `find` to locate the final submit button (`Submit`, `Submit Application`, `Apply`, `Envoyer`, `Postuler`, `Send application`). On multi-step forms, click `Next` first and re-run step 4 on the next page.
4. Click the submit button.

## 8. Confirmation detection (15 s max)

Poll every 2 s, up to 15 s:

1. Get `afterUrl` via `javascript_tool`.
2. Get `pageText` via `get_page_text`.
3. Import `classifyConfirmation` from `src/apply/confirmation-detector.mjs`.
4. Call `classifyConfirmation({ beforeUrl, afterUrl, pageText })`.
5. Act on the result:
   - **`Applied`**: exit loop, record success.
   - **`Failed`**: screenshot, inspect validation errors. Before giving up, re-check all required fields — a React re-render may have wiped a checkbox. Fix and retry submit once. If it fails again, stop.
   - **`Submitted (unconfirmed)`**: keep polling.

**Known gotcha — Lever "already received"**: if `afterUrl` matches `/already-received` or page text mentions `"Your application was already submitted"` / `"Application already received"`, the offer was previously applied to (Lever blocks re-submission for ~3 months). Status = **`Applied`** (not Failed).

**Aggregator silent close (e.g. WTTJ)**: some sites close the apply modal silently with no success page. Text/URL detection will fail. Fall back to the user's application tracker on that site if available, or mark `Submitted (unconfirmed)` and notify.

After 15 s with no match → status `Submitted (unconfirmed)`, screenshot, notify the user.

## 9. State update

1. **Update `data/applications.md`**:
   - Find an existing row matching company + role.
   - If found: update the `Status` column in place.
   - If not: append a new row: `# | Date | Company | Role | Score | Status | PDF | Report | Notes` with today's date and status.
   - Use `Edit` with exact old/new content.

2. **Append to `data/apply-log.jsonl`** via `appendApplyLog` from `src/apply/apply-log.mjs`:

   ```javascript
   appendApplyLog('data/apply-log.jsonl', {
     url: '$ARGUMENTS',
     company,
     role,
     language,
     finalStatus: '<Applied|Submitted (unconfirmed)|Failed|Discarded>',
     gifPath: '<gif path>',
     durationMs: Date.now() - startTime,
     errors: [],
     notes: null,
   });
   ```

3. Close the tab if status = `Applied`. Leave open otherwise for human review.

4. Stop the GIF.

## 10. Final report

Print a clear summary:

- **URL**: $ARGUMENTS
- **Company / Role / Language**: …
- **Final status**: …
- **GIF**: absolute path
- **Screenshot** (if `Submitted (unconfirmed)` or `Failed`): path
- **Filled fields**: list of `classKey`s
- **Skipped fields**: list of non-required unknowns left empty
- **AI-generated content**: cover letter (if any), free-text answers
- **Warnings**: any non-blocking anomaly

## Absolute rules

- **Never click Submit with a required field empty** or filled with a guessed value.
- **Never guess EEO values** — use `Prefer not to say` or the explicit profile value.
- **Never write `Applied` without a matched confirmation** (text or URL). Default to `Submitted (unconfirmed)`.
- **Always stop and ask** on: login wall, captcha, closed offer, unknown required field, visible page error, unrecognized multi-step form stage.
- **Keep the GIF intact** on error — never `unlink` it. It is the diagnostic evidence.
- **Never invent experience** in cover letters or free-text answers — stick strictly to the user's CV.
