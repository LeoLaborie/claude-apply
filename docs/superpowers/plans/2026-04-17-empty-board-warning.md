# Empty-board warning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface zero-job ATS boards as a distinct `⚠` state — in `verifyCompany`, in `/scan` summary, and via a user-confirmation step in `/apply-onboard:companies` — so the user can spot wrong slugs before they silently land in `portals.yml`.

**Architecture:** Add a `warning` field to `verifyCompany` when `ok && count === 0`. Mirror that policy inside `runScan` so `perCompany[].warning` is populated. Update `formatSummary` to render `⚠`. Add a new step 5c to the `/apply-onboard:companies` agent instruction that batch-confirms empty boards before approval.

**Tech Stack:** Node.js 20+, ESM (`.mjs`), `node:test`, Prettier.

**Spec:** `docs/superpowers/specs/2026-04-17-empty-board-warning-design.md`

**Issue:** [#44](https://github.com/LeoLaborie/claude-apply/issues/44)

---

## File Structure

Files touched (3 code + tests, 1 doc):

| Path | Responsibility |
|---|---|
| `src/scan/ats-detect.mjs` | Dispatcher — inject `warning` on empty boards |
| `tests/scan/verify-company.test.mjs` | Cover the new warning contract |
| `src/scan/index.mjs` | `runScan` populates `perCompany[].warning`; `formatSummary` renders `⚠` |
| `tests/scan/scan.test.mjs` | Cover `runScan` + `formatSummary` warning behavior |
| `.claude/commands/apply-onboard/companies.md` | New step 5c (agent instruction) |

No new files, no new exports.

---

## Task 1: `verifyCompany` adds warning on count=0

**Files:**
- Modify: `src/scan/ats-detect.mjs:38-47` (`verifyCompany` function)
- Test: `tests/scan/verify-company.test.mjs`

- [ ] **Step 1: Write failing tests**

Append to `tests/scan/verify-company.test.mjs` (before the final closing line):

```js
test('verifyCompany — count=0 on Ashby adds warning', async () => {
  restore = installMockFetch({
    'https://api.ashbyhq.com/posting-api/job-board/vercel?includeCompensation=false': {
      jobs: [],
    },
  });
  const r = await verifyCompany('https://jobs.ashbyhq.com/vercel');
  assert.equal(r.ok, true);
  assert.equal(r.count, 0);
  assert.match(r.warning, /board live but empty/i);
});

test('verifyCompany — count=0 on Lever adds warning', async () => {
  restore = installMockFetch({
    'https://api.lever.co/v0/postings/ghosttown?mode=json': [],
  });
  const r = await verifyCompany('https://jobs.lever.co/ghosttown');
  assert.equal(r.ok, true);
  assert.equal(r.count, 0);
  assert.match(r.warning, /board live but empty/i);
});

test('verifyCompany — count>0 does not add warning', async () => {
  restore = installMockFetch({
    'https://api.lever.co/v0/postings/mistral?mode=json': [{ id: '1' }],
  });
  const r = await verifyCompany('https://jobs.lever.co/mistral');
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.equal(r.warning, undefined);
});

test('verifyCompany — ok:false does not add warning', async () => {
  const r = await verifyCompany('https://careers.example.com/jobs');
  assert.equal(r.ok, false);
  assert.equal(r.warning, undefined);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/scan/verify-company.test.mjs`
Expected: 4 failures — either `r.warning` is `undefined` when it should match `/board live/`, or test that expects `undefined` passes (that one passes today).

- [ ] **Step 3: Implement**

Replace `src/scan/ats-detect.mjs:38-47` with:

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/scan/verify-company.test.mjs`
Expected: all tests pass (8 total — 4 existing + 4 new).

- [ ] **Step 5: Run full suite**

Run: `npm test`
Expected: 414 passing (410 baseline + 4 new).

- [ ] **Step 6: Commit**

```bash
git add src/scan/ats-detect.mjs tests/scan/verify-company.test.mjs
git commit -m "feat(scan): verifyCompany warns on empty boards (#44)

Return {ok: true, count: 0, warning: '...'} when an ATS board is live
but exposes zero public jobs. Per-ATS verifySlug contracts unchanged."
```

---

## Task 2: `runScan` populates `perCompany[].warning`

**Files:**
- Modify: `src/scan/index.mjs:150-155` (error-path push — add `warning: null`)
- Modify: `src/scan/index.mjs:171-175` (success-path push — compute warning)
- Test: `tests/scan/scan.test.mjs`

- [ ] **Step 1: Write failing test**

Append to `tests/scan/scan.test.mjs`:

```js
test('runScan — perCompany.warning set when raw=0 without error', async () => {
  const portalsConfig = {
    title_filter: { positive: [], negative: [] },
    tracked_companies: [
      { name: 'Ghost Town', careers_url: 'https://jobs.ashbyhq.com/ghost', enabled: true },
    ],
  };
  const profile = { blacklist_companies: [], target_locations: ['France'] };

  const restore = installMockFetch({
    'https://api.ashbyhq.com/posting-api/job-board/ghost?includeCompensation=false': {
      jobs: [],
    },
  });

  const pipelinePath = path.join(tmp, 'pipeline.md');
  const historyPath = path.join(tmp, 'scan-history.tsv');
  const filteredPath = path.join(tmp, 'filtered-out.tsv');
  const applicationsPath = path.join(tmp, 'applications.md');
  fs.writeFileSync(applicationsPath, '# Apps\n');

  try {
    const result = await runScan({
      portalsConfig,
      profile,
      pipelinePath,
      historyPath,
      filteredPath,
      applicationsPath,
      dryRun: true,
    });
    assert.equal(result.perCompany.length, 1);
    const [entry] = result.perCompany;
    assert.equal(entry.count, 0);
    assert.equal(entry.error, null);
    assert.match(entry.warning, /board live but empty/i);
  } finally {
    restore();
  }
});

test('runScan — perCompany.warning is null when raw>0', async () => {
  const portalsConfig = {
    title_filter: { positive: [], negative: [] },
    tracked_companies: [
      { name: 'Mistral AI', careers_url: 'https://jobs.lever.co/mistral', enabled: true },
    ],
  };
  const profile = { blacklist_companies: [], target_locations: ['France'] };

  const restore = installMockFetch({
    'https://api.lever.co/v0/postings/mistral?mode=json': [
      {
        hostedUrl: 'https://jobs.lever.co/mistral/a',
        text: 'Engineer',
        categories: { location: 'Paris' },
        descriptionPlain: 'Paris France',
      },
    ],
  });

  const pipelinePath = path.join(tmp, 'pipeline.md');
  const historyPath = path.join(tmp, 'scan-history.tsv');
  const filteredPath = path.join(tmp, 'filtered-out.tsv');
  const applicationsPath = path.join(tmp, 'applications.md');
  fs.writeFileSync(applicationsPath, '# Apps\n');

  try {
    const result = await runScan({
      portalsConfig,
      profile,
      pipelinePath,
      historyPath,
      filteredPath,
      applicationsPath,
      dryRun: true,
    });
    assert.equal(result.perCompany.length, 1);
    assert.equal(result.perCompany[0].warning, null);
  } finally {
    restore();
  }
});

test('runScan — perCompany.warning is null when there is an error', async () => {
  const portalsConfig = {
    title_filter: { positive: [], negative: [] },
    tracked_companies: [
      { name: 'Broken', careers_url: 'https://jobs.lever.co/broken', enabled: true },
    ],
  };
  const profile = { blacklist_companies: [], target_locations: ['France'] };

  const restore = installMockFetch({
    'https://api.lever.co/v0/postings/broken?mode=json': { __status: 404 },
  });

  const pipelinePath = path.join(tmp, 'pipeline.md');
  const historyPath = path.join(tmp, 'scan-history.tsv');
  const filteredPath = path.join(tmp, 'filtered-out.tsv');
  const applicationsPath = path.join(tmp, 'applications.md');
  fs.writeFileSync(applicationsPath, '# Apps\n');

  try {
    const result = await runScan({
      portalsConfig,
      profile,
      pipelinePath,
      historyPath,
      filteredPath,
      applicationsPath,
      dryRun: true,
    });
    assert.equal(result.perCompany.length, 1);
    const [entry] = result.perCompany;
    assert.ok(entry.error);
    assert.equal(entry.warning, null);
  } finally {
    restore();
  }
});
```

Note: the third test assumes `installMockFetch` supports a `{__status: 404}` shape for non-200 responses. If it does not, inspect `tests/helpers.mjs` and adapt — pass `null` or use the helper's documented way to simulate a 4xx. Do NOT skip this test; instead adjust the mock to actually trigger the error path.

- [ ] **Step 2: Verify mock helper capability**

Run: `grep -n "installMockFetch\|__status\|status" tests/helpers.mjs | head -20`

If `__status` is not supported, read the helper and pick the actually-supported shape (e.g. passing a function or a Response-like object). Update the third test accordingly. The goal is only to populate `result.error` on the `perCompany` entry so we can assert `warning: null`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/scan/scan.test.mjs`
Expected: the new tests fail — `entry.warning` is `undefined` (property missing entirely).

- [ ] **Step 4: Implement — error path**

Edit `src/scan/index.mjs:150-155`. Replace:

```js
perCompany.push({
  company: result.company,
  platform: result.platform,
  count: 0,
  error: result.error,
});
```

with:

```js
perCompany.push({
  company: result.company,
  platform: result.platform,
  count: 0,
  error: result.error,
  warning: null,
});
```

- [ ] **Step 5: Implement — success path**

Edit `src/scan/index.mjs:171-175`. Replace:

```js
perCompany.push({
  company: result.company,
  platform: result.platform,
  count: result.offers.length,
});
```

with:

```js
const warning =
  result.offers.length === 0 ? 'board live but empty — possibly wrong slug' : null;
perCompany.push({
  company: result.company,
  platform: result.platform,
  count: result.offers.length,
  error: null,
  warning,
});
```

Adding `error: null` keeps the two push sites shape-symmetric (every entry has both `error` and `warning`).

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/scan/scan.test.mjs`
Expected: all scan tests pass (existing + 3 new).

- [ ] **Step 7: Run full suite**

Run: `npm test`
Expected: 417 passing (414 after Task 1 + 3 new).

- [ ] **Step 8: Commit**

```bash
git add src/scan/index.mjs tests/scan/scan.test.mjs
git commit -m "feat(scan): runScan flags empty boards on perCompany (#44)

perCompany entries now always carry {error, warning}. warning is set
to a constant string when raw count is zero without error, null otherwise."
```

---

## Task 3: `formatSummary` renders `⚠` for warnings

**Files:**
- Modify: `src/scan/index.mjs:281-283` (`formatSummary` per-company block)
- Test: `tests/scan/scan.test.mjs` (add one formatSummary test — we need to export it or test it indirectly via stdout)

- [ ] **Step 1: Check whether formatSummary is exported**

Run: `grep -n "export\|formatSummary" src/scan/index.mjs`

If `formatSummary` is not exported, add it to the exports for testability. At the bottom of `src/scan/index.mjs` (or next to `runScan`'s export), add:

```js
export { formatSummary };
```

Only add this if it is not already exported.

- [ ] **Step 2: Write failing test**

Append to `tests/scan/scan.test.mjs`:

```js
import { formatSummary } from '../../src/scan/index.mjs';

test('formatSummary — renders ⚠ for a company with a warning', () => {
  const result = {
    scanned: 2,
    raw: 5,
    perCompany: [
      { company: 'Anthropic', platform: 'lever', count: 5, error: null, warning: null },
      {
        company: 'Vercel',
        platform: 'ashby',
        count: 0,
        error: null,
        warning: 'board live but empty — possibly wrong slug',
      },
    ],
    filtered: {
      skipped_dup: 0,
      skipped_title: 0,
      skipped_blacklist: 0,
      skipped_location: 0,
      skipped_date: 0,
    },
    added: [],
    errors: [],
    historyWrites: 0,
  };
  const out = formatSummary(result, true);
  assert.match(out, /⚠ Vercel/);
  assert.match(out, /board live but empty/);
  assert.match(out, /✓ Anthropic/);
});
```

Merge the `import` line with the existing top-level import block if present (keep a single `import` from `src/scan/index.mjs`).

- [ ] **Step 3: Run tests to verify it fails**

Run: `node --test tests/scan/scan.test.mjs`
Expected: the formatSummary test fails — `⚠` is not emitted; only `✓` or `✗` are.

- [ ] **Step 4: Implement**

Edit `src/scan/index.mjs:281-283`. Replace:

```js
const mark = c.error ? '✗' : '✓';
const note = c.error ? `(${c.error})` : `(${c.platform})`;
lines.push(`  ${mark} ${c.company.padEnd(18)} ${String(c.count).padStart(3)} offres ${note}`);
```

with:

```js
const mark = c.error ? '✗' : c.warning ? '⚠' : '✓';
const note = c.error
  ? `(${c.error})`
  : c.warning
    ? `(${c.platform} — ${c.warning})`
    : `(${c.platform})`;
lines.push(`  ${mark} ${c.company.padEnd(18)} ${String(c.count).padStart(3)} offres ${note}`);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/scan/scan.test.mjs`
Expected: all scan tests pass.

- [ ] **Step 6: Run full suite + lint**

Run: `npm test && npm run lint`
Expected: 418 passing, lint clean.

- [ ] **Step 7: Commit**

```bash
git add src/scan/index.mjs tests/scan/scan.test.mjs
git commit -m "feat(scan): formatSummary renders ⚠ for empty boards (#44)

Companies with warning=... now render with ⚠ mark and inline reason
in the /scan summary block, keeping live progress lines unchanged."
```

---

## Task 4: Add step 5c to `/apply-onboard:companies`

**Files:**
- Modify: `.claude/commands/apply-onboard/companies.md` (insert after line 111, before the `## 6.` header)

- [ ] **Step 1: Locate the insertion point**

Run: `grep -n "^## 6\\.\\|^### 5b\\|Drop any candidate that is a clear duplicate" .claude/commands/apply-onboard/companies.md`

The new subsection goes between the end of 5b (duplicate-drop sentence) and the `## 6. Trim to ~30 and get approval` header.

- [ ] **Step 2: Insert the new subsection**

Insert the following block immediately before the `## 6. Trim to ~30 and get approval (technical gate)` heading:

```markdown
### 5c. Confirm empty boards

After step 5 + 5b, some candidates may have returned `{ok: true, count: 0, warning: ...}` — the board is live but currently exposes zero public jobs. This is ambiguous: the company may genuinely have a hiring freeze, OR the slug may be wrong (e.g. `vercel` vs `vercel-careers`).

If N ≥ 1 candidates carry a `warning`, present the list in a compact table:

```
Company         ATS     Careers URL
────────────────────────────────────────────────
Vercel          ashby   https://jobs.ashbyhq.com/vercel
```

Then call `AskUserQuestion` **once** with these exact options:

- `"Drop all empty boards"` — remove every empty-board candidate from the list before step 6.
- `"Keep all empty boards"` — proceed with them into the step-6 approval table as-is.
- `"Let me decide per company"` — loop over each empty-board candidate and call `AskUserQuestion` with options `Keep`, `Drop`, `Edit URL`. On `Edit URL`, ask the user for the corrected URL and re-verify it via step 5 (`verifyCompany`). If the new URL also returns `count: 0`, ask again. If it returns `ok: false`, drop.

If no candidate has a `warning`, skip this step silently.
```

- [ ] **Step 3: Verify no other docs need updating**

Run: `grep -rn "count: 0\\|count===0\\|count === 0" docs/ .claude/ --include='*.md'`

If step 5 of `companies.md` still says "If count is 0, flag it for sanity-check" (companies.md:88), update that bullet to point to 5c instead:

Replace the bullet `- `{ ok: true, count: N }` → slug is live. Keep the company. If `count` is 0, flag it for sanity-check.` with:

```
- `{ ok: true, count: N, warning? }` → slug is live. Keep the company. If `count` is 0, verifyCompany adds `warning: 'board live but empty — possibly wrong slug'`; step 5c will ask the user to confirm these before writing.
```

- [ ] **Step 4: Lint & PII check**

Run: `npm run format && npm run check:pii`
Expected: clean (no changes after `format` ideally, PII check passes).

- [ ] **Step 5: Commit**

```bash
git add .claude/commands/apply-onboard/companies.md
git commit -m "docs(onboard): confirm empty boards before approval (#44)

Add step 5c: batch-confirm candidates whose verifyCompany returned
count=0 warning. Three options: drop-all, keep-all, per-company loop
with Edit-URL re-verify."
```

---

## Task 5: Push and update draft PR

- [ ] **Step 1: Push**

Run: `git push`

- [ ] **Step 2: Mark the draft PR ready for review**

Run: `gh pr ready 60`

- [ ] **Step 3: Verify CI**

Run: `gh pr checks 60 --watch`
Expected: lint, tests, PII all pass.

If anything fails, diagnose the root cause and add a fix-up commit; do not force-push.

---

## Self-review checklist (done)

- **Spec coverage:** verifyCompany (Task 1), runScan warning (Task 2), formatSummary ⚠ (Task 3), step 5c (Task 4). All four spec sections map to tasks.
- **No placeholders:** every step has exact file paths, exact commands, concrete code.
- **Type consistency:** `warning` field is a string or `null` across all sites. Both `perCompany` push sites end up with the same shape (`{company, platform, count, error, warning}`). Warning string is one constant: `'board live but empty — possibly wrong slug'`.
- **Test-first:** each code task has a failing-test step before implementation.
