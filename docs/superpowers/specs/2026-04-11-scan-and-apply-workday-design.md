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

Single new fetcher: `src/scan/ats/workday.mjs`.

```
fetchWorkday(url, companyName) → Offer[]
verifyWorkdaySlug(url) → { ok: boolean, reason?: string }
```

Workday exposes a public JSON API for job listings at:

```
POST https://{tenant}.wd{pod}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
Content-Type: application/json
Body: { "appliedFacets": {}, "limit": 20, "offset": 0, "searchText": "" }
```

The response contains `jobPostings[]` with `title`, `externalPath`, `locationsText`, `postedOn`, `bulletFields`. The fetcher paginates by incrementing `offset` until `jobPostings.length < limit`. Each posting maps to the existing `Offer` contract, with `url = https://{tenant}.wd{pod}.myworkdayjobs.com{externalPath}`, `platform: 'workday'`.

The URL parser in `workday.mjs` extracts `tenant`, `pod`, and `site` from the `portals.yml` URL field and is reused by both `fetchWorkday` and `verifyWorkdaySlug`. `verifyWorkdaySlug` sends a single-page jobs request and returns `ok: true` if the response has a valid body and any `jobPostings` (or zero postings without a 404), `ok: false` otherwise.

`src/scan/verify-company.mjs` (the dispatcher added in PR #7) gains a `workday` branch routing to `verifyWorkdaySlug`. `getSupportedHosts()` gains `*.myworkdayjobs.com`.

### Apply subsystem

New module `src/apply/workday/`:

```
src/apply/workday/
  index.mjs          - entry point, called from src/apply/index.mjs when platform === 'workday'
  state-machine.mjs  - main loop, step detection, handler dispatch
  account.mjs        - signup/login flow, credential generation
  session.mjs        - login-wall detection, captcha detection, resume-from-state
  steps/
    my-information.mjs
    my-experience.mjs
    application-questions.mjs
    voluntary-disclosures.mjs
    self-identify.mjs
    review.mjs
    generic.mjs      - fallback, delegates to existing classifier
```

New shared utility: `src/lib/workday-accounts.mjs` (YAML I/O for credential file).

`src/apply/index.mjs` gains an early dispatch at the top: if the detected platform is `workday`, call `src/apply/workday/index.mjs` and return. All other platforms continue through the existing single-page classifier path.

## Data flow

### Scan

1. `/scan` reads `config/portals.yml`.
2. For each entry with `platform: workday`, parse `url` → `{tenant, pod, site}`.
3. Call `fetchWorkday(url, company)` → `Offer[]`.
4. Dedup via existing `scan-history.tsv`, append new rows to `data/pipeline.md`.

No change to `pipeline.md` format or downstream consumers.

### Apply

```
/apply <workday-url>
  │
  ├─ detect platform = workday → delegate to workday/index.mjs
  │
  ├─ parse tenant from URL
  ├─ load config/workday-accounts.yml
  │
  ├─ navigate to URL, click "Apply" button
  │
  ├─ if login wall:
  │    ├─ no account stored → signup:
  │    │    ├─ generate email = {user.local}+{tenant}@{user.domain}
  │    │    ├─ generate password = crypto.randomBytes(24).toString('base64url')
  │    │    ├─ write account entry immediately (email_verified: false)
  │    │    ├─ fill signup form, submit
  │    │    ├─ if captcha → throw WorkdayCaptchaError (STOP)
  │    │    └─ throw WorkdayEmailVerificationPendingError (STOP)
  │    │       "Check your inbox and click the Workday verification link, then rerun /apply"
  │    │
  │    └─ account stored → login:
  │         ├─ fill email + password, submit
  │         ├─ if captcha → throw WorkdayCaptchaError
  │         ├─ if "email not verified" → throw WorkdayEmailVerificationPendingError
  │         └─ if invalid creds → throw WorkdayLoginError
  │
  ├─ on first successful login, set email_verified: true in yaml
  │
  ├─ state machine loop:
  │    while currentStep !== 'review':
  │      step = detectStep(page.url, page.dom)
  │      handler = steps[step] ?? steps.generic
  │      await handler(page, profile, cv)
  │      await clickNext(page)
  │      if captchaDetected(page) → throw WorkdayCaptchaError
  │      if unknownBlocker(page) → throw WorkdayUnknownStepError
  │
  ├─ review page: extract summary, clickSubmit
  │
  └─ existing confirmation detector → applications.md + apply-log.jsonl
```

Each thrown error carries a `resumeHint` string. The `/apply` CLI catches these errors, prints the hint, and exits non-zero. Re-running `/apply <url>` resumes from current state because the Chrome session persists cookies and Workday preserves the draft server-side.

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

Plaintext, gitignored, same directory as the rest of `config/` (which already holds PII). Upgrade path to an encrypted file or OS keyring is preserved behind `src/lib/workday-accounts.mjs`.

Email generation: take `email` from `config/candidate-profile.yml`, split on `@`, inject `+{tenant}` before the `@`. Relies on sub-addressing (works on Gmail, Fastmail, ProtonMail). Password generation: `crypto.randomBytes(24).toString('base64url')` → 32 chars, URL-safe.

Atomic writes: write to `workday-accounts.yml.tmp`, `fs.rename` into place. A single-process lock file guards concurrent `/apply` runs.

## Step detection

`detectStep(url, dom)` uses a two-layer approach:

1. **URL regex** — Workday URLs contain step markers like `/myInformation`, `/myExperience`, `/voluntaryDisclosures`, `/review`. A lookup table maps these to step names.
2. **DOM marker fallback** — if URL is ambiguous (some tenants use generic URLs), check for known H1 text or data-automation-id attributes (`data-automation-id="myExperience-SectionTitle"`).

If neither layer matches, return `generic`. If the generic handler cannot find any fillable field either, throw `WorkdayUnknownStepError` with the current URL and a DOM dump path.

## Error handling

Typed error classes in `src/apply/workday/errors.mjs`, following the `UploadError` pattern:

| Error | When | Resume hint |
|---|---|---|
| `WorkdayLoginError` | Invalid creds | "Stored password rejected. Delete `config/workday-accounts.yml` entry for {tenant} and rerun." |
| `WorkdayCaptchaError` | Captcha DOM detected | "Captcha on {tenant}. Solve it manually in Chrome, then rerun /apply {url}." |
| `WorkdayEmailVerificationPendingError` | New signup or unverified login | "Check your inbox for the Workday verification email, click the link, then rerun /apply {url}." |
| `WorkdayUnknownStepError` | No handler matched, generic failed | "Unknown step at {url}. DOM dumped to {path}. Open an issue or add a handler." |
| `WorkdaySignupBlockedError` | Signup form explicitly refuses | "Signup refused (likely domain rejection). Manually create the account in Chrome, then rerun." |

## Testing

| Test file | What it covers |
|---|---|
| `tests/scan/ats/workday.test.mjs` | URL parser, `fetchWorkday` mapping against captured JSON fixtures from 2-3 real tenants, pagination |
| `tests/scan/verify-company.test.mjs` (extended) | Workday dispatch branch |
| `tests/apply/workday/state-machine.test.mjs` | `detectStep()` against captured HTML fixtures for each known step |
| `tests/apply/workday/account.test.mjs` | Email/password generation, deterministic with seeded RNG |
| `tests/lib/workday-accounts.test.mjs` | YAML read/write roundtrip, atomic write, lock file |
| `tests/apply/workday/errors.test.mjs` | Error class hierarchy, resumeHint format |

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
