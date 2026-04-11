# Workday support for /scan and /apply

**Status:** Design approved, pending implementation plan
**Branch:** `feat/scan-workday`
**Date:** 2026-04-11

## Motivation

`claude-apply` currently supports Lever, Greenhouse, and Ashby. These three ATSes cover most startup and mid-size tech hiring, but the CAC40 and larger European enterprises sit almost entirely on Workday, SuccessFactors, and Taleo. Without Workday, users targeting TotalEnergies, Sanofi, Schneider, Capgemini, Orange, LVMH, Dassault, and ~12 other CAC40 companies cannot use the tool at all.

Workday alone covers roughly 60% of the CAC40 and a large share of Fortune 500 hiring, so it is the highest-leverage ATS to add.

## Scope

- `/scan` Workday: new fetcher, new `verifySlug` branch, new `portals.yml` schema variant.
- `/apply` Workday: full end-to-end account creation, login, multi-step form navigation, submit, confirmation detection.
- Update `CLAUDE.md` to allow account creation (see Invariant Change below).
- Update `docs/ats-support.md` and `CHANGELOG.md`.

Out of scope: SuccessFactors, Taleo, generic Workday multi-language beyond the tenant's default language (the classifier already handles FR/EN at the field level).

## Invariant change

`CLAUDE.md` currently says *"Never bypass a login or evade anti-bot measures."* This blocks Workday entirely because Workday requires an account per tenant before listing any application form.

The invariant becomes:

> Never bypass a login you don't own. Account creation with the user's own credentials is allowed and expected for ATSes that require it (e.g., Workday). Captcha solving and email verification loops remain user-driven — `/apply` stops and asks the user to complete them manually.

The adjacent invariants are unchanged:
- Never solve a captcha.
- Never submit without filled + verified required fields.
- Never invent experience.
- Stop on ambiguity.

## Architecture

Two independent subsystems, linked only by `platform: workday` in `config/portals.yml`.

### Scan subsystem

Single new fetcher file: `src/scan/ats/workday.mjs`, following the same structure as `lever.mjs` / `greenhouse.mjs` / `ashby.mjs` (one file holding both `fetchWorkday` and `verifySlug`, matching the convention established in PR #7).

```
parseWorkdayUrl(url) → { tenant, pod, site }   // pure helper, exported for tests + apply side
fetchWorkday(url, companyName) → Offer[]
verifySlug(url) → { ok: boolean, reason?: string }
```

Workday exposes a public JSON API for job listings at:

```
POST https://{tenant}.wd{pod}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
Content-Type: application/json
Body: { "appliedFacets": {}, "limit": 20, "offset": 0, "searchText": "" }
```

The response contains `jobPostings[]` with `title`, `externalPath`, `locationsText`, `postedOn`, `bulletFields`. The fetcher paginates by incrementing `offset` until `jobPostings.length < limit`. Each posting maps to the existing `Offer` contract, with `url = https://{tenant}.wd{pod}.myworkdayjobs.com{externalPath}`, `platform: 'workday'`.

`parseWorkdayUrl` is shared by `fetchWorkday` and `verifySlug`. `verifySlug` sends a single-page jobs request and returns `ok: true` on HTTP 200 with a valid JSON body containing a `jobPostings` array (even if empty), `ok: false` otherwise.

`src/scan/ats-detect.mjs` gains three edits: a `workday` entry in `PATTERNS` (regex `^https?:\/\/([^.]+)\.wd\d+\.myworkdayjobs\.com\/`), `workday` added to `VERIFIABLE_PLATFORMS`, and one new host in `SUPPORTED_HOSTS` (`https://*.myworkdayjobs.com/*`). Because Workday URLs need full parsing (tenant + pod + site), `detectPlatform` returns the full URL as the `slug` field for Workday, and `verifyCompany` passes that URL straight to `workday.verifySlug(slug)` without any branch rewrite — the existing `mod.verifySlug(slug)` call just works.

### Apply subsystem

`/apply` is a Claude Code slash command implemented as a markdown playbook at `.claude/commands/apply.md`, not a Node CLI. The agent executes the playbook step by step, calling testable Node helpers (`field-classifier`, `confirmation-detector`, `upload-file`, `dom-label`) along the way. Workday support follows the same pattern: **orchestration lives in markdown, logic lives in pure helpers**.

**New slash command** `.claude/commands/apply-workday.md`. A separate file rather than inlining into `apply.md`, because the Workday flow (account creation + email verification pause + multi-step navigation + signup captcha handling) is long enough that merging it would roughly double `apply.md`. `apply.md` gains a short early dispatch: if the URL host matches `*.myworkdayjobs.com`, stop and tell the user to run `/apply-workday <url>` instead.

**New helpers** under `src/apply/workday/` — all pure, all unit-testable, no browser or network side effects:

```
src/apply/workday/
  url-parse.mjs         - re-exports parseWorkdayUrl from src/scan/ats/workday.mjs
  accounts.mjs          - readAccounts(path), findAccount(accounts, tenant),
                          writeAccount(path, entry), markVerified(path, tenant),
                          generateEmail(profileEmail, tenant),
                          generatePassword() — crypto.randomBytes(24).toString('base64url')
  step-detect.mjs       - detectStep({url, domMarkers}) → stepName | 'generic', pure function
  step-signatures.mjs   - const STEP_SIGNATURES: URL regexes + DOM marker lists per known step
```

No `state-machine.mjs`, no `session.mjs`, no error classes — the state machine lives inside the `apply-workday.md` playbook as a "Repeat until Review" loop, and error handling is the playbook telling the agent "STOP and say X" (same pattern `apply.md` currently uses for login walls and captchas). Typed error classes would only be useful if a Node-side caller caught them, which there isn't.

`parseWorkdayUrl` is defined once in `src/scan/ats/workday.mjs` (where the scan fetcher needs it) and re-exported from `src/apply/workday/url-parse.mjs` so the apply side has a stable import path without crossing the scan/apply module boundary in application code.

## Data flow

### Scan

1. `/scan` reads `config/portals.yml`.
2. For each entry with `platform: workday`, parse `url` → `{tenant, pod, site}`.
3. Call `fetchWorkday(url, company)` → `Offer[]`.
4. Dedup via existing `scan-history.tsv`, append new rows to `data/pipeline.md`.

No change to `pipeline.md` format or downstream consumers.

### Apply

The agent follows `.claude/commands/apply-workday.md` which encodes this flow:

```
/apply-workday <workday-url>
  │
  ├─ First-run guard (config/candidate-profile.yml exists), tool load, CDP probe
  │  (copied from apply.md steps 0.1–0.5)
  │
  ├─ Parse URL via parseWorkdayUrl → {tenant, pod, site}
  ├─ readAccounts('config/workday-accounts.yml') → find entry for tenant
  │
  ├─ Open tab, start GIF, navigate to URL, click "Apply" button
  │
  ├─ Branch: login wall detection
  │    │
  │    ├─ No stored account → signup sub-flow:
  │    │    1. generateEmail(profile.email, tenant), generatePassword()
  │    │    2. writeAccount(...) with email_verified: false   ← persisted BEFORE filling the form
  │    │    3. Fill signup form (email, password, confirm, first name, last name)
  │    │    4. Submit
  │    │    5. If captcha → STOP: "Captcha on signup. Solve manually in Chrome, rerun /apply-workday <url>."
  │    │    6. STOP: "Check your inbox for the Workday verification email for {tenant}, click the link, rerun /apply-workday <url>."
  │    │
  │    └─ Stored account → login sub-flow:
  │         1. Fill email + password, submit
  │         2. If captcha → STOP (same message pattern)
  │         3. If "email not verified" banner → STOP: "Verification still pending for {tenant}, click the email link, rerun /apply-workday <url>."
  │         4. If invalid creds error → STOP: "Stored password rejected for {tenant}. Delete the entry from config/workday-accounts.yml and rerun /apply-workday <url>."
  │         5. On success, markVerified('config/workday-accounts.yml', tenant) if entry was not yet verified
  │
  ├─ State machine loop (repeat until step === 'review'):
  │    1. read_page → capture URL + DOM
  │    2. detectStep({url, domMarkers}) → stepName
  │    3. Fill this page using the existing field-classifier + mapProfileValue (playbook step 4–5 from apply.md, reused verbatim)
  │    4. If any required field is 'unknown' → STOP and ask the user (same invariant as apply.md)
  │    5. Click "Next" / "Save and Continue"
  │    6. Re-run captcha + unknown-step checks:
  │       - captcha detected → STOP
  │       - detectStep returns 'generic' AND classifier finds zero fillable fields → STOP: "Unknown Workday step at {url}. Paste the DOM to the user for diagnostics."
  │
  ├─ Review page: human summary → click Submit
  │
  └─ Existing confirmation-detector → applications.md + apply-log.jsonl
```

All STOPs are markdown instructions to the agent, not thrown exceptions. Re-running `/apply-workday <url>` resumes from the current state because the Chrome session persists cookies and Workday preserves the draft server-side.

## Credential storage

New file: `config/workday-accounts.yml` (gitignored, created on demand).

```yaml
accounts:
  - tenant: totalenergies
    email: user+totalenergies@example.com
    password: "xK9mP...base64url"
    created_at: 2026-04-11T22:40:00Z
    email_verified: true
  - tenant: sanofi
    email: user+sanofi@example.com
    password: "zQ2nR...base64url"
    created_at: 2026-04-11T22:45:00Z
    email_verified: false
```

Plaintext, gitignored, same directory as the rest of `config/` (which already holds PII). Upgrade path to an encrypted file or OS keyring stays behind the `src/apply/workday/accounts.mjs` interface.

Email generation: take `email` from `config/candidate-profile.yml`, split on `@`, inject `+{tenant}` before the `@`. Relies on sub-addressing (works on Gmail, Fastmail, ProtonMail with plus-addressing enabled). Password generation: `crypto.randomBytes(24).toString('base64url')` → 32 URL-safe characters.

Atomic writes: write to `workday-accounts.yml.tmp`, `fs.rename` into place. Concurrent `/apply-workday` runs are not expected (the agent runs one at a time), so no lock file.

## Step detection

`detectStep({url, domMarkers})` is a pure function that receives the current URL string and an array of DOM markers the agent already captured (via a `read_page` call). It returns a step name or `'generic'`.

Two-layer matching driven by `STEP_SIGNATURES`:

1. **URL regex** — Workday URLs contain step markers like `/myInformation`, `/myExperience`, `/voluntaryDisclosures`, `/selfIdentify`, `/review`. Each known step has a regex tested against the URL.
2. **DOM marker fallback** — if URL is ambiguous (some tenants use generic URLs), check for known `data-automation-id` attributes (`myInformation-SectionTitle`, `myExperience-SectionTitle`, etc.). The playbook extracts these via `javascript_tool` and passes them into `detectStep` as an array.

If neither layer matches, return `'generic'`. The playbook handles that case explicitly: if the classifier then finds zero fillable fields, STOP and ask the user.

The agent does not call `detectStep` directly from the browser — it runs the Node helper with the captured URL and markers as arguments. Same pattern as `classifyField` today.

## Handling of STOP conditions

There are no typed error classes. The `apply-workday.md` playbook enumerates each STOP condition inline with the exact user-facing message, matching the style of `apply.md`:

| Condition | User-facing message |
|---|---|
| Captcha detected on signup/login/any step | "Captcha on {tenant}. Solve it manually in Chrome, then rerun /apply-workday {url}." |
| New account created | "Check your inbox for the Workday verification email for {tenant}, click the link, then rerun /apply-workday {url}." |
| Login succeeds but shows "verify your email" banner | "Verification still pending for {tenant}. Click the link in your inbox, then rerun /apply-workday {url}." |
| Stored creds rejected | "Stored password rejected for {tenant}. Delete the entry from config/workday-accounts.yml and rerun /apply-workday {url}." |
| Unknown step (generic + zero fields) | "Unknown Workday step at {url}. DOM dumped. Ask Leo for help, or add the step signature to step-signatures.mjs." |
| Signup explicitly refused (domain banned, etc.) | "Signup refused for {tenant} (likely domain rejection). Create the account manually in Chrome, add it to config/workday-accounts.yml, then rerun." |

## Testing

| Test file | What it covers |
|---|---|
| `tests/scan/ats-workday.test.mjs` | `parseWorkdayUrl` (valid, invalid, missing pod/site), `fetchWorkday` against captured JSON fixtures (single page + multi-page pagination), `verifySlug` ok/ko against mocked fetch |
| `tests/scan/ats-detect.test.mjs` (extended) | Workday pattern matching, `VERIFIABLE_PLATFORMS` + `SUPPORTED_HOSTS` include workday |
| `tests/scan/verify-company.test.mjs` (extended) | Workday dispatch path end-to-end with mocked fetch |
| `tests/apply/workday-url-parse.test.mjs` | `parseWorkdayUrl` re-export from url-parse.mjs |
| `tests/apply/workday-accounts.test.mjs` | YAML read/write roundtrip, atomic write, `findAccount`, `markVerified`, `generateEmail`, `generatePassword` determinism with seeded RNG |
| `tests/apply/workday-step-detect.test.mjs` | `detectStep` over URL-only, DOM-only, both, and neither cases, one test per step in `STEP_SIGNATURES` |

No E2E Workday test runs in CI — no public test tenant exists. Manual smoke test procedure documented in `docs/testing.md` under a new "Workday manual checks" section.

PII gate: `scripts/check-no-pii.sh` already ignores `config/`. `workday-accounts.yml` is covered by that existing rule.

## Documentation updates

- `docs/ats-support.md` — new Workday row: scan ✅, apply ✅ (with caveats), auth: account per tenant.
- `docs/apply-workflow.md` — new section "Workday multi-step flow".
- `docs/extending.md` — reference the Workday state machine as the canonical example of a multi-step ATS.
- `CHANGELOG.md` — `feat(scan): add Workday fetcher`, `feat(apply): add Workday state machine`.
- `CLAUDE.md` — invariant change per "Invariant change" section above.
- `.claude/commands/onboard.md` — WebSearch template for Workday URLs when discovering target companies.

## Out of scope / future work

- SuccessFactors, Taleo, iCIMS — same design pattern can be reused but not implemented here.
- Encrypted credential storage (age, keyring).
- Auto-resume after email verification (would require IMAP).
- Workday pages that require a specific locale beyond tenant default.
- Batch `/apply` across multiple Workday tenants in one run.
