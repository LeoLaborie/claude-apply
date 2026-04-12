# Workday Apply Helpers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pure, testable helpers for Workday account management and multi-step form detection, preparing for the `/apply-workday` playbook in PR 10.

**Architecture:** Two modules under `src/apply/workday/` — `accounts.mjs` (CRUD for per-tenant credentials in YAML) and `step-detect.mjs` (URL + DOM marker matching to identify Workday form steps). No browser, no network, no playbook changes.

**Tech Stack:** Node 20+ built-ins (`node:fs`, `node:path`, `node:crypto`, `node:test`), `js-yaml` (already in deps).

**Spec:** `docs/superpowers/specs/2026-04-12-workday-apply-helpers-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/apply/workday/accounts.mjs` | Read/write/find/verify Workday accounts in YAML |
| Create | `src/apply/workday/step-detect.mjs` | Identify current Workday form step from URL + DOM markers |
| Create | `tests/apply/workday-accounts.test.mjs` | Unit tests for all account operations |
| Create | `tests/apply/workday-step-detect.test.mjs` | Unit tests for step detection |

---

### Task 1: `generateEmail` and `generatePassword`

**Files:**
- Create: `tests/apply/workday-accounts.test.mjs`
- Create: `src/apply/workday/accounts.mjs`

These two functions are pure (no I/O) and have no dependencies on the rest of the module, so they're the ideal starting point.

- [ ] **Step 1: Write the failing tests**

```js
// tests/apply/workday-accounts.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateEmail, generatePassword } from '../../src/apply/workday/accounts.mjs';

test('generateEmail — inserts +tenant before @', () => {
  assert.equal(generateEmail('leo@gmail.com', 'totalenergies'), 'leo+totalenergies@gmail.com');
});

test('generateEmail — replaces existing +tag', () => {
  assert.equal(generateEmail('leo+perso@gmail.com', 'sanofi'), 'leo+sanofi@gmail.com');
});

test('generateEmail — throws on missing @', () => {
  assert.throws(() => generateEmail('nope', 'tenant'), /missing @/);
});

test('generatePassword — returns 32-char base64url string', () => {
  const pw = generatePassword();
  assert.equal(pw.length, 32);
  assert.match(pw, /^[A-Za-z0-9_-]+$/);
});

test('generatePassword — returns unique values', () => {
  const a = generatePassword();
  const b = generatePassword();
  assert.notEqual(a, b);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/apply/workday-accounts.test.mjs`
Expected: FAIL — `Cannot find module '../../src/apply/workday/accounts.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/apply/workday/accounts.mjs
import { randomBytes } from 'node:crypto';

export function generateEmail(profileEmail, tenant) {
  const atIdx = profileEmail.indexOf('@');
  if (atIdx === -1) throw new Error('generateEmail: missing @ in email');
  let local = profileEmail.slice(0, atIdx);
  const domain = profileEmail.slice(atIdx);
  const plusIdx = local.indexOf('+');
  if (plusIdx !== -1) local = local.slice(0, plusIdx);
  return `${local}+${tenant}${domain}`;
}

export function generatePassword() {
  return randomBytes(24).toString('base64url');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/apply/workday-accounts.test.mjs`
Expected: 5 passing

- [ ] **Step 5: Commit**

```bash
git add src/apply/workday/accounts.mjs tests/apply/workday-accounts.test.mjs
git commit -m "feat(apply): add generateEmail and generatePassword for Workday accounts"
```

---

### Task 2: `readAccounts` and `findAccount`

**Files:**
- Modify: `tests/apply/workday-accounts.test.mjs`
- Modify: `src/apply/workday/accounts.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/apply/workday-accounts.test.mjs`:

```js
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readAccounts, findAccount } from '../../src/apply/workday/accounts.mjs';

test('readAccounts — returns [] when file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wdacct-'));
  try {
    const result = readAccounts(join(dir, 'nope.yml'));
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readAccounts — parses valid YAML', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wdacct-'));
  const file = join(dir, 'accounts.yml');
  try {
    writeFileSync(file, `accounts:
  - tenant: totalenergies
    email: leo+totalenergies@gmail.com
    password: "abc123"
    created_at: 2026-04-12T10:00:00Z
    email_verified: true
`);
    const result = readAccounts(file);
    assert.equal(result.length, 1);
    assert.equal(result[0].tenant, 'totalenergies');
    assert.equal(result[0].email, 'leo+totalenergies@gmail.com');
    assert.equal(result[0].email_verified, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('findAccount — returns matching account', () => {
  const accounts = [
    { tenant: 'totalenergies', email: 'a@b.com' },
    { tenant: 'sanofi', email: 'c@d.com' },
  ];
  const found = findAccount(accounts, 'sanofi');
  assert.equal(found.email, 'c@d.com');
});

test('findAccount — returns undefined when not found', () => {
  const accounts = [{ tenant: 'totalenergies', email: 'a@b.com' }];
  assert.equal(findAccount(accounts, 'missing'), undefined);
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `node --test tests/apply/workday-accounts.test.mjs`
Expected: 4 new FAIL — `readAccounts is not a function` (or similar)

- [ ] **Step 3: Write minimal implementation**

Add to `src/apply/workday/accounts.mjs`:

```js
import { readFileSync, existsSync } from 'node:fs';
import yaml from 'js-yaml';

export function readAccounts(filePath) {
  if (!existsSync(filePath)) return [];
  const doc = yaml.load(readFileSync(filePath, 'utf8'));
  return doc?.accounts ?? [];
}

export function findAccount(accounts, tenant) {
  return accounts.find((a) => a.tenant === tenant);
}
```

Note: merge the `import` statements with the existing ones at the top of the file. The `js-yaml` import uses the default import (same pattern as `src/lib/load-profile.mjs` which does `const yaml = await import('js-yaml')`). Here we use static import since `js-yaml` is a direct dependency.

- [ ] **Step 4: Run tests to verify all pass**

Run: `node --test tests/apply/workday-accounts.test.mjs`
Expected: 9 passing

- [ ] **Step 5: Commit**

```bash
git add src/apply/workday/accounts.mjs tests/apply/workday-accounts.test.mjs
git commit -m "feat(apply): add readAccounts and findAccount for Workday"
```

---

### Task 3: `writeAccount` (atomic write)

**Files:**
- Modify: `tests/apply/workday-accounts.test.mjs`
- Modify: `src/apply/workday/accounts.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/apply/workday-accounts.test.mjs`:

```js
import { readFileSync as readFile, existsSync as exists } from 'node:fs';
import { writeAccount } from '../../src/apply/workday/accounts.mjs';

test('writeAccount — creates file with one account when file absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wdacct-'));
  const file = join(dir, 'accounts.yml');
  try {
    writeAccount(file, {
      tenant: 'totalenergies',
      email: 'leo+totalenergies@gmail.com',
      password: 'secret123',
    });
    const accounts = readAccounts(file);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].tenant, 'totalenergies');
    assert.equal(accounts[0].email_verified, false);
    assert.ok(accounts[0].created_at);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeAccount — appends without overwriting existing accounts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wdacct-'));
  const file = join(dir, 'accounts.yml');
  try {
    writeAccount(file, { tenant: 'totalenergies', email: 'a@b.com', password: 'pw1' });
    writeAccount(file, { tenant: 'sanofi', email: 'c@d.com', password: 'pw2' });
    const accounts = readAccounts(file);
    assert.equal(accounts.length, 2);
    assert.equal(accounts[0].tenant, 'totalenergies');
    assert.equal(accounts[1].tenant, 'sanofi');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeAccount — no .tmp file remains after write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wdacct-'));
  const file = join(dir, 'accounts.yml');
  try {
    writeAccount(file, { tenant: 'test', email: 'x@y.com', password: 'pw' });
    assert.equal(exists(file + '.tmp'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `node --test tests/apply/workday-accounts.test.mjs`
Expected: 3 new FAIL — `writeAccount is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to `src/apply/workday/accounts.mjs`:

```js
import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function writeAccount(filePath, { tenant, email, password }) {
  mkdirSync(dirname(filePath), { recursive: true });
  const existing = readAccounts(filePath);
  existing.push({
    tenant,
    email,
    password,
    created_at: new Date().toISOString(),
    email_verified: false,
  });
  const doc = yaml.dump({ accounts: existing }, { lineWidth: -1 });
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, doc);
  renameSync(tmp, filePath);
}
```

Merge the `import` additions with the existing imports at the top.

- [ ] **Step 4: Run tests to verify all pass**

Run: `node --test tests/apply/workday-accounts.test.mjs`
Expected: 12 passing

- [ ] **Step 5: Commit**

```bash
git add src/apply/workday/accounts.mjs tests/apply/workday-accounts.test.mjs
git commit -m "feat(apply): add writeAccount with atomic YAML write"
```

---

### Task 4: `markVerified`

**Files:**
- Modify: `tests/apply/workday-accounts.test.mjs`
- Modify: `src/apply/workday/accounts.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `tests/apply/workday-accounts.test.mjs`:

```js
import { markVerified } from '../../src/apply/workday/accounts.mjs';

test('markVerified — sets email_verified to true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wdacct-'));
  const file = join(dir, 'accounts.yml');
  try {
    writeAccount(file, { tenant: 'totalenergies', email: 'a@b.com', password: 'pw' });
    markVerified(file, 'totalenergies');
    const accounts = readAccounts(file);
    assert.equal(accounts[0].email_verified, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('markVerified — leaves other accounts unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wdacct-'));
  const file = join(dir, 'accounts.yml');
  try {
    writeAccount(file, { tenant: 'totalenergies', email: 'a@b.com', password: 'pw1' });
    writeAccount(file, { tenant: 'sanofi', email: 'c@d.com', password: 'pw2' });
    markVerified(file, 'totalenergies');
    const accounts = readAccounts(file);
    assert.equal(accounts[0].email_verified, true);
    assert.equal(accounts[1].email_verified, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('markVerified — throws when tenant not found', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wdacct-'));
  const file = join(dir, 'accounts.yml');
  try {
    writeAccount(file, { tenant: 'totalenergies', email: 'a@b.com', password: 'pw' });
    assert.throws(() => markVerified(file, 'missing'), /not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `node --test tests/apply/workday-accounts.test.mjs`
Expected: 3 new FAIL — `markVerified is not a function`

- [ ] **Step 3: Write minimal implementation**

Add to `src/apply/workday/accounts.mjs`:

```js
export function markVerified(filePath, tenant) {
  const accounts = readAccounts(filePath);
  const account = findAccount(accounts, tenant);
  if (!account) throw new Error(`markVerified: tenant '${tenant}' not found`);
  account.email_verified = true;
  const doc = yaml.dump({ accounts }, { lineWidth: -1 });
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, doc);
  renameSync(tmp, filePath);
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `node --test tests/apply/workday-accounts.test.mjs`
Expected: 15 passing

- [ ] **Step 5: Commit**

```bash
git add src/apply/workday/accounts.mjs tests/apply/workday-accounts.test.mjs
git commit -m "feat(apply): add markVerified for Workday accounts"
```

---

### Task 5: `detectStep`

**Files:**
- Create: `tests/apply/workday-step-detect.test.mjs`
- Create: `src/apply/workday/step-detect.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// tests/apply/workday-step-detect.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectStep, STEP_SIGNATURES } from '../../src/apply/workday/step-detect.mjs';

// --- URL-only matching ---

test('detectStep — URL /myInformation → my-information', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/site/job/123/myInformation', domMarkers: [] }),
    'my-information'
  );
});

test('detectStep — URL /myExperience → my-experience', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/site/job/123/myExperience', domMarkers: [] }),
    'my-experience'
  );
});

test('detectStep — URL /voluntaryDisclosures → voluntary-disclosures', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/site/job/123/voluntaryDisclosures', domMarkers: [] }),
    'voluntary-disclosures'
  );
});

test('detectStep — URL /selfIdentify → self-identify', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/site/job/123/selfIdentify', domMarkers: [] }),
    'self-identify'
  );
});

test('detectStep — URL /review → review', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/site/job/123/review', domMarkers: [] }),
    'review'
  );
});

// --- DOM-only matching ---

test('detectStep — DOM marker myInformation-SectionTitle → my-information', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/site/job/123/apply', domMarkers: ['myInformation-SectionTitle'] }),
    'my-information'
  );
});

test('detectStep — DOM marker myExperience-SectionTitle → my-experience', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/generic', domMarkers: ['myExperience-SectionTitle'] }),
    'my-experience'
  );
});

test('detectStep — DOM marker voluntaryDisclosures-SectionTitle → voluntary-disclosures', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/generic', domMarkers: ['voluntaryDisclosures-SectionTitle'] }),
    'voluntary-disclosures'
  );
});

test('detectStep — DOM marker selfIdentify-SectionTitle → self-identify', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/generic', domMarkers: ['selfIdentify-SectionTitle'] }),
    'self-identify'
  );
});

test('detectStep — DOM marker review-SectionTitle → review', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/generic', domMarkers: ['review-SectionTitle'] }),
    'review'
  );
});

// --- Priority and edge cases ---

test('detectStep — URL wins when URL and DOM disagree', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/site/job/123/myExperience', domMarkers: ['review-SectionTitle'] }),
    'my-experience'
  );
});

test('detectStep — returns generic when nothing matches', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/site/job/123/unknownStep', domMarkers: [] }),
    'generic'
  );
});

test('detectStep — empty domMarkers falls back to URL only', () => {
  assert.equal(
    detectStep({ url: 'https://t.wd3.myworkdayjobs.com/site/job/123/review', domMarkers: [] }),
    'review'
  );
});

test('detectStep — empty url falls back to DOM only', () => {
  assert.equal(
    detectStep({ url: '', domMarkers: ['myInformation-SectionTitle'] }),
    'my-information'
  );
});

test('STEP_SIGNATURES — exported and non-empty', () => {
  assert.ok(Array.isArray(STEP_SIGNATURES));
  assert.ok(STEP_SIGNATURES.length >= 5);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/apply/workday-step-detect.test.mjs`
Expected: FAIL — `Cannot find module '../../src/apply/workday/step-detect.mjs'`

- [ ] **Step 3: Write minimal implementation**

```js
// src/apply/workday/step-detect.mjs

export const STEP_SIGNATURES = [
  {
    step: 'my-information',
    urlPattern: /\/myInformation\b/i,
    domMarkers: ['myInformation-SectionTitle'],
  },
  {
    step: 'my-experience',
    urlPattern: /\/myExperience\b/i,
    domMarkers: ['myExperience-SectionTitle'],
  },
  {
    step: 'voluntary-disclosures',
    urlPattern: /\/voluntaryDisclosures\b/i,
    domMarkers: ['voluntaryDisclosures-SectionTitle'],
  },
  {
    step: 'self-identify',
    urlPattern: /\/selfIdentify\b/i,
    domMarkers: ['selfIdentify-SectionTitle'],
  },
  {
    step: 'review',
    urlPattern: /\/review\b/i,
    domMarkers: ['review-SectionTitle'],
  },
];

export function detectStep({ url, domMarkers }) {
  for (const sig of STEP_SIGNATURES) {
    if (url && sig.urlPattern.test(url)) return sig.step;
  }
  for (const sig of STEP_SIGNATURES) {
    if (sig.domMarkers.some((m) => domMarkers.includes(m))) return sig.step;
  }
  return 'generic';
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `node --test tests/apply/workday-step-detect.test.mjs`
Expected: 15 passing

- [ ] **Step 5: Commit**

```bash
git add src/apply/workday/step-detect.mjs tests/apply/workday-step-detect.test.mjs
git commit -m "feat(apply): add Workday step detector with URL + DOM matching"
```

---

### Task 6: Final validation and PR commit

**Files:**
- No new files — validation only

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass (existing + 30 new)

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No errors. If formatting issues, run `npm run format` then re-check.

- [ ] **Step 3: Run PII check**

Run: `npm run check:pii`
Expected: Pass — no real PII in any file.

- [ ] **Step 4: Squash into feature commit and push branch**

```bash
git checkout -b feat/apply-workday-helpers
git push -u origin feat/apply-workday-helpers
```

Note: since we committed incrementally on the working branch, create the feature branch at current HEAD (all commits are already there). The PR will show all commits.
