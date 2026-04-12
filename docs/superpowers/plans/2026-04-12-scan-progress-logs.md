# Scan Progress Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-company progress logging to `runScan()` via an `onProgress` callback so users can monitor scan progress in real time.

**Architecture:** `runScan()` accepts an optional `onProgress` callback in its `opts` parameter. The callback fires once per company in the results processing loop. The CLI (`main()`) wires it to `process.stderr` with a formatted message. Existing tests are unaffected since `onProgress` is optional.

**Tech Stack:** Node.js `node:test`, ESM

---

### Task 1: Write the failing test for onProgress callback

**Files:**
- Create: `tests/scan/progress.test.mjs`

- [ ] **Step 1: Write the test file**

```js
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { installMockFetch } from '../helpers.mjs';
import { runScan } from '../../src/scan/index.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-progress-'));

afterEach(() => {
  for (const f of fs.readdirSync(tmp)) {
    try { fs.unlinkSync(path.join(tmp, f)); } catch {}
  }
});

test('onProgress is called once per company with correct shape', async () => {
  const leverJson = [
    {
      hostedUrl: 'https://jobs.lever.co/acme/job1',
      text: 'ML Intern',
      categories: { location: 'Paris' },
      descriptionPlain: 'Stage Paris France septembre 2026.',
    },
    {
      hostedUrl: 'https://jobs.lever.co/acme/job2',
      text: 'Senior Engineer',
      categories: { location: 'Paris' },
      descriptionPlain: 'Senior role.',
    },
  ];
  const ashbyJson = {
    jobs: [
      {
        jobUrl: 'https://jobs.ashbyhq.com/beta/job3',
        title: 'Data Intern',
        location: 'Paris',
        descriptionPlain: 'Stage Paris France septembre 2026.',
      },
    ],
  };

  const restore = installMockFetch({
    'https://api.lever.co/v0/postings/acme?mode=json': leverJson,
    'https://api.ashbyhq.com/posting-api/job-board/beta?includeCompensation=false': ashbyJson,
  });

  const portalsConfig = {
    title_filter: { positive: ['Intern', 'Stage'], negative: ['Senior'] },
    tracked_companies: [
      { name: 'Acme Corp', careers_url: 'https://jobs.lever.co/acme', enabled: true },
      { name: 'Beta Inc', careers_url: 'https://jobs.ashbyhq.com/beta', enabled: true },
    ],
  };
  const profile = { min_start_date: '2026-08-24', blacklist_companies: [] };

  const calls = [];
  const onProgress = (info) => calls.push(info);

  const applicationsPath = path.join(tmp, 'applications.md');
  fs.writeFileSync(applicationsPath, '# Apps\n');

  await runScan({
    portalsConfig,
    profile,
    pipelinePath: path.join(tmp, 'pipeline.md'),
    historyPath: path.join(tmp, 'scan-history.tsv'),
    filteredPath: path.join(tmp, 'filtered-out.tsv'),
    applicationsPath,
    dryRun: false,
    onProgress,
  });

  restore();

  assert.equal(calls.length, 2, `expected 2 onProgress calls, got ${calls.length}`);

  // First company: Acme Corp (lever) — 2 raw, 1 new (Senior filtered out)
  assert.equal(calls[0].index, 1);
  assert.equal(calls[0].total, 2);
  assert.equal(calls[0].company, 'Acme Corp');
  assert.equal(calls[0].platform, 'lever');
  assert.equal(calls[0].count, 2);
  assert.equal(calls[0].newCount, 1);
  assert.equal(calls[0].error, null);

  // Second company: Beta Inc (ashby) — 1 raw, 1 new
  assert.equal(calls[1].index, 2);
  assert.equal(calls[1].total, 2);
  assert.equal(calls[1].company, 'Beta Inc');
  assert.equal(calls[1].platform, 'ashby');
  assert.equal(calls[1].count, 1);
  assert.equal(calls[1].newCount, 1);
  assert.equal(calls[1].error, null);
});

test('onProgress reports errors for failing companies', async () => {
  const restore = installMockFetch({});

  const portalsConfig = {
    title_filter: { positive: [], negative: [] },
    tracked_companies: [
      { name: 'Broken Co', careers_url: 'https://jobs.lever.co/broken', enabled: true },
    ],
  };
  const profile = { min_start_date: '2026-08-24', blacklist_companies: [] };

  const calls = [];
  const onProgress = (info) => calls.push(info);

  const applicationsPath = path.join(tmp, 'applications.md');
  fs.writeFileSync(applicationsPath, '# Apps\n');

  await runScan({
    portalsConfig,
    profile,
    pipelinePath: path.join(tmp, 'pipeline.md'),
    historyPath: path.join(tmp, 'scan-history.tsv'),
    filteredPath: path.join(tmp, 'filtered-out.tsv'),
    applicationsPath,
    dryRun: true,
    onProgress,
  });

  restore();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].index, 1);
  assert.equal(calls[0].total, 1);
  assert.equal(calls[0].company, 'Broken Co');
  assert.equal(calls[0].count, 0);
  assert.ok(calls[0].error, 'expected a non-null error');
});

test('no onProgress callback does not throw', async () => {
  const restore = installMockFetch({
    'https://api.lever.co/v0/postings/quiet?mode=json': [],
  });

  const portalsConfig = {
    title_filter: { positive: [], negative: [] },
    tracked_companies: [
      { name: 'Quiet Co', careers_url: 'https://jobs.lever.co/quiet', enabled: true },
    ],
  };
  const profile = { min_start_date: '2026-08-24', blacklist_companies: [] };

  const applicationsPath = path.join(tmp, 'applications.md');
  fs.writeFileSync(applicationsPath, '# Apps\n');

  // No onProgress — should not throw
  await runScan({
    portalsConfig,
    profile,
    pipelinePath: path.join(tmp, 'pipeline.md'),
    historyPath: path.join(tmp, 'scan-history.tsv'),
    filteredPath: path.join(tmp, 'filtered-out.tsv'),
    applicationsPath,
    dryRun: true,
  });

  restore();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/scan/progress.test.mjs`
Expected: FAIL — `onProgress` callback is never called, `calls.length` is 0.

---

### Task 2: Implement onProgress in runScan and wire it in main()

**Files:**
- Modify: `src/scan/index.mjs:66-77` (add `onProgress` to destructured opts)
- Modify: `src/scan/index.mjs:117-217` (call `onProgress` after processing each company's results)
- Modify: `src/scan/index.mjs:291-300` (pass `onProgress` in `main()`)

- [ ] **Step 1: Add `onProgress` to the destructured opts in `runScan`**

In `src/scan/index.mjs`, add `onProgress = null` to the destructured options (line 67-76):

```js
export async function runScan(opts) {
  const {
    portalsConfig,
    profile,
    pipelinePath,
    historyPath,
    filteredPath,
    applicationsPath,
    dryRun = false,
    onlySlug = null,
    onProgress = null,
  } = opts;
```

- [ ] **Step 2: Track per-company newCount and call onProgress in the results loop**

In the `for (const result of fetchResults)` loop, add a counter variable before the loop and call `onProgress` at the end of each iteration. The key change: track `newCount` for each company by counting offers that reach `added.push(offer)`.

Add `let progressIndex = 0;` before the `for` loop (after `const perCompany = [];` on line 115).

For the **error branch** (lines 118-142), insert the `onProgress` call just before `continue`:

```js
    if (result.error) {
      errors.push({ company: result.company, error: result.error });
      const errorUrl = `error://${result.company}`;
      if (!dryRun && !seen.has(errorUrl)) {
        seen.add(errorUrl);
        appendHistoryRow(historyPath, {
          url: errorUrl,
          first_seen: today,
          portal: result.platform || 'unknown',
          title: result.error.slice(0, 200),
          company: result.company,
          status: 'error_fetch',
        });
        historyWrites++;
      }
      perCompany.push({
        company: result.company,
        platform: result.platform,
        count: 0,
        error: result.error,
      });
      progressIndex++;
      if (onProgress) {
        onProgress({
          index: progressIndex,
          total: fetchResults.length,
          company: result.company,
          platform: result.platform,
          count: 0,
          newCount: 0,
          error: result.error,
        });
      }
      continue;
    }
```

For the **success branch**, add a `companyNew` counter before the offers loop, increment it alongside `added.push(offer)`, and call `onProgress` after the offers loop completes:

```js
    perCompany.push({
      company: result.company,
      platform: result.platform,
      count: result.offers.length,
    });
    raw += result.offers.length;

    let companyNew = 0;
    for (const offer of result.offers) {
      // ... existing offer processing code unchanged ...

      added.push(offer);
      companyNew++;
      // ... rest of added block unchanged ...
    }

    progressIndex++;
    if (onProgress) {
      onProgress({
        index: progressIndex,
        total: fetchResults.length,
        company: result.company,
        platform: result.platform,
        count: result.offers.length,
        newCount: companyNew,
        error: null,
      });
    }
```

- [ ] **Step 3: Wire onProgress to stderr in `main()`**

In the `main()` function, add the `onProgress` callback to the `runScan` call (around line 291):

```js
  const result = await runScan({
    portalsConfig,
    profile,
    pipelinePath: path.join(DATA_DIR, 'pipeline.md'),
    historyPath: path.join(DATA_DIR, 'scan-history.tsv'),
    filteredPath: path.join(DATA_DIR, 'filtered-out.tsv'),
    applicationsPath: path.join(DATA_DIR, 'applications.md'),
    dryRun,
    onlySlug,
    onProgress: ({ index, total, company, count, newCount, error }) => {
      if (error) {
        process.stderr.write(`[${index}/${total}] \u2717 ${company} \u2014 ${error}\n`);
      } else {
        process.stderr.write(
          `[${index}/${total}] \u2713 ${company} \u2014 ${count} raw, ${newCount} new\n`
        );
      }
    },
  });
```

- [ ] **Step 4: Run the new test to verify it passes**

Run: `node --test tests/scan/progress.test.mjs`
Expected: All 3 tests PASS.

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `npm test`
Expected: All tests pass (existing tests don't provide `onProgress`, so they're unaffected).

- [ ] **Step 6: Commit**

```bash
git add src/scan/index.mjs tests/scan/progress.test.mjs
git commit -m "feat(scan): add onProgress callback for per-company progress logging (#12)"
```
