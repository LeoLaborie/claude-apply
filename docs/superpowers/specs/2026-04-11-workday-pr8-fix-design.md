# Workday PR #8 fix — design

**Date:** 2026-04-11
**Branch:** `feat/scan-workday`
**PR:** [#8](https://github.com/LeoLaborie/claude-apply/pull/8)
**Trigger:** code review on PR #8 found two real bugs (confidence ≥ 80).

## Problem

The Workday `/scan` support added in PR #8 has two correctness bugs that the existing test suite did not catch:

1. **`fetchWorkday` is not wired into the scan dispatcher.** `src/scan/index.mjs` defines a static `DISPATCH` map (`{ lever, greenhouse, ashby }`) and PR #8 never added a `workday` entry. Any Workday company in `portals.yml` falls through to the `'no fetcher'` branch at `src/scan/index.mjs:53-55` and silently produces zero offers. The dispatcher path of `verifyCompany` was extended (it uses dynamic import), but the scan path was not.

2. **`detectPlatform`'s Workday regex does not strip the locale segment.** Commit `592a9de` fixed `parseWorkdayUrl` in `src/scan/ats/workday.mjs` to handle URLs with `/{locale}/` (e.g. `/en-US/`), but the parallel regex in `src/scan/ats-detect.mjs:11` was not updated. For a real-world URL like `https://totalenergies.wd3.myworkdayjobs.com/en-US/TotalEnergies_careers`, `detectPlatform` captures `…/en-US` as the slug, and the downstream `verifySlug` / `fetchWorkday` calls then re-parse a malformed slug — either failing to match or hitting the wrong API endpoint (`.../cxs/totalenergies/en-US/jobs`).

The deeper issue is that there is **no end-to-end integration test** exercising a Workday company through `fetchCompanyOffers` in `src/scan/index.mjs`. PR #8's tests cover `parseWorkdayUrl`, `fetchWorkday`, `verifySlug`, and `detectPlatform` in isolation, but never in composition. Either bug would have been caught immediately by such a test.

## Goals

- Make Workday companies actually produce offers when scanned.
- Make `detectPlatform` handle locale-prefixed Workday URLs consistently with `parseWorkdayUrl`.
- Add an integration test that exercises the full scan path for Workday, so this class of regression cannot recur silently.

## Non-goals

- Refactoring `verifyCompany` or unifying the dispatch mechanisms between scan and verify.
- Centralising the Workday regex into a single source of truth (a tempting follow-up, but out of scope for a PR-#8 fix).
- CHANGELOG update — the existing PR #8 CHANGELOG entry already advertises Workday scan support; this is a pre-merge fix, not a user-visible behaviour change.
- Touching `verifySlug`'s `count` field semantics or the `body: ''` decision — both were flagged at lower confidence in review and are intentional/deferred.

## Design

### Section 1 — `src/scan/index.mjs`: wire Workday into `DISPATCH`

Add an import alongside the existing fetcher imports:

```js
import { fetchWorkday } from './ats/workday.mjs';
```

Add the entry to the `DISPATCH` map:

```js
const DISPATCH = {
  lever: fetchLever,
  greenhouse: fetchGreenhouse,
  ashby: fetchAshby,
  workday: fetchWorkday,
};
```

The signature is compatible: `fetchCompanyOffers` calls `fn(det.slug, company.name)` and `fetchWorkday(slug, company)` accepts the full URL as its first argument (it re-parses via `parseWorkdayUrl`). No call-site changes needed.

### Section 2 — `src/scan/ats-detect.mjs`: handle locale prefix in detection

Mirror the optional locale group from `parseWorkdayUrl` into the `PATTERNS` regex:

```js
{
  platform: 'workday',
  re: /^(https?:\/\/[^.]+\.wd\d+\.myworkdayjobs\.com(?:\/[a-z]{2}-[A-Z]{2})?\/[^\/?#]+)/i,
},
```

The capture group still includes the entire URL prefix (locale segment included when present). This is intentional — `parseWorkdayUrl`, called downstream by both `fetchWorkday` and `verifySlug`, already strips the locale, so the captured slug remains a valid input for both.

### Section 3 — Integration test

Add an integration-style test that exercises `fetchCompanyOffers` end-to-end for Workday. Two strategies are possible; pick whichever fits the existing `tests/scan/scan.test.mjs` style best:

- **Option A** — extend `tests/scan/scan.test.mjs` with a Workday case using the shared `installSequentialMockFetch` helper introduced in PR #8. Reuses the existing scan-test scaffolding (portals.yml + profile fixtures).
- **Option B** — new file `tests/scan/scan-workday.test.mjs` calling `fetchCompanyOffers` directly with a synthetic `company` object. Smaller scope, no need to mock the full pipeline writers.

The implementation plan will pick one based on what `scan.test.mjs` actually looks like; both satisfy the requirement.

**Test scenarios (both must be present):**

1. **Bare URL:** `https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers`
   Mock the Workday API to return the existing fixture (`workday-totalenergies-page1.json`). Assert:
   - `result.error === null`
   - `result.platform === 'workday'`
   - `result.offers.length > 0`
   - First offer has expected `url`, `title`, `company` fields.

   This case fails today with `error: 'no fetcher'` — would have caught Bug #1.

2. **Locale-prefixed URL:** `https://totalenergies.wd3.myworkdayjobs.com/en-US/TotalEnergies_careers`
   Same fixture, same assertions.

   This case fails today because `detectPlatform` returns a malformed slug — would have caught Bug #2.

The test must use the existing fixtures (no new fixture files) and the existing `installSequentialMockFetch` helper.

### Section 4 — Delivery

- **One commit** on `feat/scan-workday`:
  `fix(scan): wire Workday into DISPATCH and handle locale URLs`
  Body: short explanation citing the two bugs and that they were caught by code review on PR #8.
- **Pre-push validation** (must all pass):
  - `npm test`
  - `npm run lint`
  - `npm run check:pii`
  - `npm run format` (apply formatting if needed)
- **Force-push** to update PR #8. Safe because the branch is unmerged and only the author has it.
- **No CHANGELOG update** — PR #8's existing entry already covers Workday support; this is an internal pre-merge fix.
- **No follow-up comment on the PR.** The new diff and the resolved review comment speak for themselves.

## Risks and trade-offs

- **Force-push.** Standard for an unmerged feature branch with a single author. No external dependents.
- **Capturing the locale in the slug.** The slug for a locale-prefixed Workday URL becomes `https://tenant.wdN.myworkdayjobs.com/en-US/site` — visibly different from the bare-URL form for the same portal. Dedup uses `offer.url` (the per-job URL), not the slug, so this does not cause duplicate rows in `pipeline.md` / `scan-history.tsv`. The `--only <slug>` CLI flag would need a user to know the exact form to use, but that flag is a power-user convenience and not a correctness path. Acceptable for this fix; a follow-up could normalise.
- **Two regexes still in two places.** The fix mirrors the locale group rather than centralising, so a future Workday URL variant (e.g. `/{locale}/{tenant}/{site}`) could re-introduce drift. Documented as a known follow-up; not blocking.
- **Integration test brittleness.** Mocking `fetch` for the full scan loop is more setup than a unit test, but PR #8 already introduced `installSequentialMockFetch` for exactly this kind of multi-call mock, so the scaffolding cost is low.

## Success criteria

- `npm test` passes with the two new integration scenarios green.
- Manually tracing a Workday company through `fetchCompanyOffers` returns `error: null` and a non-empty `offers` array, for both bare and locale-prefixed URLs.
- The PR #8 review comment's two issues are resolved by the diff (no further reviewer action required).
