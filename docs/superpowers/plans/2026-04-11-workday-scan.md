# Workday scan implementation plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Workday support to `/scan`, so career pages at `{tenant}.wd{N}.myworkdayjobs.com/{site}` can be scanned and their offers appended to `data/pipeline.md`.

**Architecture:** One new fetcher file `src/scan/ats/workday.mjs` holding `parseWorkdayUrl`, `fetchWorkday`, and `verifySlug` (same file structure as `lever.mjs` / `greenhouse.mjs` / `ashby.mjs`). The Workday API is `POST {origin}/wday/cxs/{tenant}/{site}/jobs` with JSON pagination. `src/scan/ats-detect.mjs` gets a new `PATTERNS` entry, `workday` added to `VERIFIABLE_PLATFORMS`, and `*.myworkdayjobs.com` added to `SUPPORTED_HOSTS`.

**Tech Stack:** Node 20+ ESM, `node:test`, `node:fs`, Web `fetch`. Tests use `tests/helpers.mjs::installMockFetch` with a local stateful wrapper for the pagination case.

**Out of scope (deferred to plans 2 + 3):** `/apply` Workday support, account creation, credential storage, playbook markdown, `CLAUDE.md` invariant change.

**Pre-check before starting**: the branch `feat/scan-workday` must be rebased on `main` at a commit that already contains PR #7 (`verifyCompany` in `src/scan/ats-detect.mjs`, `verifySlug` in each fetcher file). Run `git log --oneline -5` and confirm you see `feat(onboard): verifySlug primitive and extension host permissions (PR 5/5) (#7)` (commit `cd8f931` or later).

---

## File structure

**Create:**
- `src/scan/ats/workday.mjs` — fetcher, URL parser, verifier
- `tests/scan/ats-workday.test.mjs` — unit tests for the fetcher + parser + verifier
- `tests/fixtures/workday-totalenergies-page1.json` — single-page canned fixture
- `tests/fixtures/workday-totalenergies-page2.json` — partial second page fixture (for pagination)

**Modify:**
- `src/scan/ats-detect.mjs` — add `workday` pattern, `VERIFIABLE_PLATFORMS`, `SUPPORTED_HOSTS`
- `tests/scan/ats-detect.test.mjs` — extend with Workday pattern tests
- `tests/scan/verify-company.test.mjs` — extend with Workday dispatch case (if the file imports `verifyCompany`; otherwise keep in `ats-detect.test.mjs`)
- `CHANGELOG.md` — under `## Unreleased`, add `feat(scan): add Workday fetcher and verifySlug`
- `templates/portals.example.yml` — add a Workday example entry (if the file exists; otherwise skip)

**Do not modify in this plan:**
- Any file under `src/apply/`
- `CLAUDE.md`
- `.claude/commands/*`
- `docs/ats-support.md`, `docs/apply-workflow.md`, `docs/extending.md` (these get batched in Plan 3)

---

## Task 1: Add canned Workday API fixtures

**Files:**
- Create: `tests/fixtures/workday-totalenergies-page1.json`
- Create: `tests/fixtures/workday-totalenergies-page2.json`

The Workday jobs API returns a JSON object with shape `{ total, jobPostings: [...] }` where each posting has `title`, `externalPath`, `locationsText`, `postedOn`, `bulletFields`, `jobRequisitionId`. We use hand-crafted fixtures so tests are deterministic and do not require network access. Real-tenant smoke verification happens at the end of the plan (Task 9).

- [ ] **Step 1: Create page 1 fixture**

```bash
mkdir -p tests/fixtures
```

Write `tests/fixtures/workday-totalenergies-page1.json`:

```json
{
  "total": 23,
  "jobPostings": [
    {
      "title": "Data Engineer - Paris",
      "externalPath": "/job/Paris/Data-Engineer---Paris_R12345",
      "locationsText": "Paris, France",
      "postedOn": "Posted 2 Days Ago",
      "bulletFields": ["R12345", "2 Days Ago"],
      "jobRequisitionId": "R12345"
    },
    {
      "title": "Senior Software Engineer - Platform",
      "externalPath": "/job/Courbevoie/Senior-Software-Engineer---Platform_R12346",
      "locationsText": "Courbevoie, France",
      "postedOn": "Posted 5 Days Ago",
      "bulletFields": ["R12346", "5 Days Ago"],
      "jobRequisitionId": "R12346"
    },
    {
      "title": "Staff Data Scientist",
      "externalPath": "/job/Remote/Staff-Data-Scientist_R12347",
      "locationsText": "Remote - France",
      "postedOn": "Posted Yesterday",
      "bulletFields": ["R12347", "Yesterday"],
      "jobRequisitionId": "R12347"
    }
  ]
}
```

- [ ] **Step 2: Create page 2 fixture (partial, to signal pagination end)**

Write `tests/fixtures/workday-totalenergies-page2.json`:

```json
{
  "total": 23,
  "jobPostings": [
    {
      "title": "Cloud Infrastructure Engineer",
      "externalPath": "/job/Paris/Cloud-Infrastructure-Engineer_R12348",
      "locationsText": "Paris, France",
      "postedOn": "Posted 10 Days Ago",
      "bulletFields": ["R12348", "10 Days Ago"],
      "jobRequisitionId": "R12348"
    }
  ]
}
```

The page 1 fixture has 3 postings (== page size in tests). The page 2 fixture has 1 posting (< page size), which is how the fetcher detects the last page.

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/workday-totalenergies-page1.json tests/fixtures/workday-totalenergies-page2.json
git commit -m "test(scan): add Workday fixtures for TotalEnergies tenant"
```

---

## Task 2: Implement and test `parseWorkdayUrl`

**Files:**
- Create: `src/scan/ats/workday.mjs`
- Create: `tests/scan/ats-workday.test.mjs`

`parseWorkdayUrl` is a pure function `(string) → { tenant, pod, site }` that extracts the three URL components. It throws on URLs that do not match the Workday shape.

- [ ] **Step 1: Write the failing test**

Write `tests/scan/ats-workday.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkdayUrl } from '../../src/scan/ats/workday.mjs';

test('parseWorkdayUrl — extracts tenant, pod, site from valid URL', () => {
  const { tenant, pod, site } = parseWorkdayUrl(
    'https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers',
  );
  assert.equal(tenant, 'totalenergies');
  assert.equal(pod, 'wd3');
  assert.equal(site, 'TotalEnergies_careers');
});

test('parseWorkdayUrl — handles trailing slash', () => {
  const { tenant, pod, site } = parseWorkdayUrl(
    'https://sanofi.wd3.myworkdayjobs.com/SanofiCareers/',
  );
  assert.equal(tenant, 'sanofi');
  assert.equal(pod, 'wd3');
  assert.equal(site, 'SanofiCareers');
});

test('parseWorkdayUrl — handles pod wd5', () => {
  const { pod } = parseWorkdayUrl(
    'https://capgemini.wd5.myworkdayjobs.com/CapgeminiCareers',
  );
  assert.equal(pod, 'wd5');
});

test('parseWorkdayUrl — ignores query string and fragment', () => {
  const { tenant, pod, site } = parseWorkdayUrl(
    'https://schneider.wd3.myworkdayjobs.com/Global?foo=bar#section',
  );
  assert.equal(tenant, 'schneider');
  assert.equal(pod, 'wd3');
  assert.equal(site, 'Global');
});

test('parseWorkdayUrl — throws on non-Workday URL', () => {
  assert.throws(
    () => parseWorkdayUrl('https://jobs.lever.co/stripe'),
    /not a Workday URL/,
  );
});

test('parseWorkdayUrl — throws on Workday URL missing site', () => {
  assert.throws(
    () => parseWorkdayUrl('https://totalenergies.wd3.myworkdayjobs.com/'),
    /not a Workday URL/,
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scan/ats-workday.test.mjs`
Expected: FAIL with `Cannot find module '../../src/scan/ats/workday.mjs'` or similar.

- [ ] **Step 3: Write minimal implementation**

Write `src/scan/ats/workday.mjs`:

```javascript
// Fetcher for Workday-hosted job boards.
// Endpoint: POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs
// Returns Offer[] conforming to the Offer contract.

const WORKDAY_URL_RE =
  /^https?:\/\/([^.]+)\.(wd\d+)\.myworkdayjobs\.com\/([^\/?#]+)(?:\/|\?|#|$)/i;

export function parseWorkdayUrl(url) {
  if (typeof url !== 'string') {
    throw new Error('parseWorkdayUrl: not a Workday URL (input is not a string)');
  }
  const m = url.match(WORKDAY_URL_RE);
  if (!m) {
    throw new Error(`parseWorkdayUrl: not a Workday URL: ${url}`);
  }
  return { tenant: m[1].toLowerCase(), pod: m[2].toLowerCase(), site: m[3] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scan/ats-workday.test.mjs`
Expected: PASS, 6 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/scan/ats/workday.mjs tests/scan/ats-workday.test.mjs
git commit -m "feat(scan): add parseWorkdayUrl for Workday URL parsing"
```

---

## Task 3: Implement and test `fetchWorkday` — single page

**Files:**
- Modify: `src/scan/ats/workday.mjs`
- Modify: `tests/scan/ats-workday.test.mjs`

The fetcher POSTs `{ appliedFacets: {}, limit, offset, searchText: '' }` and maps `jobPostings[]` to the `Offer` contract. The existing `installMockFetch` helper keys by URL only, not by method or body — good enough for single-page because there is only one URL, one call.

- [ ] **Step 1: Write the failing test**

Append to `tests/scan/ats-workday.test.mjs`:

```javascript
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'node:test';
import { installMockFetch } from '../helpers.mjs';
import { fetchWorkday } from '../../src/scan/ats/workday.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fx1Path = path.join(__dirname, '..', 'fixtures', 'workday-totalenergies-page1.json');
const fx2Path = path.join(__dirname, '..', 'fixtures', 'workday-totalenergies-page2.json');

let restore;
afterEach(() => {
  if (restore) restore();
});

test('fetchWorkday — single page, maps postings to Offer contract', async () => {
  const fixture = JSON.parse(fs.readFileSync(fx1Path, 'utf8'));
  restore = installMockFetch({
    'https://totalenergies.wd3.myworkdayjobs.com/wday/cxs/totalenergies/TotalEnergies_careers/jobs':
      fixture,
  });

  const offers = await fetchWorkday(
    'https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers',
    'TotalEnergies',
    { pageSize: 50 }, // > total, so only one call
  );

  assert.equal(offers.length, 3);
  const o = offers[0];
  assert.equal(o.title, 'Data Engineer - Paris');
  assert.equal(
    o.url,
    'https://totalenergies.wd3.myworkdayjobs.com/en-US/TotalEnergies_careers/job/Paris/Data-Engineer---Paris_R12345',
  );
  assert.equal(o.company, 'TotalEnergies');
  assert.equal(o.location, 'Paris, France');
  assert.equal(o.platform, 'workday');
  assert.equal(typeof o.body, 'string');
});
```

Note the `url` includes `/en-US/{site}`: Workday's `externalPath` is `/job/...` and the public browsing URL prefixes the locale + site. The simplest stable convention that matches what users see in the browser is `{origin}/en-US/{site}{externalPath}`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/scan/ats-workday.test.mjs`
Expected: FAIL — `fetchWorkday` is not exported yet.

- [ ] **Step 3: Write minimal implementation**

Append to `src/scan/ats/workday.mjs`:

```javascript
const DEFAULT_PAGE_SIZE = 20;

function buildJobUrl({ tenant, pod, site }, externalPath) {
  return `https://${tenant}.${pod}.myworkdayjobs.com/en-US/${site}${externalPath}`;
}

async function postJobs({ tenant, pod, site }, { limit, offset }) {
  const url = `https://${tenant}.${pod}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'claude-apply-scan/1.0',
    },
    body: JSON.stringify({ appliedFacets: {}, limit, offset, searchText: '' }),
  });
  if (!res.ok) {
    throw new Error(`Workday API ${tenant}/${site}: HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchWorkday(url, companyName, opts = {}) {
  const parts = parseWorkdayUrl(url);
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
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
    offset += pageSize;
  }
  return offers;
}
```

`body` is empty: the listing API does not return job descriptions, they live on the detail page. The scan pipeline stores `body` for prefiltering, and an empty string is acceptable (prefilter rules apply to titles anyway). A future enhancement can fetch detail pages lazily.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/scan/ats-workday.test.mjs`
Expected: PASS, 7 tests green (6 parser + 1 fetcher).

- [ ] **Step 5: Commit**

```bash
git add src/scan/ats/workday.mjs tests/scan/ats-workday.test.mjs
git commit -m "feat(scan): add fetchWorkday single-page mapping"
```

---

## Task 4: Extend `fetchWorkday` tests for pagination

**Files:**
- Modify: `tests/scan/ats-workday.test.mjs`

The default `installMockFetch` keys by URL and cannot return different responses on successive calls to the same URL (both pages use the same POST URL). We build a small stateful wrapper locally in this test. If pagination already works in Task 3's implementation (it does), the test just verifies it.

- [ ] **Step 1: Write the failing test**

Append to `tests/scan/ats-workday.test.mjs`:

```javascript
function installSequentialMockFetch(url, responses) {
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = async (reqUrl) => {
    const key = typeof reqUrl === 'string' ? reqUrl : reqUrl.toString();
    if (key !== url) throw new Error(`sequentialMock: unexpected URL ${key}`);
    if (i >= responses.length) throw new Error(`sequentialMock: exhausted (called ${i + 1} times)`);
    const body = responses[i++];
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  return () => {
    globalThis.fetch = original;
  };
}

test('fetchWorkday — paginates until a partial page is returned', async () => {
  const page1 = JSON.parse(fs.readFileSync(fx1Path, 'utf8'));
  const page2 = JSON.parse(fs.readFileSync(fx2Path, 'utf8'));
  restore = installSequentialMockFetch(
    'https://totalenergies.wd3.myworkdayjobs.com/wday/cxs/totalenergies/TotalEnergies_careers/jobs',
    [page1, page2],
  );

  const offers = await fetchWorkday(
    'https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers',
    'TotalEnergies',
    { pageSize: 3 }, // page1 has 3 (full), page2 has 1 (partial → stop)
  );

  assert.equal(offers.length, 4);
  assert.equal(offers[0].title, 'Data Engineer - Paris');
  assert.equal(offers[3].title, 'Cloud Infrastructure Engineer');
});

test('fetchWorkday — stops on first empty page', async () => {
  restore = installSequentialMockFetch(
    'https://sanofi.wd3.myworkdayjobs.com/wday/cxs/sanofi/SanofiCareers/jobs',
    [{ total: 0, jobPostings: [] }],
  );

  const offers = await fetchWorkday(
    'https://sanofi.wd3.myworkdayjobs.com/SanofiCareers',
    'Sanofi',
    { pageSize: 20 },
  );

  assert.equal(offers.length, 0);
});

test('fetchWorkday — throws on HTTP error', async () => {
  restore = installMockFetch({
    'https://broken.wd3.myworkdayjobs.com/wday/cxs/broken/BrokenSite/jobs': {
      status: 500,
      body: { error: 'nope' },
    },
  });

  await assert.rejects(
    () =>
      fetchWorkday(
        'https://broken.wd3.myworkdayjobs.com/BrokenSite',
        'Broken',
        { pageSize: 20 },
      ),
    /HTTP 500/,
  );
});
```

- [ ] **Step 2: Run tests to verify they pass (implementation already covers them)**

Run: `node --test tests/scan/ats-workday.test.mjs`
Expected: PASS, 10 tests green.

If any fail, fix the implementation and re-run. The likely failure mode is the pagination loop not breaking correctly on `postings.length < pageSize`; review Task 3's `fetchWorkday`.

- [ ] **Step 3: Commit**

```bash
git add tests/scan/ats-workday.test.mjs
git commit -m "test(scan): cover Workday pagination, empty pages, and HTTP errors"
```

---

## Task 5: Implement and test `verifySlug`

**Files:**
- Modify: `src/scan/ats/workday.mjs`
- Modify: `tests/scan/ats-workday.test.mjs`

`verifySlug(url)` takes the full Workday URL (not a slug — the dispatcher passes the full URL through because of how we wire Workday into `ats-detect.mjs` in Task 6). It returns `{ ok: true, count }` on success, `{ ok: false, status, reason }` on HTTP failure or non-Workday URL.

- [ ] **Step 1: Write the failing test**

Append to `tests/scan/ats-workday.test.mjs`:

```javascript
import { verifySlug } from '../../src/scan/ats/workday.mjs';

test('verifySlug — returns ok with count on valid response', async () => {
  const page1 = JSON.parse(fs.readFileSync(fx1Path, 'utf8'));
  restore = installMockFetch({
    'https://totalenergies.wd3.myworkdayjobs.com/wday/cxs/totalenergies/TotalEnergies_careers/jobs':
      page1,
  });

  const r = await verifySlug(
    'https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers',
  );
  assert.equal(r.ok, true);
  assert.equal(r.count, 3);
});

test('verifySlug — returns ok with count 0 on empty response', async () => {
  restore = installMockFetch({
    'https://sanofi.wd3.myworkdayjobs.com/wday/cxs/sanofi/SanofiCareers/jobs': {
      total: 0,
      jobPostings: [],
    },
  });

  const r = await verifySlug('https://sanofi.wd3.myworkdayjobs.com/SanofiCareers');
  assert.equal(r.ok, true);
  assert.equal(r.count, 0);
});

test('verifySlug — returns ko on HTTP 404', async () => {
  restore = installMockFetch({
    'https://missing.wd3.myworkdayjobs.com/wday/cxs/missing/Nope/jobs': {
      status: 404,
      body: {},
    },
  });

  const r = await verifySlug('https://missing.wd3.myworkdayjobs.com/Nope');
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.match(r.reason, /HTTP 404/);
});

test('verifySlug — returns ko on non-Workday URL', async () => {
  const r = await verifySlug('https://jobs.lever.co/stripe');
  assert.equal(r.ok, false);
  assert.match(r.reason, /not a Workday URL/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/scan/ats-workday.test.mjs`
Expected: FAIL — `verifySlug` not exported yet.

- [ ] **Step 3: Write minimal implementation**

Append to `src/scan/ats/workday.mjs`:

```javascript
export async function verifySlug(url) {
  let parts;
  try {
    parts = parseWorkdayUrl(url);
  } catch (err) {
    return { ok: false, reason: err.message };
  }
  const endpoint = `https://${parts.tenant}.${parts.pod}.myworkdayjobs.com/wday/cxs/${parts.tenant}/${parts.site}/jobs`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'claude-apply-verify/1.0',
    },
    body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: '' }),
  });
  if (!res.ok) {
    return { ok: false, status: res.status, reason: `HTTP ${res.status}` };
  }
  const data = await res.json();
  const count = Array.isArray(data?.jobPostings) ? data.jobPostings.length : 0;
  return { ok: true, count };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/scan/ats-workday.test.mjs`
Expected: PASS, 14 tests green (10 prior + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/scan/ats/workday.mjs tests/scan/ats-workday.test.mjs
git commit -m "feat(scan): add verifySlug primitive for Workday"
```

---

## Task 6: Wire Workday into `ats-detect.mjs`

**Files:**
- Modify: `src/scan/ats-detect.mjs`
- Modify: `tests/scan/ats-detect.test.mjs`

Three edits: add `workday` to `PATTERNS`, add `'workday'` to `VERIFIABLE_PLATFORMS`, and add the Workday wildcard host to `SUPPORTED_HOSTS`. The Workday `PATTERNS` entry captures the full URL as the `slug` field (unlike Lever/Greenhouse/Ashby, which capture a short company slug), because Workday's `verifySlug` needs the whole URL to re-extract tenant + pod + site.

- [ ] **Step 1: Read the current `ats-detect.test.mjs` to see existing test style**

Run:

```bash
cat tests/scan/ats-detect.test.mjs
```

Note: the file uses `node:test` and asserts on the shape `{platform, slug}` returned by `detectPlatform`.

- [ ] **Step 2: Write the failing tests**

Append to `tests/scan/ats-detect.test.mjs`:

```javascript
test('detectPlatform — recognises Workday URL and returns full URL as slug', () => {
  const r = detectPlatform('https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers');
  assert.equal(r.platform, 'workday');
  assert.equal(r.slug, 'https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers');
});

test('detectPlatform — recognises Workday URL on pod wd5', () => {
  const r = detectPlatform('https://capgemini.wd5.myworkdayjobs.com/CapgeminiCareers');
  assert.equal(r.platform, 'workday');
});

test('getSupportedHosts — includes myworkdayjobs wildcard', () => {
  const hosts = getSupportedHosts();
  assert.ok(hosts.some((h) => h.includes('myworkdayjobs.com')));
});
```

If the imports at the top of `ats-detect.test.mjs` do not already include `getSupportedHosts`, add it:

```javascript
import { detectPlatform, getSupportedHosts } from '../../src/scan/ats-detect.mjs';
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/scan/ats-detect.test.mjs`
Expected: FAIL on the new tests (detectPlatform returns null for Workday; hosts list missing workday).

- [ ] **Step 4: Edit `src/scan/ats-detect.mjs`**

Replace the `PATTERNS` array with a version that has a Workday entry using the full-URL capture:

```javascript
const PATTERNS = [
  { platform: 'lever', re: /^https?:\/\/jobs\.lever\.co\/([^\/?#]+)/i },
  { platform: 'greenhouse', re: /^https?:\/\/(?:job-boards|boards)\.greenhouse\.io\/([^\/?#]+)/i },
  { platform: 'ashby', re: /^https?:\/\/jobs\.ashbyhq\.com\/([^\/?#]+)/i },
  { platform: 'workable', re: /^https?:\/\/apply\.workable\.com\/([^\/?#]+)/i },
  {
    platform: 'workday',
    re: /^(https?:\/\/[^.]+\.wd\d+\.myworkdayjobs\.com\/[^\/?#]+)/i,
  },
];
```

Note: the Workday regex captures the whole match (group 1 = `https://{tenant}.wd{N}.myworkdayjobs.com/{site}`), so `detectPlatform` returns `{ platform: 'workday', slug: '<full URL>' }`.

Then add `workday` to `VERIFIABLE_PLATFORMS`:

```javascript
const VERIFIABLE_PLATFORMS = new Set(['lever', 'greenhouse', 'ashby', 'workday']);
```

And add the wildcard host to `SUPPORTED_HOSTS`:

```javascript
const SUPPORTED_HOSTS = [
  'https://jobs.lever.co/*',
  'https://boards.greenhouse.io/*',
  'https://job-boards.greenhouse.io/*',
  'https://jobs.ashbyhq.com/*',
  'https://*.myworkdayjobs.com/*',
];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/scan/ats-detect.test.mjs`
Expected: PASS, all tests green.

- [ ] **Step 6: Verify the `verifyCompany` dispatcher handles Workday without changes**

The existing `verifyCompany` reads `{platform, slug}` from `detectPlatform` and dynamically imports `./ats/${platform}.mjs`, then calls `mod.verifySlug(slug)`. Since our Workday `verifySlug` accepts the full URL as its argument (Task 5) and `slug` now contains the full URL (Task 6 regex), the existing dispatcher just works. No edit to `verifyCompany` required.

Run the existing verify-company tests to confirm nothing regressed:

```bash
node --test tests/scan/verify-company.test.mjs
```

Expected: PASS, zero regressions.

- [ ] **Step 7: Add a Workday case to `verify-company.test.mjs`**

Read `tests/scan/verify-company.test.mjs` to see the existing style, then append a test that mocks the Workday endpoint and confirms `verifyCompany` returns `{ ok: true }`:

```javascript
test('verifyCompany — dispatches Workday URL to workday.verifySlug', async () => {
  const restore = installMockFetch({
    'https://totalenergies.wd3.myworkdayjobs.com/wday/cxs/totalenergies/TotalEnergies_careers/jobs':
      { total: 5, jobPostings: [{ title: 'Test', externalPath: '/job/x' }] },
  });
  try {
    const r = await verifyCompany(
      'https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers',
    );
    assert.equal(r.ok, true);
    assert.equal(r.count, 1);
  } finally {
    restore();
  }
});
```

If the file does not yet import `installMockFetch`, add `import { installMockFetch } from '../helpers.mjs';` at the top.

- [ ] **Step 8: Run tests to verify they pass**

Run: `node --test tests/scan/verify-company.test.mjs tests/scan/ats-detect.test.mjs tests/scan/ats-workday.test.mjs`
Expected: PASS across all three files.

- [ ] **Step 9: Commit**

```bash
git add src/scan/ats-detect.mjs tests/scan/ats-detect.test.mjs tests/scan/verify-company.test.mjs
git commit -m "feat(scan): wire Workday into detectPlatform and verifyCompany"
```

---

## Task 7: Update CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Read `CHANGELOG.md`**

```bash
head -40 CHANGELOG.md
```

Find the `## Unreleased` section (or create it at the top if missing).

- [ ] **Step 2: Edit CHANGELOG.md**

Under `## Unreleased` → `### Added` (create the subsection if it does not exist), add:

```markdown
- `scan`: Workday ATS support — new fetcher (`src/scan/ats/workday.mjs`) with `parseWorkdayUrl`, `fetchWorkday`, and `verifySlug`. Portals in `config/portals.yml` can now use `platform: workday` with the full career page URL (e.g. `https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers`). `/apply` support for Workday is not yet implemented and is tracked in plans 2 + 3.
```

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): document Workday scan support"
```

---

## Task 8: Full suite, lint, and PII gate

**Files:** none.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, no new failures.

If any pre-existing tests fail (unrelated to Workday), document them in the task summary but do not attempt to fix them in this plan.

- [ ] **Step 2: Run Prettier check**

Run: `npm run lint`
Expected: PASS. If it fails, run `npm run format` and re-commit the formatting fix separately:

```bash
git add -u
git commit -m "chore: prettier format"
```

- [ ] **Step 3: Run PII gate**

Run: `npm run check:pii`
Expected: PASS. The only PII in our changes is the example URL `totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers`, which is a public corporate career page URL, not personal data. If the gate flags anything, investigate before proceeding.

- [ ] **Step 4: Verify no unexpected files were staged**

Run: `git status`
Expected: clean working tree. If anything is unstaged or untracked, review and clean up.

---

## Task 9 (optional, manual): Real tenant smoke test

**Files:** none.

This is a manual verification, not an automated test. Skip if the CAC40 tenants are unreachable (rate limiting, network, outage).

- [ ] **Step 1: Hit a real tenant from a Node REPL**

```bash
node -e "import('./src/scan/ats/workday.mjs').then(m => m.fetchWorkday('https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers', 'TotalEnergies', { pageSize: 5 })).then(o => { console.log('count:', o.length); console.log(o[0]); })"
```

Expected output: a positive count and an Offer object with `platform: 'workday'`, a valid `url`, a non-empty `title`.

If the request fails or the shape differs from the fixtures, stop and investigate. Common issues:
- The real API requires a different `Content-Type` or a cookie.
- `externalPath` format differs from the fixture.
- The tenant uses a different pod (`wd5` instead of `wd3`).

Fix the code if needed, add a regression test with the real response shape as a fixture, commit.

- [ ] **Step 2: Hit `verifySlug` on a known-invalid URL**

```bash
node -e "import('./src/scan/ats/workday.mjs').then(m => m.verifySlug('https://nonexistent.wd3.myworkdayjobs.com/NoSuchSite')).then(r => console.log(r))"
```

Expected: `{ ok: false, status: 4xx, reason: 'HTTP 4xx' }`.

---

## Task 10: Push branch and open PR

**Files:** none.

- [ ] **Step 1: Push the branch**

Run: `git push -u origin feat/scan-workday`
Expected: push succeeds.

- [ ] **Step 2: Open the PR**

Run:

```bash
gh pr create --title "feat(scan): add Workday ATS support (Plan 1/3)" --body "$(cat <<'EOF'
## Summary

- New fetcher `src/scan/ats/workday.mjs` with `parseWorkdayUrl`, `fetchWorkday`, and `verifySlug`. Uses the public `POST /wday/cxs/{tenant}/{site}/jobs` API with JSON pagination.
- `src/scan/ats-detect.mjs` gains a Workday entry in `PATTERNS`, `workday` in `VERIFIABLE_PLATFORMS`, and `*.myworkdayjobs.com` in `SUPPORTED_HOSTS`. The existing `verifyCompany` dispatcher handles Workday with zero code changes because the pattern captures the full URL as the `slug`.
- Tests cover URL parsing, single-page mapping, pagination, empty response, HTTP errors, and `verifyCompany` dispatch.
- CHANGELOG updated.

This is **Plan 1 of 3** from `docs/superpowers/specs/2026-04-11-scan-and-apply-workday-design.md`. `/apply` Workday support is deferred to plans 2 (pure helpers) and 3 (playbook + CLAUDE.md invariant change).

## Test plan

- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] `npm run check:pii` passes
- [ ] Manual: `/scan` on a `config/portals.yml` entry with `platform: workday` appends rows to `data/pipeline.md`
- [ ] Manual: hit a real Workday tenant from a Node REPL and confirm the response shape matches the fixtures

EOF
)"
```

Expected: PR URL printed.

---

## Self-review checklist

- **Spec coverage**: scan fetcher ✓, `parseWorkdayUrl` ✓, `verifySlug` ✓, `ats-detect.mjs` edits ✓, tests ✓, CHANGELOG ✓. Apply-side items are deferred to plans 2+3 — intentional.
- **No placeholders**: every step has exact code/commands. Fixture content is hand-crafted; Task 9 notes real-tenant verification as a manual step with an explicit fallback procedure if the shape differs.
- **Type consistency**: `parseWorkdayUrl` returns `{tenant, pod, site}` and is consumed by `fetchWorkday` (Task 3), `verifySlug` (Task 5), and referenced via `detectPlatform` (Task 6). `verifySlug(url)` takes the full URL everywhere; the `slug` returned by `detectPlatform` is the full URL for Workday only (Task 6). `fetchWorkday` takes `(url, companyName, opts?)` and the tests call it with `{pageSize}` consistently.
