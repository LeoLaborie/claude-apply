# Workday PR #8 Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two correctness bugs in PR #8 (missing Workday entry in scan `DISPATCH`; locale prefix not handled in `detectPlatform` regex) and add an integration test that exercises Workday end-to-end through `fetchCompanyOffers` so the regression class cannot recur.

**Architecture:** Two minimal source edits and two new tests, all inside the existing `feat/scan-workday` branch. Tests follow TDD (red → green) within each task; the whole change ships as **one commit** force-pushed onto PR #8.

**Tech Stack:** Node 20 ESM, `node:test`, existing `installMockFetch` helper from `tests/helpers.mjs`. Fixtures already in `tests/fixtures/`.

**Spec:** [`docs/superpowers/specs/2026-04-11-workday-pr8-fix-design.md`](../specs/2026-04-11-workday-pr8-fix-design.md)

---

## File map

| File | Action | Purpose |
| --- | --- | --- |
| `src/scan/ats-detect.mjs` | Modify (line 11) | Add optional locale group `(?:\/[a-z]{2}-[A-Z]{2})?` to Workday `PATTERNS` regex |
| `src/scan/index.mjs` | Modify (lines ~21, ~32-36) | Import `fetchWorkday` and add `workday: fetchWorkday` to `DISPATCH` |
| `tests/scan/ats-detect.test.mjs` | Modify (append test) | Unit test asserting `detectPlatform` accepts a locale-prefixed Workday URL and the captured slug round-trips through `parseWorkdayUrl` |
| `tests/scan/scan.test.mjs` | Modify (append test) | Integration test running `runScan` with a Workday company, exercising the full `fetchCompanyOffers` → `DISPATCH` → `fetchWorkday` path for both bare and locale URLs |

No new fixture files. Reuses `tests/fixtures/workday-totalenergies-page2.json` (the short / terminating page) so the test does not need to mock pagination.

---

## Task 1: Failing test for locale-prefix detection (RED)

**Why first:** demonstrates the regex bug at the unit level before touching code.

**Files:**
- Modify: `tests/scan/ats-detect.test.mjs` (append at end of file)

- [ ] **Step 1: Append the failing test**

Open `tests/scan/ats-detect.test.mjs` and append at the end of the file (after the existing `getSupportedHosts` test):

```js
test('detectPlatform — Workday URL avec préfixe locale (en-US, fr-FR) reste valide', () => {
  // Workday surfaces locale-prefixed URLs in the browser address bar.
  // The captured slug must contain the real site segment so that
  // parseWorkdayUrl downstream can resolve {tenant, pod, site} correctly.
  const enUS = detectPlatform(
    'https://totalenergies.wd3.myworkdayjobs.com/en-US/TotalEnergies_careers'
  );
  assert.equal(enUS.platform, 'workday');
  assert.ok(
    enUS.slug.includes('TotalEnergies_careers'),
    `expected slug to retain site segment, got: ${enUS.slug}`
  );

  const frFR = detectPlatform(
    'https://capgemini.wd5.myworkdayjobs.com/fr-FR/CapgeminiCareers'
  );
  assert.equal(frFR.platform, 'workday');
  assert.ok(
    frFR.slug.includes('CapgeminiCareers'),
    `expected slug to retain site segment, got: ${frFR.slug}`
  );
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `node --test --test-name-pattern="préfixe locale" tests/scan/ats-detect.test.mjs`

Expected: FAIL. The current regex captures `…/en-US` (or `…/fr-FR`) as the slug, missing the site segment, so `slug.includes('TotalEnergies_careers')` is false.

---

## Task 2: Fix the `detectPlatform` Workday regex (GREEN)

**Files:**
- Modify: `src/scan/ats-detect.mjs:11`

- [ ] **Step 1: Update the Workday pattern**

In `src/scan/ats-detect.mjs`, replace lines 9-12:

```js
  {
    platform: 'workday',
    re: /^(https?:\/\/[^.]+\.wd\d+\.myworkdayjobs\.com\/[^\/?#]+)/i,
  },
```

with:

```js
  {
    platform: 'workday',
    re: /^(https?:\/\/[^.]+\.wd\d+\.myworkdayjobs\.com(?:\/[a-z]{2}-[A-Z]{2})?\/[^\/?#]+)/i,
  },
```

The capture group still wraps the entire URL prefix (locale segment included when present). `parseWorkdayUrl` in `src/scan/ats/workday.mjs` already strips the locale, so the captured slug remains a valid input to both `verifySlug` and `fetchWorkday`.

- [ ] **Step 2: Run the locale test and confirm it passes**

Run: `node --test --test-name-pattern="préfixe locale" tests/scan/ats-detect.test.mjs`

Expected: PASS.

- [ ] **Step 3: Run the full `ats-detect` suite to confirm no regression**

Run: `node --test tests/scan/ats-detect.test.mjs`

Expected: ALL PASS, including the existing `recognises Workday URL and returns full URL as slug` test (the bare-URL form is unchanged).

---

## Task 3: Failing integration test for Workday in `runScan` (RED)

**Why:** the existing PR #8 tests cover `parseWorkdayUrl`, `fetchWorkday`, and `detectPlatform` in isolation, but never in composition through `runScan` / `fetchCompanyOffers`. Either bug from PR #8 review would have been caught immediately by such a test. This task adds it before fixing the wiring.

**Files:**
- Modify: `tests/scan/scan.test.mjs` (append at end of file)

- [ ] **Step 1: Append the failing integration test**

Open `tests/scan/scan.test.mjs` and append at the end of the file:

```js
test('runScan — Workday end-to-end (URL nue + URL avec locale)', async () => {
  // Reuse the existing terminating-page fixture so we don't need pagination mocks.
  const fxPath = path.join(
    REPO_ROOT,
    'tests',
    'fixtures',
    'workday-totalenergies-page2.json'
  );
  const workdayBody = JSON.parse(fs.readFileSync(fxPath, 'utf8'));

  const portalsConfig = {
    title_filter: { positive: [], negative: [] },
    tracked_companies: [
      {
        name: 'TotalEnergies (bare)',
        careers_url:
          'https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers',
        enabled: true,
      },
      {
        name: 'TotalEnergies (locale)',
        careers_url:
          'https://totalenergies.wd3.myworkdayjobs.com/en-US/TotalEnergies_careers',
        enabled: true,
      },
    ],
  };
  const profile = { min_start_date: '2020-01-01', blacklist_companies: [] };

  // Both companies hit the same Workday API endpoint (locale is stripped
  // by parseWorkdayUrl). The fixture is a short page so fetchWorkday's
  // pagination loop terminates after a single call per company.
  const workdayEndpoint =
    'https://totalenergies.wd3.myworkdayjobs.com/wday/cxs/totalenergies/TotalEnergies_careers/jobs';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (reqUrl) => {
    const key = typeof reqUrl === 'string' ? reqUrl : reqUrl.toString();
    if (key !== workdayEndpoint) {
      throw new Error(`unexpected fetch URL in test: ${key}`);
    }
    return {
      ok: true,
      status: 200,
      json: async () => workdayBody,
      text: async () => JSON.stringify(workdayBody),
    };
  };

  try {
    const pipelinePath = path.join(tmp, 'pipeline.md');
    const historyPath = path.join(tmp, 'scan-history.tsv');
    const filteredPath = path.join(tmp, 'filtered-out.tsv');
    const applicationsPath = path.join(tmp, 'applications.md');
    fs.writeFileSync(applicationsPath, '# Apps\n');

    const result = await runScan({
      portalsConfig,
      profile,
      pipelinePath,
      historyPath,
      filteredPath,
      applicationsPath,
      dryRun: false,
    });

    // Both companies must produce raw offers from the same fixture.
    // (Exact count depends on the fixture; the key assertion is "> 0".)
    assert.ok(
      result.raw > 0,
      `expected raw > 0 for Workday companies, got ${result.raw}`
    );

    // Neither company should error out. result.errors is the canonical
    // place runScan records per-company failures.
    const errs = (result.errors || []).filter((e) =>
      String(e.company || '').startsWith('TotalEnergies')
    );
    assert.equal(
      errs.length,
      0,
      `expected no Workday errors, got: ${JSON.stringify(errs)}`
    );

    // pipeline.md should mention TotalEnergies (proves offers were written).
    const md = fs.readFileSync(pipelinePath, 'utf8');
    assert.ok(
      md.includes('TotalEnergies'),
      'expected pipeline.md to contain at least one TotalEnergies offer'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
```

> **Note for the implementer:** the assertion `result.errors` assumes `runScan` exposes a per-company errors array. Before running the test, open `src/scan/index.mjs` and confirm the actual field name on the `runScan` return value (it may be called `errors`, `failed`, or stored on individual entries). If the name differs, adjust the test to match — the **intent** is "no per-company error for either Workday entry". Do **not** change `runScan` to fit the test.

- [ ] **Step 2: Run the integration test and confirm it fails**

Run: `node --test --test-name-pattern="Workday end-to-end" tests/scan/scan.test.mjs`

Expected: FAIL. With `DISPATCH` missing the `workday` entry, `fetchCompanyOffers` returns `{ error: 'no fetcher', offers: [] }` for both companies, so `result.raw === 0` (and/or `result.errors` is non-empty), tripping the first assertion.

---

## Task 4: Wire `fetchWorkday` into `DISPATCH` (GREEN)

**Files:**
- Modify: `src/scan/index.mjs` (lines ~21 and ~32-36)

- [ ] **Step 1: Add the import**

In `src/scan/index.mjs`, find the existing fetcher imports (currently lines 21-23):

```js
import { fetchLever } from './ats/lever.mjs';
import { fetchGreenhouse } from './ats/greenhouse.mjs';
import { fetchAshby } from './ats/ashby.mjs';
```

Append a fourth line:

```js
import { fetchWorkday } from './ats/workday.mjs';
```

The four imports should now be in the same block, in alphabetical-ish order matching the existing pattern (lever, greenhouse, ashby, workday).

- [ ] **Step 2: Add the `DISPATCH` entry**

Find the `DISPATCH` map (currently lines 32-36):

```js
const DISPATCH = {
  lever: fetchLever,
  greenhouse: fetchGreenhouse,
  ashby: fetchAshby,
};
```

Replace with:

```js
const DISPATCH = {
  lever: fetchLever,
  greenhouse: fetchGreenhouse,
  ashby: fetchAshby,
  workday: fetchWorkday,
};
```

- [ ] **Step 3: Run the integration test and confirm it passes**

Run: `node --test --test-name-pattern="Workday end-to-end" tests/scan/scan.test.mjs`

Expected: PASS. Both Workday companies now route through `fetchWorkday`, the locale URL is correctly detected (Task 2's fix), and `parseWorkdayUrl` strips the locale before constructing the API endpoint.

- [ ] **Step 4: Run the full scan suite to confirm no regression**

Run: `node --test tests/scan/scan.test.mjs tests/scan/ats-detect.test.mjs tests/scan/ats-workday.test.mjs`

Expected: ALL PASS.

---

## Task 5: Full validation, single commit, force-push

**Files:** none (delivery only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: all tests pass (including the two new ones from Tasks 1 and 3, plus the 249 pre-existing tests on the branch).

- [ ] **Step 2: Run lint**

Run: `npm run lint`

Expected: no Prettier diff. If it complains, run `npm run format` and re-run lint.

- [ ] **Step 3: Run the PII gate**

Run: `npm run check:pii`

Expected: clean. The test fixtures touch only `TotalEnergies`, `totalenergies`, and `Capgemini`, all of which are public corporate names already used elsewhere in the branch — no PII risk.

- [ ] **Step 4: Stage and commit**

Run:

```bash
git add src/scan/ats-detect.mjs src/scan/index.mjs tests/scan/ats-detect.test.mjs tests/scan/scan.test.mjs
git status
```

Confirm only those four files are staged. Then:

```bash
git commit -m "$(cat <<'EOF'
fix(scan): wire Workday into DISPATCH and handle locale URLs

PR #8 review caught two correctness bugs:

- src/scan/index.mjs never imported fetchWorkday or added it to
  the DISPATCH map, so Workday companies fell through to the
  'no fetcher' branch and silently produced zero offers.
- src/scan/ats-detect.mjs's Workday regex did not strip the
  locale segment (e.g. /en-US/), so locale-prefixed URLs were
  parsed as { site: 'en-US', ... } downstream and hit the wrong
  Workday API endpoint.

Adds an integration test in tests/scan/scan.test.mjs that runs
runScan end-to-end against a mocked Workday endpoint for both
bare and locale-prefixed URLs — either bug would have failed
this test immediately.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Force-push to PR #8**

Run: `git push --force-with-lease origin feat/scan-workday`

Expected: push succeeds, PR #8 picks up the new commit. `--force-with-lease` (not `--force`) protects against overwriting concurrent updates from another machine.

- [ ] **Step 6: Verify PR state**

Run: `gh pr view 8 --json state,statusCheckRollup,headRefOid`

Expected: PR is OPEN, head SHA matches the new commit, CI is queued or green. No further action — the original review comment will be visibly resolved by the diff.

---

## Self-review

- **Spec coverage:** Section 1 of the spec → Tasks 2 + 4. Section 2 → Task 2. Section 3 (integration test) → Tasks 3 + 4. Section 4 (delivery) → Task 5. All sections covered.
- **Placeholder scan:** none. The one judgment call (the field name on `runScan`'s return value) is explicitly flagged with instructions on how to verify and adjust without changing production code.
- **Type/identifier consistency:** all file paths verified against the actual codebase. The integration test uses `runScan` with the same destructured argument names already used by the existing `runScan — e2e` test. The fixture path matches what `tests/scan/ats-workday.test.mjs` already uses (`tests/fixtures/workday-totalenergies-page2.json`).
- **TDD discipline:** every task either writes a failing test before code, or runs an existing failing test from a prior task before fixing it.
