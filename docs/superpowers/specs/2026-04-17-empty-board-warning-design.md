# Empty-board warning — design

**Issue:** [#44](https://github.com/LeoLaborie/claude-apply/issues/44) — `verifyCompany` returns `ok:true` for empty boards (count=0) with no warning.

**Date:** 2026-04-17

## Problem

`verifyCompany('https://jobs.ashbyhq.com/vercel')` returns `{ok: true, count: 0}`. The endpoint is live, but the board exposes zero public jobs. Two indistinguishable cases collapse into the same success response:

1. The company has a hiring freeze or paused listings — the slug is correct.
2. The slug is wrong (`vercel` instead of `vercel-careers`) or the company has moved off Ashby — the slug is stale.

Today, `/scan` prints `✓ Vercel — 0 raw, 0 new` next to companies with hundreds of offers, and `/apply-onboard:companies` writes `portals.yml` without asking the user to confirm. Silent failure at onboarding is the worst shape: the user assumes the pipeline is healthy.

## Goals

- Surface `count === 0` as a distinct state from `count > 0`, without breaking the existing `{ok: true, count: N}` contract.
- Emit a visible `⚠` in the `/scan` summary so the user can immediately spot suspicious entries.
- Force the user to confirm empty boards during `/apply-onboard:companies` before they land in `portals.yml`.

## Non-goals

- Auto-correcting wrong slugs. That's `discoverCompany`'s job (step 5b of onboarding).
- Distinguishing "slug moved" from "hiring freeze" heuristically. The user decides.
- Changing the per-ATS `verifySlug` contracts. They keep returning `{ok: true, count: N}` unchanged.

## Architecture

Three isolated changes, each testable independently:

| Module | Change | Tests |
|---|---|---|
| `src/scan/ats-detect.mjs` | `verifyCompany` adds `warning` when `ok && count === 0` | `tests/scan/verify-company.test.mjs` |
| `src/scan/index.mjs` | `runScan` populates `warning` on `perCompany` when `raw === 0 && !error`; `formatSummary` renders `⚠` | `tests/scan/scan.test.mjs` |
| `.claude/commands/apply-onboard/companies.md` | New step 5c — batch-confirm empty boards | Agent instruction, no unit test |

No new modules. All existing callers of `verifyCompany` continue to work — the new `warning` field is additive.

## Component 1 — `verifyCompany` warning

**File:** `src/scan/ats-detect.mjs`

The dispatcher inspects the `verifySlug` result and injects a `warning` when `count === 0`. Per-ATS `verifySlug` implementations are unchanged.

```js
export async function verifyCompany(careersUrl) {
  const det = detectPlatform(careersUrl);
  if (!det) return { ok: false, reason: 'unknown platform' };
  const { platform, slug } = det;
  if (!VERIFIABLE_PLATFORMS.has(platform)) {
    return { ok: false, reason: `platform ${platform} not supported by verifySlug` };
  }
  const mod = await import(`./ats/${platform}.mjs`);
  const result = await mod.verifySlug(slug);
  if (result.ok && result.count === 0) {
    return { ...result, warning: 'board live but empty — possibly wrong slug' };
  }
  return result;
}
```

### Contract after change

- `{ok: true, count: N}` where `N > 0` — healthy board (unchanged).
- `{ok: true, count: 0, warning: 'board live but empty — possibly wrong slug'}` — **new**.
- `{ok: false, status, reason}` — unreachable board (unchanged).

### Tests

Add to `tests/scan/verify-company.test.mjs`:

1. `verifyCompany — count=0 on Ashby adds warning` — mock Ashby returning `{jobs: []}`, assert `{ok: true, count: 0, warning: /empty/}`.
2. `verifyCompany — count=0 on Lever adds warning` — symmetric for Lever.
3. `verifyCompany — count>0 does not add warning` — regression guard; assert no `warning` key.
4. `verifyCompany — ok:false does not add warning` — warning only rides on successful responses.

## Component 2 — `/scan` summary

**Files:** `src/scan/index.mjs`, `tests/scan/scan.test.mjs`

### `runScan` change

`runScan` does not call `verifyCompany` — it calls `fetchX` directly and already knows the raw count per company. So it applies the same policy locally: when `companyRaw === 0 && !companyErr`, it attaches a `warning` to the `perCompany` entry. The `warning` field is `null` otherwise (symmetric with `error`).

Locate the `perCompany.push({...})` block (around src/scan/index.mjs:255) and extend it:

```js
const warning =
  !companyErr && companyRaw === 0 ? 'board live but empty — possibly wrong slug' : null;
perCompany.push({
  company: companyName,
  platform,
  count: companyRaw,
  newCount: companyNew,
  error: companyErr,
  warning,
});
```

`warning` and `error` are mutually exclusive: when `error` is set, `warning` is always `null`.

### `formatSummary` change

Replace the `mark`/`note` computation:

```js
const mark = c.error ? '✗' : c.warning ? '⚠' : '✓';
const note = c.error
  ? `(${c.error})`
  : c.warning
    ? `(${c.platform} — ${c.warning})`
    : `(${c.platform})`;
lines.push(`  ${mark} ${c.company.padEnd(18)} ${String(c.count).padStart(3)} offres ${note}`);
```

Rendered summary sample:

```
  ✓ Anthropic          42 offres (lever)
  ⚠ Vercel              0 offres (ashby — board live but empty — possibly wrong slug)
  ✗ Broken Corp         0 offres (HTTP 404)
```

The live progress line (`onProgress` callback) is not changed — warnings are a summary-time concern, not per-tick.

### Tests

Add to `tests/scan/scan.test.mjs`:

1. `runScan — perCompany.warning is set when raw=0 without error`
2. `runScan — perCompany.warning is null when raw>0`
3. `runScan — perCompany.warning is null when there is an error` (warning/error exclusivity)
4. `formatSummary — renders ⚠ for a company with a warning` — assert the output contains `⚠ Vercel` and `board live but empty`.

## Component 3 — `/apply-onboard:companies` confirmation

**File:** `.claude/commands/apply-onboard/companies.md`

Insert a new step 5c between 5b (smart slug discovery) and 6 (trim + approval). Agent-only instruction; no code change.

```markdown
### 5c. Confirm empty boards

After step 5 + 5b, some candidates may have returned
`{ok: true, count: 0, warning: ...}` — the board is live but currently
exposes zero public jobs. This is ambiguous: the company may genuinely
have a hiring freeze, OR the slug may be wrong (e.g. `vercel` vs
`vercel-careers`).

If N ≥ 1 candidates carry a `warning`, present the list in a compact
table:

    Company         ATS     Careers URL
    ────────────────────────────────────────────────
    Vercel          ashby   https://jobs.ashbyhq.com/vercel

Then call `AskUserQuestion` once with these exact options:

- `"Drop all empty boards"` — remove every empty-board candidate from
  the list before step 6.
- `"Keep all empty boards"` — proceed with them into the step-6
  approval table as-is.
- `"Let me decide per company"` — loop over each empty-board candidate
  and call `AskUserQuestion` with options `Keep`, `Drop`, `Edit URL`.
  On `Edit URL`, ask the user for the corrected URL and re-verify it
  via step 5 (`verifyCompany`). If the new URL also returns
  `count: 0`, ask again. If it returns `ok: false`, drop.

If no candidate has a `warning`, skip this step silently.
```

The approval gate added in PR #55 (hash-based `assertPortalsApproved`) continues to work — the list submitted to `markPortalsApproved` is whatever survives 5c.

## Data flow

```
/scan:
  runScan → fetchX → perCompany[].warning → formatSummary → ⚠ in stdout

/apply-onboard:companies:
  candidates → verifyCompany → {warning?} → step 5c (AskUserQuestion batch)
             → step 6 (approval table + AskUserQuestion) → markPortalsApproved
             → assertPortalsApproved → Write portals.yml
```

## Error handling

- `verifyCompany` on a non-200 board still returns `{ok: false, ...}` — no warning.
- `runScan` on a fetch error still sets `error` on `perCompany` — no warning (mutually exclusive).
- The warning string is a constant, not a user-facing localized message. Agent instruction in 5c renders it verbatim.

## Testing

- **Unit:** 4 new tests in `verify-company.test.mjs`, 4 new in `scan.test.mjs`. Baseline 410 tests must still pass.
- **Manual:** Re-run `/scan` against a portal configured with a dead slug (e.g. a stale Ashby slug) and confirm the `⚠` line in the summary.
- **Manual:** Run `/apply-onboard:companies` with one known-empty board in the candidate set; confirm step 5c triggers and accepts all three response paths.

## Risk and rollback

- **Backward compatibility:** The `warning` field is additive. Existing callers that only read `ok` and `count` are unaffected. `/apply-onboard:companies` already references `count: 0` in its docs — this change makes the flag programmatic.
- **Rollback:** Single-PR revert restores the previous behavior. No migration, no state file changes.

## Out of scope

- Rewriting per-ATS `verifySlug` to classify dead vs alive boards more finely.
- Adding a `suspect_slugs` cache or history file.
- Changing `fetchX` fetchers — they already return zero jobs on empty boards, and that path is handled end-to-end by the `warning` propagation above.
