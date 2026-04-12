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
