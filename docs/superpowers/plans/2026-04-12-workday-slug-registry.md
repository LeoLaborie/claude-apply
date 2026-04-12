# Workday Slug Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a static JSON registry of known Workday tenant→slug mappings so onboarding can propose Workday companies without network verification.

**Architecture:** A JSON file in `src/scan/ats/` loaded at module level by `workday.mjs`. Two new exports in `ats-detect.mjs` (`resolveWorkdayFromRegistry`, `listWorkdayRegistry`) wrap the lookup for consumers. Onboarding docs updated to include Workday.

**Tech Stack:** Node 20+ ESM, `node:test`, `node:fs`, `node:path`

**Spec:** `docs/superpowers/specs/2026-04-12-workday-slug-registry-design.md`

---

### Task 1: Create the registry JSON file

**Files:**
- Create: `src/scan/ats/workday-registry.json`

- [ ] **Step 1: Create the registry file**

```json
[
  { "tenant": "sanofi", "pod": "wd3", "site": "SanofiCareers", "company": "Sanofi" },
  { "tenant": "airbus", "pod": "wd3", "site": "Airbus", "company": "Airbus" },
  { "tenant": "renault", "pod": "wd3", "site": "Renault", "company": "Renault" },
  { "tenant": "michelin", "pod": "wd3", "site": "Michelin", "company": "Michelin" },
  { "tenant": "criteo", "pod": "wd3", "site": "Criteo", "company": "Criteo" },
  { "tenant": "totalenergies", "pod": "wd3", "site": "TotalEnergies_careers", "company": "TotalEnergies" }
]
```

- [ ] **Step 2: Validate JSON syntax**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/scan/ats/workday-registry.json','utf8')); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add src/scan/ats/workday-registry.json
git commit -m "feat(scan): add workday-registry.json with 6 known slugs"
```

---

### Task 2: Add `lookupRegistry` to `workday.mjs` (TDD)

**Files:**
- Modify: `src/scan/ats/workday.mjs:1-6` (add imports and registry loading at top)
- Modify: `src/scan/ats/workday.mjs` (add `lookupRegistry` export before `parseWorkdayUrl`)
- Test: `tests/scan/ats-workday.test.mjs`

- [ ] **Step 1: Write failing tests for `lookupRegistry`**

Add at the top of `tests/scan/ats-workday.test.mjs`, after the existing imports:

```js
import { lookupRegistry } from '../../src/scan/ats/workday.mjs';
```

Update the import line to include `lookupRegistry`:

```js
import { parseWorkdayUrl, fetchWorkday, verifySlug, lookupRegistry } from '../../src/scan/ats/workday.mjs';
```

Add these tests after the existing `parseWorkdayUrl` tests (before `fetchWorkday` tests):

```js
test('lookupRegistry — returns entry for known tenant', () => {
  const entry = lookupRegistry('sanofi');
  assert.deepEqual(entry, {
    tenant: 'sanofi',
    pod: 'wd3',
    site: 'SanofiCareers',
    company: 'Sanofi',
  });
});

test('lookupRegistry — returns null for unknown tenant', () => {
  assert.equal(lookupRegistry('unknown-corp'), null);
});

test('lookupRegistry — is case-insensitive on tenant', () => {
  const entry = lookupRegistry('Sanofi');
  assert.equal(entry.tenant, 'sanofi');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/scan/ats-workday.test.mjs 2>&1 | head -30`
Expected: Error — `lookupRegistry` is not exported from `workday.mjs`

- [ ] **Step 3: Implement `lookupRegistry` in `workday.mjs`**

Add at the top of `src/scan/ats/workday.mjs`, after the comment header (line 3), before `WORKDAY_URL_RE`:

```js
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REGISTRY = JSON.parse(readFileSync(join(__dirname, 'workday-registry.json'), 'utf8'));
const REGISTRY_BY_TENANT = new Map(REGISTRY.map((e) => [e.tenant, e]));

export function lookupRegistry(tenant) {
  if (typeof tenant !== 'string') return null;
  return REGISTRY_BY_TENANT.get(tenant.toLowerCase()) ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/scan/ats-workday.test.mjs`
Expected: All tests pass (existing + 3 new)

- [ ] **Step 5: Commit**

```bash
git add src/scan/ats/workday.mjs tests/scan/ats-workday.test.mjs
git commit -m "feat(scan): add lookupRegistry to workday.mjs"
```

---

### Task 3: Add registry JSON validation test

**Files:**
- Test: `tests/scan/ats-workday.test.mjs`

- [ ] **Step 1: Write validation tests**

Add after the `lookupRegistry` tests:

```js
import { getRegistry } from '../../src/scan/ats/workday.mjs';

// ... (add to existing import line instead of a separate import)
```

Update the import at the top of the file to include `getRegistry`:

```js
import { parseWorkdayUrl, fetchWorkday, verifySlug, lookupRegistry, getRegistry } from '../../src/scan/ats/workday.mjs';
```

Then add the tests:

```js
test('workday-registry.json — no duplicate tenants', () => {
  const registry = getRegistry();
  const tenants = registry.map((e) => e.tenant);
  assert.equal(tenants.length, new Set(tenants).size, 'duplicate tenants found');
});

test('workday-registry.json — all entries have required fields', () => {
  const registry = getRegistry();
  for (const entry of registry) {
    assert.equal(typeof entry.tenant, 'string', `missing tenant in ${JSON.stringify(entry)}`);
    assert.equal(typeof entry.pod, 'string', `missing pod in ${JSON.stringify(entry)}`);
    assert.equal(typeof entry.site, 'string', `missing site in ${JSON.stringify(entry)}`);
    assert.equal(typeof entry.company, 'string', `missing company in ${JSON.stringify(entry)}`);
    assert.match(entry.pod, /^wd\d+$/, `invalid pod format: ${entry.pod}`);
  }
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test tests/scan/ats-workday.test.mjs`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/scan/ats-workday.test.mjs
git commit -m "test(scan): add workday registry JSON validation tests"
```

---

### Task 4: Add `resolveWorkdayFromRegistry` and `listWorkdayRegistry` to `ats-detect.mjs` (TDD)

**Files:**
- Modify: `src/scan/ats-detect.mjs:1` (add import)
- Modify: `src/scan/ats-detect.mjs` (add 2 exports at end)
- Create: `tests/scan/ats-detect-workday.test.mjs`

- [ ] **Step 1: Write failing tests**

Create `tests/scan/ats-detect-workday.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveWorkdayFromRegistry,
  listWorkdayRegistry,
} from '../../src/scan/ats-detect.mjs';

test('resolveWorkdayFromRegistry — returns full URL for known tenant', () => {
  const url = resolveWorkdayFromRegistry('totalenergies');
  assert.equal(url, 'https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers');
});

test('resolveWorkdayFromRegistry — returns null for unknown tenant', () => {
  assert.equal(resolveWorkdayFromRegistry('inconnu'), null);
});

test('resolveWorkdayFromRegistry — is case-insensitive', () => {
  const url = resolveWorkdayFromRegistry('Sanofi');
  assert.equal(url, 'https://sanofi.wd3.myworkdayjobs.com/SanofiCareers');
});

test('listWorkdayRegistry — returns non-empty array', () => {
  const list = listWorkdayRegistry();
  assert.ok(Array.isArray(list));
  assert.ok(list.length > 0);
});

test('listWorkdayRegistry — each entry has required fields', () => {
  for (const entry of listWorkdayRegistry()) {
    assert.equal(typeof entry.tenant, 'string');
    assert.equal(typeof entry.pod, 'string');
    assert.equal(typeof entry.site, 'string');
    assert.equal(typeof entry.company, 'string');
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/scan/ats-detect-workday.test.mjs 2>&1 | head -20`
Expected: Error — `resolveWorkdayFromRegistry` is not exported

- [ ] **Step 3: Add `getRegistry` export to `workday.mjs`**

In `src/scan/ats/workday.mjs`, add after `lookupRegistry`:

```js
export function getRegistry() {
  return [...REGISTRY];
}
```

- [ ] **Step 4: Implement in `ats-detect.mjs`**

Add import at top of `src/scan/ats-detect.mjs`:

```js
import { lookupRegistry, getRegistry } from './ats/workday.mjs';
```

Add at the bottom of `src/scan/ats-detect.mjs`, after `verifyCompany`:

```js
export function resolveWorkdayFromRegistry(tenant) {
  const entry = lookupRegistry(tenant);
  if (!entry) return null;
  return `https://${entry.tenant}.${entry.pod}.myworkdayjobs.com/${entry.site}`;
}

export function listWorkdayRegistry() {
  return getRegistry();
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/scan/ats-detect-workday.test.mjs`
Expected: All 5 tests pass

Also run existing tests to check for regressions:

Run: `node --test tests/scan/ats-workday.test.mjs`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/scan/ats/workday.mjs src/scan/ats-detect.mjs tests/scan/ats-detect-workday.test.mjs
git commit -m "feat(scan): add resolveWorkdayFromRegistry and listWorkdayRegistry"
```

---

### Task 5: Update onboarding docs

**Files:**
- Modify: `.claude/commands/onboard.md:121-137` (add Workday to supported ATS list)

- [ ] **Step 1: Update the ATS constraint section**

In `.claude/commands/onboard.md`, find the constraint block (around line 123):

```markdown
**Constraint**: `src/scan/` only supports **Lever**, **Greenhouse**, and **Ashby** as of v0.1. Every company you add to `portals.yml` must have a `careers_url` matching one of these hosts:

- `https://jobs.lever.co/<slug>`
- `https://boards.greenhouse.io/<slug>` or `https://job-boards.greenhouse.io/<slug>`
- `https://jobs.ashbyhq.com/<slug>`
```

Replace with:

```markdown
**Constraint**: `src/scan/` supports **Lever**, **Greenhouse**, **Ashby**, and **Workday**. Every company you add to `portals.yml` must have a `careers_url` matching one of these hosts:

- `https://jobs.lever.co/<slug>`
- `https://boards.greenhouse.io/<slug>` or `https://job-boards.greenhouse.io/<slug>`
- `https://jobs.ashbyhq.com/<slug>`
- `https://<tenant>.wd<N>.myworkdayjobs.com/<site>` (see Workday registry below)
```

- [ ] **Step 2: Add Workday registry section after the WebSearch section (after line 141)**

After the "### 5.1 Build a candidate list via WebSearch" section, before "### 5.2 Verify each URL via the ATS API", add:

```markdown
### 5.1b Workday companies from registry

Before running WebSearch queries, check the Workday slug registry for known companies:

```bash
node -e "
  import('./src/scan/ats-detect.mjs').then(m => {
    for (const e of m.listWorkdayRegistry()) {
      const url = 'https://' + e.tenant + '.' + e.pod + '.myworkdayjobs.com/' + e.site;
      console.log(e.company.padEnd(20) + url);
    }
  });
"
```

Add any registry entries that match the user's domain directly to the candidate list — no verification needed for these (the slugs are pre-verified). They still go through the approval step in 5.3.
```

- [ ] **Step 3: Also add Workday to the WebSearch queries in section 5.1**

Find the WebSearch query examples and add:

```
site:myworkdayjobs.com "<domain keyword>" <location>
```

Update the "at least 6 queries" to "at least 8 queries" (2 per ATS × 4 ATS).

- [ ] **Step 4: Commit**

```bash
git add .claude/commands/onboard.md
git commit -m "docs: add Workday registry to onboarding instructions"
```

---

### Task 6: Run full test suite and verify

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass, no regressions

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No formatting issues (run `npm run format` if needed)

- [ ] **Step 3: Run PII check**

Run: `npm run check:pii`
Expected: Pass — no real names/emails in the registry (only company names)
