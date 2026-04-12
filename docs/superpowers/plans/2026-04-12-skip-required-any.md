# skip_required_any Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow per-company bypass of the `required_any` title filter for AI-native companies where domain keywords are implicit in the company name.

**Architecture:** A `skip_required_any: true` boolean on `portals.yml` company entries. The scan loop in `index.mjs` builds a per-company whitelist with `required_any: []` when the flag is set. `prefilter-rules.mjs` is untouched — `checkTitle` already treats empty `required_any` as a no-op.

**Tech Stack:** Node 20, ESM, `node:test`

---

### Task 1: Add explicit test for `required_any: []` no-op behavior

**Files:**
- Modify: `tests/lib/prefilter-title.test.mjs` (after line 93)

- [ ] **Step 1: Write the test**

Add this test at the end of `tests/lib/prefilter-title.test.mjs`:

```js
test('checkTitle: empty required_any array is a no-op (skip_required_any support)', () => {
  const wl = { positive: ['intern'], negative: [], required_any: [] };
  assert.deepEqual(checkTitle({ title: 'Research Intern' }, wl), { pass: true });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `node --test --test-name-pattern="empty required_any" tests/lib/prefilter-title.test.mjs`
Expected: PASS (this is a regression guard for existing behavior, not TDD red-green)

- [ ] **Step 3: Commit**

```bash
git add tests/lib/prefilter-title.test.mjs
git commit -m "test(scan): add regression guard for empty required_any no-op"
```

---

### Task 2: Wire skip_required_any in the scan loop

**Files:**
- Modify: `src/scan/index.mjs:96,117,162`

- [ ] **Step 1: Write the failing integration test**

Add this test at the end of `tests/scan/scan.test.mjs`:

```js
test('runScan — skip_required_any bypasses required_any for flagged company', async () => {
  const portalsConfig = {
    title_filter: {
      positive: ['Intern', 'Internship'],
      negative: [],
      required_any: ['ML', 'AI', 'Data'],
    },
    tracked_companies: [
      {
        name: 'Mistral AI',
        careers_url: 'https://jobs.lever.co/mistral',
        enabled: true,
        skip_required_any: true,
      },
      {
        name: 'Photoroom',
        careers_url: 'https://jobs.ashbyhq.com/photoroom',
        enabled: true,
      },
    ],
  };
  const profile = { min_start_date: '2026-08-24', blacklist_companies: [] };

  const leverJson = [
    {
      hostedUrl: 'https://jobs.lever.co/mistral/job-a',
      text: 'Research Engineer Intern',
      categories: { location: 'Paris' },
      descriptionPlain: 'Paris, France, September 2026.',
    },
  ];
  const ashbyJson = {
    jobs: [
      {
        jobUrl: 'https://jobs.ashbyhq.com/photoroom/job-b',
        title: 'Research Engineer Intern',
        location: 'Paris, France',
        descriptionPlain: 'Paris France septembre 2026.',
      },
    ],
  };

  const restore = installMockFetch({
    'https://api.lever.co/v0/postings/mistral?mode=json': leverJson,
    'https://api.ashbyhq.com/posting-api/job-board/photoroom?includeCompensation=false': ashbyJson,
  });

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

  restore();

  // Mistral offer passes (skip_required_any bypasses "ML/AI/Data" check)
  // Photoroom offer fails (title has no ML/AI/Data keyword)
  assert.equal(result.added.length, 1, `expected 1 added, got ${result.added.length}`);
  assert.equal(result.added[0].company, 'Mistral AI');
  assert.equal(result.filtered.skipped_title, 1, 'Photoroom offer should be filtered by required_any');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test --test-name-pattern="skip_required_any" tests/scan/scan.test.mjs`
Expected: FAIL — both offers are filtered because `skip_required_any` is not yet wired.

- [ ] **Step 3: Implement — change the scan loop to use indexed iteration and build per-company whitelist**

In `src/scan/index.mjs`, make two changes:

1. Change `Promise.all` result to preserve company config alongside results. Replace line 96:

```js
const fetchResults = await Promise.all(companies.map(fetchCompanyOffers));
```

with:

```js
const fetchResults = await Promise.all(
  companies.map(async (c) => ({ ...(await fetchCompanyOffers(c)), _company: c }))
);
```

2. Inside the offer loop (line 162), replace:

```js
        check = runPrefilter(offer, prefilterConfig);
```

with:

```js
        const effectiveWhitelist = result._company?.skip_required_any
          ? { ...whitelist, required_any: [] }
          : whitelist;
        check = runPrefilter(offer, { ...prefilterConfig, whitelist: effectiveWhitelist });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test --test-name-pattern="skip_required_any" tests/scan/scan.test.mjs`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/scan/index.mjs tests/scan/scan.test.mjs
git commit -m "feat(scan): wire skip_required_any per-company flag (closes #13)"
```

---

### Task 3: Update docs and template

**Files:**
- Modify: `templates/portals.example.yml`
- Modify: `docs/scan-workflow.md`

- [ ] **Step 1: Update portals.example.yml**

Add `skip_required_any: true` to the Mistral entry and a comment. Replace lines 10-12:

```yaml
  - name: Mistral AI
    careers_url: https://jobs.lever.co/mistral
    enabled: true
```

with:

```yaml
  - name: Mistral AI
    careers_url: https://jobs.lever.co/mistral
    enabled: true
    # Domain is implicit in company name — skip required_any filter
    skip_required_any: true
```

- [ ] **Step 2: Update docs/scan-workflow.md**

After the title filter section (after line 49), add:

```markdown

### Per-company override: `skip_required_any`

For companies where the domain is implicit in the name (e.g. Mistral AI, DeepMind), the `required_any` filter can be bypassed per-company:

```yaml
tracked_companies:
  - name: Mistral AI
    careers_url: https://jobs.lever.co/mistral
    skip_required_any: true
```

When set, `positive` and `negative` filters still apply — only `required_any` is skipped.
```

- [ ] **Step 3: Run PII check**

Run: `npm run check:pii`
Expected: PASS

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: PASS (or fix with `npm run format`)

- [ ] **Step 5: Commit**

```bash
git add templates/portals.example.yml docs/scan-workflow.md
git commit -m "docs: document skip_required_any flag in template and workflow"
```
