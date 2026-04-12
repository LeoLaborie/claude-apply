# Workday apply playbook

This playbook is read by the agent when `/apply` detects a `*.myworkdayjobs.com` URL. It assumes that `apply.md` step 0 (tool loading, profile validation, CDP probe) has already been executed.

Follow this playbook **step by step**. At the slightest anomaly (captcha, unknown required field, submit error, unrecognized page), **STOP and ask the user** before continuing.

## 0. URL parsing and dedup

1. Import `parseWorkdayUrl` from `src/scan/ats/workday.mjs`.
2. Call `parseWorkdayUrl('$ARGUMENTS')` → `{ tenant, site, jobId }`.
3. If the parse returns `null` → STOP: "Invalid Workday URL. Expected format: `https://{tenant}.wd{N}.myworkdayjobs.com/{site}/job/{slug}/{jobId}`".
4. Check `data/applications.md`. If an entry already matches `$ARGUMENTS` with status `Applied`, `Submitted (unconfirmed)`, or `Failed`, ask the user before continuing.

## 1. Open tab, GIF, and blocker check

1. Open `$ARGUMENTS` in a new tab with `mcp__claude-in-chrome__tabs_create_mcp`.
2. Start GIF recording with `mcp__claude-in-chrome__gif_creator`. Name: `apply-workday-<tenant>-<YYYYMMDD-HHMM>.gif`.
3. Wait 2 seconds for JavaScript to load.
4. Call `read_page` to capture DOM + text.
5. **Blocker detection:** search the page for:
   - Closed offer: `no longer accepting`, `position filled`, `job expired` → status `Discarded`, log, stop.
   - Maintenance page: `maintenance`, `temporarily unavailable` → STOP, ask user.
   - 404 / error page → STOP, ask user.
6. **Pre-flight extension permission probe** (same as `apply.md` step 0.6): run `typeof document !== 'undefined' ? 'ok' : 'no document'` via `javascript_tool`. If permission error → STOP with the permission fix instructions.

## 2. Authentication

Import account helpers from `src/apply/workday/accounts.mjs`.

1. `readAccounts('config/workday-accounts.yml')` → `accounts[]`.
2. `findAccount(accounts, tenant)` → `account` or `undefined`.

### Case A — No account (signup)

1. Look for a "Create Account" or "Sign Up" link on the current page or the "Apply" / "Sign In" page. Navigate to it.
2. `generateEmail(profile.email, tenant)` → sub-addressed email (e.g. `alice+totalenergies@gmail.com`).
3. `generatePassword()` → 32-char base64url password.
4. Fill the signup form fields (email, password, confirm password) via `form_input` or `javascript_tool` (use the React native setter pattern from `apply.md` step 5 if inputs are React-controlled).
5. **Before submitting**, save credentials: `writeAccount('config/workday-accounts.yml', { tenant, email, password })`. This ensures the password is never lost even if signup fails.
6. Submit the signup form.
7. **Captcha** → STOP, ask the user to solve it, then type `continue`.
8. **Email verification required** → STOP, tell the user: "Workday requires email verification for `<email>`. Please check your inbox, click the verification link, and type `continue`." Once confirmed → `markVerified('config/workday-accounts.yml', tenant)`.
9. After successful signup, navigate back to `$ARGUMENTS` (the job URL).

### Case B — Existing account (login)

1. Click the "Apply" or "Sign In" button that leads to the login form.
2. Fill email and password from `account.email` and `account.password`.
3. Submit the login form.
4. **Credentials rejected** → STOP, ask the user. They may need to reset their password manually.
5. **Captcha / 2FA** → STOP, ask the user to resolve it.
6. If `account.email_verified === false` and the tenant requires verification → STOP as in Case A step 8.

### After authentication

The agent must now be on the application form for the job. If not auto-redirected, navigate to `$ARGUMENTS`. Click "Apply" if needed to enter the multi-step form. Confirm the page shows a form (not just the job description).

## 3. Step-by-step form filling

Import `detectStep` from `src/apply/workday/step-detect.mjs`.
Import `classifyField`, `mapProfileValue`, `classifyAddButton`, `countEntriesForSection` from `src/apply/field-classifier.mjs`.
Import `EXTRACT_LABEL_SRC` from `src/apply/dom-label.mjs`.

### Main loop

Repeat until step is `'review'`:

1. Call `read_page` → capture current URL and DOM content.
2. Extract `data-automation-id` attributes from the page via `javascript_tool`:
   ```javascript
   return [...document.querySelectorAll('[data-automation-id]')].map((el) =>
     el.getAttribute('data-automation-id')
   );
   ```
3. Call `detectStep({ url: currentUrl, domMarkers })` → step name.
4. If `'generic'` → **STOP**: "Unrecognized Workday step. URL: `<url>`. Ask the user what to do."
5. If `'review'` → exit the loop, go to step 4 (Review).
6. Fill the fields for the current step (see sub-sections below).
7. Click "Next" or "Save and Continue" via `find` + `click`.
8. Wait 2 seconds for the next page to load.

### Filling: my-information

Identity fields. Scan all `input`, `select`, `textarea` elements using the `EXTRACT_LABEL_SRC` + `extractLabel` pattern (same as `apply.md` step 4.2):

```javascript
${EXTRACT_LABEL_SRC}
const out = [];
for (const el of document.querySelectorAll('input, select, textarea')) {
  out.push({
    tag: el.tagName.toLowerCase(),
    name: el.name || '',
    id: el.id || '',
    type: el.type || '',
    placeholder: el.placeholder || '',
    required: el.required || el.hasAttribute('aria-required'),
    label: extractLabel(el),
  });
}
return out;
```

For each field, call `classifyField(field)` → canonical key. Then `mapProfileValue(key, profile)` → value. Fill using:

- `form_input` for static inputs
- React native setter pattern for React-controlled inputs (see `apply.md` step 5)
- Leave pre-filled fields (from Workday account data) as-is

Expected fields: first name, last name, email, phone, country, city, postal code, address.

### Filling: my-experience

1. **CV upload**: detect `input[type="file"]` in the page. If found:
   - Resolve CV path: `profile.cv_fr_path` or `profile.cv_en_path` based on `detectLanguage({ title: role, description: jdText })` from `src/apply/language-detect.mjs`.
   - Upload via CDP:
     ```bash
     node src/apply/upload-file.mjs \
       --url '<unique URL fragment>' \
       --selector 'input[type="file"]' \
       --file '<absolute cv path>'
     ```
   - On `CDP_PORT_DOWN` → warn the user to upload manually, then type `continue`.
   - After upload, wait 3 seconds. If Workday shows "auto-fill from resume" or pre-populates fields, verify and correct them.

2. **Experience entries**: look for "+ Add" buttons via `classifyAddButton`. For each experience in `profile.experiences`:
   - Click the add button
   - Fill: company, title, start date, end date, description via `classifyField` + `mapProfileValue` with `{ experienceIndex: i }`

3. **Education entries**: same pattern with `profile.education` and `{ educationIndex: i }`.

4. **Languages**: if language fields appear, fill from `profile.languages`.

### Filling: voluntary-disclosures

EEO questions. Scan radio/checkbox groups. For each question:

- Gender → `profile.gender` or "Decline to Self Identify"
- Ethnicity → `profile.ethnicity` or "Decline to Self Identify"
- Veteran status → `profile.veteran_status` or "Prefer not to say"

**Never guess.** If the profile value is `null`, always select the decline/prefer-not-to-say option.

Use `clickInQuestion(questionText, choiceLabel)` from `EXTRACT_LABEL_SRC` to click the right radio in the right question scope:

```javascript
${EXTRACT_LABEL_SRC}
return clickInQuestion('gender', 'Decline to Self Identify');
```

After each click, verify `element.checked` or `aria-checked`.

### Filling: self-identify

Typically disability self-identification. Same logic as voluntary-disclosures:

- `profile.disability_status` or "Prefer not to say" / "I don't wish to answer"

### Unknown or required fields

If `classifyField` returns `'unknown'` and the field is `required: true` → **STOP**: display `{ label, type, placeholder }` and ask the user for the value.

If `classifyField` returns `'unknown'` and the field is not required → leave empty, note in final report.

## 4. Review

The loop exited because `detectStep` returned `'review'`.

1. Call `read_page` to capture the review page content.
2. Scan the displayed summary for obviously empty or incorrect fields. If something looks wrong → flag to the user before submitting.
3. Capture `beforeUrl = window.location.href` via `javascript_tool`.
4. Note `startTime = Date.now()`.
5. Click "Submit Application" via `find` + `click`.

## 5. Confirmation detection (15s max)

Poll every 2 seconds, up to 15 seconds (7-8 attempts):

1. Get `afterUrl` via `javascript_tool`: `return window.location.href`.
2. Get `pageText` via `mcp__claude-in-chrome__get_page_text`.
3. Call `classifyConfirmation({ beforeUrl, afterUrl, pageText })` from `src/apply/confirmation-detector.mjs`.
4. Act on the result:
   - `"Applied"` → exit loop, record success.
   - `"Failed"` → STOP. Display the error. Check if a required field was wiped by a React re-render. If fixable, fix and retry submit once. If it fails again, stop.
   - `"Submitted (unconfirmed)"` → keep polling.

After 15 seconds with no definitive result → status `Submitted (unconfirmed)`.

## 6. Logging and final report

1. Stop the GIF recording → save the file.
2. Append to the apply log:
   ```javascript
   import { appendApplyLog } from './src/apply/apply-log.mjs';
   appendApplyLog('data/apply-log.jsonl', {
     url: '$ARGUMENTS',
     company: tenant,
     role,
     language,
     finalStatus, // 'Applied' | 'Submitted (unconfirmed)' | 'Failed' | 'Discarded'
     gifPath,
     durationMs: Date.now() - startTime,
     errors: [],
     notes: null,
   });
   ```
3. Update `data/applications.md`:
   - If a row for this company + role exists → update the Status column.
   - If not → append a new row with today's date, company, role, status.
4. Close the tab if status is `Applied`. Leave open otherwise for human review.
5. Print the final report:
   - **URL**: `$ARGUMENTS`
   - **Company / Role / Language**: extracted values
   - **Final status**: the confirmation result
   - **GIF**: absolute path to the recording
   - **Filled fields**: list of canonical keys that were filled
   - **Skipped fields**: list of non-required unknowns left empty
   - **Warnings**: any non-blocking anomaly encountered

## Absolute rules

- **Never click Submit with a required field empty** or filled with a guessed value.
- **Never guess EEO values** — use the profile value or "Prefer not to say" / "Decline to Self Identify".
- **Never write `Applied` without a matched confirmation** (text or URL). Default to `Submitted (unconfirmed)`.
- **Always stop and ask** on: captcha, unknown required field, unrecognized step (`'generic'`), credentials rejected, page error.
- **Keep the GIF intact** on error — never delete it. It is diagnostic evidence.
- **Never invent experience** — ground all answers in `config/cv.md` and the job description.
- **Credentials before submit** — always `writeAccount` before clicking the signup submit button.
