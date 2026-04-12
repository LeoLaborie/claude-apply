# Workday Pagination Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Workday scan timeout by adding server-side `searchText` filtering and a `MAX_OFFERS` pagination cap.

**Architecture:** Two complementary mechanisms in `workday.mjs`: (1) pass `searchText` from `title_filter.positive` to the Workday API to reduce volume at the source, (2) hard-cap pagination at 200 offers as a safety net. The scanner (`index.mjs`) builds the `searchText` string and passes it via the existing `opts` parameter.

**Tech Stack:** Node 20+, ESM, `node:test`, mock fetch fixtures.

**Spec:** `docs/superpowers/specs/2026-04-12-workday-pagination-fix-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/scan/ats/workday.mjs` | Add `MAX_OFFERS` constant, plumb `searchText` through `postJobs`, add pagination cap |
| Modify | `src/scan/index.mjs` | Build `searchText` from `title_filter.positive`, pass to Workday fetcher |
| Modify | `tests/scan/ats-workday.test.mjs` | Add tests for `searchText` passthrough and `MAX_OFFERS` cap |
| Modify | `tests/scan/scan.test.mjs` | Add test for `searchText` construction from `title_filter.positive` |

---

### Task 1: Add `MAX_OFFERS` cap to `fetchWorkday`

**Files:**
- Modify: `tests/scan/ats-workday.test.mjs`
- Modify: `src/scan/ats/workday.mjs:19,67-88`

- [ ] **Step 1: Write the failing test for MAX_OFFERS cap**

Add this test at the end of `tests/scan/ats-workday.test.mjs`:

```javascript
test('fetchWorkday — stops pagination when MAX_OFFERS reached', async () => {
  // Create a page of 5 postings (will be the pageSize)
  const fullPage = {
    total: 999,
    jobPostings: Array.from({ length: 5 }, (_, i) => ({
      title: `Job ${i}`,
      externalPath: `/job/Job-${i}_R${1000 + i}`,
      locationsText: 'Paris',
    })),
  };

  // Mock: return full pages indefinitely (simulate a huge board)
  const original = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount++;
    return { ok: true, status: 200, json: async () => fullPage, text: async () => '' };
  };
  restore = () => { globalThis.fetch = original; };

  const offers = await fetchWorkday(
    'https://big.wd3.myworkdayjobs.com/BigCorp',
    'BigCorp',
    { pageSize: 5, maxOffers: 12 }
  );

  // Should stop at 12 (or after the page that crosses 12), not loop forever
  assert.ok(offers.length <= 15, `Expected <= 15 offers, got ${offers.length}`);
  assert.ok(offers.length >= 12, `Expected >= 12 offers, got ${offers.length}`);
  assert.ok(callCount <= 3, `Expected <= 3 fetch calls, got ${callCount}`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="stops pagination when MAX_OFFERS" tests/scan/ats-workday.test.mjs`

Expected: hangs or times out (infinite loop, no `maxOffers` support).

- [ ] **Step 3: Implement MAX_OFFERS in fetchWorkday**

In `src/scan/ats/workday.mjs`, add the constant after line 19 (`const DEFAULT_PAGE_SIZE = 20;`):

```javascript
const DEFAULT_MAX_OFFERS = 200;
```

Then modify `fetchWorkday` (lines 67-89) to:

```javascript
export async function fetchWorkday(url, companyName, opts = {}) {
  const parts = parseWorkdayUrl(url);
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxOffers = opts.maxOffers ?? DEFAULT_MAX_OFFERS;
  const offers = [];
  let offset = 0;
  while (true) {
    const page = await postJobs(parts, { limit: pageSize, offset });
    const postings = Array.isArray(page?.jobPostings) ? page.jobPostings : [];
    for (const p of postings) {
      offers.push({
        url: buildJobUrl(parts, p.externalPath || ''),
        title: p.title || '',
        company: companyName,
        location: p.locationsText || '',
        body: '',
        platform: 'workday',
      });
    }
    if (postings.length < pageSize) break;
    if (offers.length >= maxOffers) break;
    offset += pageSize;
  }
  return offers;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="stops pagination when MAX_OFFERS" tests/scan/ats-workday.test.mjs`

Expected: PASS

- [ ] **Step 5: Run full Workday test suite to check for regressions**

Run: `node --test tests/scan/ats-workday.test.mjs`

Expected: all tests pass (existing tests don't set `maxOffers`, so they use the 200 default which won't interfere since fixtures have < 200 offers).

- [ ] **Step 6: Commit**

```bash
git add src/scan/ats/workday.mjs tests/scan/ats-workday.test.mjs
git commit -m "fix(scan): add MAX_OFFERS cap to Workday pagination (#11)"
```

---

### Task 2: Plumb `searchText` through `postJobs` and `fetchWorkday`

**Files:**
- Modify: `tests/scan/ats-workday.test.mjs`
- Modify: `src/scan/ats/workday.mjs:25-39,67-89`

- [ ] **Step 1: Write the failing test for searchText passthrough**

Add a test that verifies the POST body contains the `searchText`. This requires a mock that inspects the request body. Add at the end of `tests/scan/ats-workday.test.mjs`:

```javascript
test('fetchWorkday — passes searchText in POST body', async () => {
  const original = globalThis.fetch;
  let capturedBody = null;
  globalThis.fetch = async (url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ total: 0, jobPostings: [] }),
      text: async () => '{}',
    };
  };
  restore = () => { globalThis.fetch = original; };

  await fetchWorkday(
    'https://sanofi.wd3.myworkdayjobs.com/SanofiCareers',
    'Sanofi',
    { searchText: 'Intern Stage Stagiaire' }
  );

  assert.equal(capturedBody.searchText, 'Intern Stage Stagiaire');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="passes searchText in POST body" tests/scan/ats-workday.test.mjs`

Expected: FAIL — `capturedBody.searchText` is `''` (the hard-coded empty string).

- [ ] **Step 3: Plumb searchText through postJobs and fetchWorkday**

In `src/scan/ats/workday.mjs`, modify `postJobs` (lines 25-40) to accept `searchText`:

```javascript
async function postJobs({ tenant, pod, site }, { limit, offset, searchText = '' }) {
  const url = `https://${tenant}.${pod}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'claude-apply-scan/1.0',
    },
    body: JSON.stringify({ appliedFacets: {}, limit, offset, searchText }),
  });
  if (!res.ok) {
    throw new Error(`Workday API ${tenant}/${site}: HTTP ${res.status}`);
  }
  return res.json();
}
```

Then in `fetchWorkday`, pass `searchText` to `postJobs`:

```javascript
export async function fetchWorkday(url, companyName, opts = {}) {
  const parts = parseWorkdayUrl(url);
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxOffers = opts.maxOffers ?? DEFAULT_MAX_OFFERS;
  const searchText = opts.searchText ?? '';
  const offers = [];
  let offset = 0;
  while (true) {
    const page = await postJobs(parts, { limit: pageSize, offset, searchText });
    const postings = Array.isArray(page?.jobPostings) ? page.jobPostings : [];
    for (const p of postings) {
      offers.push({
        url: buildJobUrl(parts, p.externalPath || ''),
        title: p.title || '',
        company: companyName,
        location: p.locationsText || '',
        body: '',
        platform: 'workday',
      });
    }
    if (postings.length < pageSize) break;
    if (offers.length >= maxOffers) break;
    offset += pageSize;
  }
  return offers;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="passes searchText in POST body" tests/scan/ats-workday.test.mjs`

Expected: PASS

- [ ] **Step 5: Run full Workday test suite**

Run: `node --test tests/scan/ats-workday.test.mjs`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/scan/ats/workday.mjs tests/scan/ats-workday.test.mjs
git commit -m "feat(scan): plumb searchText through Workday API calls (#11)"
```

---

### Task 3: Build `searchText` from `title_filter.positive` in the scanner

**Files:**
- Modify: `tests/scan/scan.test.mjs`
- Modify: `src/scan/index.mjs:49-63`

- [ ] **Step 1: Read the existing scan test file to understand test patterns**

Read `tests/scan/scan.test.mjs` to understand how `runScan` is tested, what fixtures exist, and how to add a Workday-specific test.

- [ ] **Step 2: Write the failing test for searchText construction**

The test needs to verify that when scanning a Workday company, the `searchText` built from `title_filter.positive` is passed to `fetchWorkday`. Since `fetchCompanyOffers` calls `fetchWorkday` internally, we need to mock at the `fetch` level and inspect the POST body.

Add to `tests/scan/scan.test.mjs`:

```javascript
test('runScan — passes searchText built from title_filter.positive to Workday fetcher', async () => {
  let capturedBody = null;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('myworkdayjobs.com')) {
      capturedBody = JSON.parse(opts.body);
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ total: 0, jobPostings: [] }),
      text: async () => '{}',
    };
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-searchtext-'));
  fs.writeFileSync(path.join(tmpDir, 'pipeline.md'), '# Pipeline\n');
  fs.writeFileSync(path.join(tmpDir, 'scan-history.tsv'), '');
  fs.writeFileSync(path.join(tmpDir, 'filtered-out.tsv'), '');
  fs.writeFileSync(path.join(tmpDir, 'applications.md'), '');

  try {
    await runScan({
      portalsConfig: {
        tracked_companies: [
          {
            name: 'TestCorp',
            careers_url: 'https://testcorp.wd3.myworkdayjobs.com/TestCareers',
            enabled: true,
          },
        ],
        title_filter: {
          positive: ['Intern', 'Stage', '/^stagiaire\\b/i'],
          negative: [],
        },
      },
      profile: { blacklist_companies: [] },
      pipelinePath: path.join(tmpDir, 'pipeline.md'),
      historyPath: path.join(tmpDir, 'scan-history.tsv'),
      filteredPath: path.join(tmpDir, 'filtered-out.tsv'),
      applicationsPath: path.join(tmpDir, 'applications.md'),
      dryRun: true,
    });

    assert.ok(capturedBody, 'Expected a POST to Workday API');
    // Should include simple words, exclude regex entries
    assert.equal(capturedBody.searchText, 'Intern Stage');
  } finally {
    globalThis.fetch = original;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
```

Note: the test file may need `import os from 'node:os';` and `import { runScan } from '../../src/scan/index.mjs';` — check existing imports and add only what's missing.

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test --test-name-pattern="passes searchText built from" tests/scan/scan.test.mjs`

Expected: FAIL — `capturedBody.searchText` is `''` because the scanner doesn't build/pass `searchText` yet.

- [ ] **Step 4: Implement searchText construction in fetchCompanyOffers**

In `src/scan/index.mjs`, modify `fetchCompanyOffers` to accept a `whitelist` parameter and build `searchText` for Workday:

First, add a helper function before `fetchCompanyOffers` (around line 48):

```javascript
function buildSearchText(positiveTerms) {
  if (!Array.isArray(positiveTerms) || positiveTerms.length === 0) return '';
  return positiveTerms
    .filter((t) => typeof t === 'string' && !t.startsWith('/'))
    .join(' ');
}
```

Then modify `fetchCompanyOffers` to accept and use `whitelist`:

```javascript
async function fetchCompanyOffers(company, whitelist) {
  const det = detectPlatform(company.careers_url);
  if (!det) {
    return { company: company.name, platform: null, offers: [], error: 'platform not detected' };
  }
  const fn = DISPATCH[det.platform];
  if (!fn) {
    return { company: company.name, platform: det.platform, offers: [], error: 'no fetcher' };
  }
  try {
    const opts = det.platform === 'workday'
      ? { searchText: buildSearchText(whitelist.positive) }
      : undefined;
    const offers = opts ? await fn(det.slug, company.name, opts) : await fn(det.slug, company.name);
    return { company: company.name, platform: det.platform, offers, error: null };
  } catch (err) {
    return { company: company.name, platform: det.platform, offers: [], error: err.message };
  }
}
```

Then update the `Promise.all` call in `runScan` (line 96) to pass `whitelist`:

```javascript
const fetchResults = await Promise.all(companies.map((c) => fetchCompanyOffers(c, whitelist)));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test --test-name-pattern="passes searchText built from" tests/scan/scan.test.mjs`

Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/scan/index.mjs tests/scan/scan.test.mjs
git commit -m "feat(scan): build searchText from title_filter.positive for Workday (#11)"
```

---

### Task 4: Edge case — empty or missing `title_filter.positive`

**Files:**
- Modify: `tests/scan/scan.test.mjs`

- [ ] **Step 1: Write test for empty positive list**

Add to `tests/scan/scan.test.mjs`:

```javascript
test('runScan — sends empty searchText when title_filter.positive is empty', async () => {
  let capturedBody = null;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('myworkdayjobs.com')) {
      capturedBody = JSON.parse(opts.body);
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ total: 0, jobPostings: [] }),
      text: async () => '{}',
    };
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-empty-'));
  fs.writeFileSync(path.join(tmpDir, 'pipeline.md'), '# Pipeline\n');
  fs.writeFileSync(path.join(tmpDir, 'scan-history.tsv'), '');
  fs.writeFileSync(path.join(tmpDir, 'filtered-out.tsv'), '');
  fs.writeFileSync(path.join(tmpDir, 'applications.md'), '');

  try {
    await runScan({
      portalsConfig: {
        tracked_companies: [
          {
            name: 'TestCorp',
            careers_url: 'https://testcorp.wd3.myworkdayjobs.com/TestCareers',
            enabled: true,
          },
        ],
        title_filter: { positive: [], negative: [] },
      },
      profile: { blacklist_companies: [] },
      pipelinePath: path.join(tmpDir, 'pipeline.md'),
      historyPath: path.join(tmpDir, 'scan-history.tsv'),
      filteredPath: path.join(tmpDir, 'filtered-out.tsv'),
      applicationsPath: path.join(tmpDir, 'applications.md'),
      dryRun: true,
    });

    assert.ok(capturedBody, 'Expected a POST to Workday API');
    assert.equal(capturedBody.searchText, '');
  } finally {
    globalThis.fetch = original;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it passes (should already pass)**

Run: `node --test --test-name-pattern="sends empty searchText" tests/scan/scan.test.mjs`

Expected: PASS (the `buildSearchText` function handles empty arrays).

- [ ] **Step 3: Write test for all-regex positive list**

Add to `tests/scan/scan.test.mjs`:

```javascript
test('runScan — sends empty searchText when all positive entries are regex', async () => {
  let capturedBody = null;
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (typeof url === 'string' && url.includes('myworkdayjobs.com')) {
      capturedBody = JSON.parse(opts.body);
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ total: 0, jobPostings: [] }),
      text: async () => '{}',
    };
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-regex-'));
  fs.writeFileSync(path.join(tmpDir, 'pipeline.md'), '# Pipeline\n');
  fs.writeFileSync(path.join(tmpDir, 'scan-history.tsv'), '');
  fs.writeFileSync(path.join(tmpDir, 'filtered-out.tsv'), '');
  fs.writeFileSync(path.join(tmpDir, 'applications.md'), '');

  try {
    await runScan({
      portalsConfig: {
        tracked_companies: [
          {
            name: 'TestCorp',
            careers_url: 'https://testcorp.wd3.myworkdayjobs.com/TestCareers',
            enabled: true,
          },
        ],
        title_filter: { positive: ['/^stage\\b/i', '/intern/i'], negative: [] },
      },
      profile: { blacklist_companies: [] },
      pipelinePath: path.join(tmpDir, 'pipeline.md'),
      historyPath: path.join(tmpDir, 'scan-history.tsv'),
      filteredPath: path.join(tmpDir, 'filtered-out.tsv'),
      applicationsPath: path.join(tmpDir, 'applications.md'),
      dryRun: true,
    });

    assert.ok(capturedBody, 'Expected a POST to Workday API');
    assert.equal(capturedBody.searchText, '');
  } finally {
    globalThis.fetch = original;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 4: Run tests**

Run: `node --test --test-name-pattern="sends empty searchText" tests/scan/scan.test.mjs`

Expected: both PASS.

- [ ] **Step 5: Run full test suite**

Run: `npm test`

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add tests/scan/scan.test.mjs
git commit -m "test(scan): add edge case tests for searchText construction (#11)"
```
