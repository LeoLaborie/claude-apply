# Workday apply helpers — PR 9 (Plan 2/3)

**Status:** Design approved
**Branch:** `feat/apply-workday-helpers`
**Date:** 2026-04-12
**Depends on:** PR #8 (Workday scan, merged)

## Motivation

PR #8 added Workday support to `/scan`. The next step is `/apply` Workday, which requires account management (one account per tenant) and multi-step form navigation. This PR delivers the **pure helpers and their tests** — no playbook, no browser interaction, no doc changes. The playbook (`apply-workday.md`) and integration come in PR 10.

## Scope

- `src/apply/workday/accounts.mjs` — CRUD for `config/workday-accounts.yml`
- `src/apply/workday/step-detect.mjs` — step identification from URL + DOM markers
- `tests/apply/workday-accounts.test.mjs`
- `tests/apply/workday-step-detect.test.mjs`

## Out of scope (PR 10)

- `.claude/commands/apply-workday.md` playbook
- Changes to `apply.md` (dispatch to apply-workday)
- `CLAUDE.md` invariant change (account creation allowance)
- `docs/ats-support.md`, `docs/apply-workflow.md` updates
- `CHANGELOG.md` entry (deferred until apply is functional)

## Design

### Approach chosen

**Approach B** — sub-folder `src/apply/workday/` with 2 files. No `url-parse.mjs` re-export (the playbook imports `parseWorkdayUrl` directly from `src/scan/ats/workday.mjs`). Step signatures are inline in `step-detect.mjs` rather than a separate file.

Alternatives considered:
- **A (4 files per design spec):** Adds `url-parse.mjs` re-export and separate `step-signatures.mjs`. Rejected — unnecessary indirection for a one-line re-export and a ~8-entry constant.
- **C (flat in `src/apply/`):** No sub-folder, prefix files with `workday-`. Rejected — the sub-folder gives a cleaner boundary between Workday-specific and generic apply code.

### `accounts.mjs`

**File:** `src/apply/workday/accounts.mjs`

**Exports:**

```js
readAccounts(filePath)         → Account[]   // reads YAML, returns [] if file absent
findAccount(accounts, tenant)  → Account | undefined
writeAccount(filePath, entry)  → void        // append account, atomic write (tmp + rename)
markVerified(filePath, tenant) → void        // sets email_verified: true for tenant
generateEmail(profileEmail, tenant) → string // "leo+totalenergies@gmail.com"
generatePassword()             → string      // crypto.randomBytes(24).toString('base64url')
```

**YAML format** (`config/workday-accounts.yml`, gitignored):

```yaml
accounts:
  - tenant: totalenergies
    email: leo+totalenergies@gmail.com
    password: "xK9mP...base64url"
    created_at: 2026-04-12T10:00:00Z
    email_verified: false
```

**Details:**
- `readAccounts` uses `js-yaml` (already a project dependency). File absent → `[]`, no error.
- `writeAccount` and `markVerified` do read-modify-write with atomic write (`fs.writeFileSync` to `.tmp` + `fs.renameSync`). No lock — only one apply session runs at a time.
- `generateEmail` splits on `@`, inserts `+{tenant}` before `@`. If the local part already contains a `+` suffix (e.g. `leo+perso@gmail.com`), everything from the first `+` to `@` is replaced with `+{tenant}`. Throws on missing `@`.
- `generatePassword` is pure crypto, no arguments. Returns 32 URL-safe characters.

### `step-detect.mjs`

**File:** `src/apply/workday/step-detect.mjs`

**Exports:**

```js
detectStep({ url, domMarkers }) → string  // step name or 'generic'
```

Also exports `STEP_SIGNATURES` (named export, for tests only).

**Internal constant:**

```js
const STEP_SIGNATURES = [
  { step: 'my-information',       urlPattern: /\/myInformation\b/i,       domMarkers: ['myInformation-SectionTitle'] },
  { step: 'my-experience',        urlPattern: /\/myExperience\b/i,        domMarkers: ['myExperience-SectionTitle'] },
  { step: 'voluntary-disclosures', urlPattern: /\/voluntaryDisclosures\b/i, domMarkers: ['voluntaryDisclosures-SectionTitle'] },
  { step: 'self-identify',        urlPattern: /\/selfIdentify\b/i,        domMarkers: ['selfIdentify-SectionTitle'] },
  { step: 'review',               urlPattern: /\/review\b/i,              domMarkers: ['review-SectionTitle'] },
];
```

**Logic (two layers):**

1. **URL first** — test each `urlPattern` against the URL. First match wins.
2. **DOM fallback** — if no URL pattern matches, check if any signature's `domMarkers` appear in the provided `domMarkers` array (these are `data-automation-id` values extracted by the playbook via `javascript_tool`).
3. **No match** → `'generic'`.

URL takes priority over DOM when both match different steps.

## Testing

### `tests/apply/workday-accounts.test.mjs`

| Test | Verifies |
|---|---|
| `readAccounts` file absent → `[]` | No error, empty return |
| `readAccounts` valid file → `Account[]` | Correct YAML parse, all fields present |
| `findAccount` existing tenant | Returns correct account |
| `findAccount` absent tenant → `undefined` | |
| `writeAccount` on empty file | Creates YAML with one account |
| `writeAccount` on existing file | Appends without overwriting existing accounts |
| `writeAccount` atomicity | No `.tmp` file remains after operation |
| `markVerified` existing tenant | `email_verified` becomes `true`, rest unchanged |
| `markVerified` absent tenant → throw | Explicit error |
| `generateEmail` normal case | `leo@gmail.com` + `totalenergies` → `leo+totalenergies@gmail.com` |
| `generateEmail` no `@` → throw | |
| `generateEmail` existing sub-address | `leo+perso@gmail.com` + `sanofi` → `leo+sanofi@gmail.com` |
| `generatePassword` length + charset | 32 chars, base64url only |
| `generatePassword` uniqueness | 2 calls → 2 different values |

All I/O tests use `fs.mkdtempSync` tmpdir, cleaned in `after`.

### `tests/apply/workday-step-detect.test.mjs`

| Test | Verifies |
|---|---|
| URL only — one per step (5 cases) | `/myInformation` → `'my-information'`, etc. |
| DOM only — one per step (5 cases) | Generic URL + DOM marker → correct step |
| URL + DOM concordant | Returns the step |
| URL + DOM discordant | URL wins (documented priority) |
| No match → `'generic'` | Unknown URL + no DOM markers |
| `domMarkers` empty → URL-only fallback | |
| `url` empty → DOM-only fallback | |
| `STEP_SIGNATURES` exported and non-empty | Guard against accidental deletion |

No mock fetch, no browser — everything is pure.

## Dependencies

- `js-yaml` — already in `package.json`
- `node:crypto`, `node:fs`, `node:path` — built-in
- No new dependencies to install

## Risks

- **`generateEmail` sub-addressing:** Not all providers support `+tag`. The playbook (PR 10) will ask user confirmation before submitting signup. Acceptable.
- **`STEP_SIGNATURES` incomplete:** Workday tenants vary. Unknown steps return `'generic'`, playbook STOPs. Safe by design — signatures will be enriched as tenants are encountered.

## Delivery

- **Branch:** `feat/apply-workday-helpers`
- **Commit:** `feat(apply): add Workday account manager and step detector (Plan 2/3)`
- **Validation:** `npm test`, `npm run lint`, `npm run check:pii`
