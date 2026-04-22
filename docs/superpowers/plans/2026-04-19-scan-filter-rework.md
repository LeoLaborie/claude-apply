# Scan filter rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add soft-match (required_any matched on title OR description) and auto-derived language filter (reject offers requiring a language the candidate lacks ≥ B2) to the `/scan` pipeline.

**Architecture:** Two new pure modules under `src/lib/` and `src/scan/` (language detection + body dispatcher). Extend `src/lib/prefilter-rules.mjs` with a new `checkLanguages` rule and an optional `body` parameter on `checkTitle`. `runPrefilter` becomes `async` and receives `config.fetchBody` via dependency injection, preserving the `lib/` ↔ `scan/` boundary.

**Tech Stack:** Node 20+ ESM, `node:test`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-19-scan-filter-rework-design.md`

---

## File structure

**Created**
- `src/lib/language-detect.mjs` — `LANG_PATTERNS`, `detectRequiredLanguages`, `LEVEL_RANK`, `levelRank`, `MIN_LANGUAGE_LEVEL`.
- `src/scan/fetch-offer-body.mjs` — `fetchOfferBody(offer)` platform dispatcher.
- `tests/lib/language-detect.test.mjs`
- `tests/scan/fetch-offer-body.test.mjs`

**Modified**
- `src/lib/prefilter-rules.mjs` — extend `checkTitle`, add `checkLanguages`, make `runPrefilter` async, add soft-match short-circuit.
- `src/scan/index.mjs` — await `runPrefilter`, inject `fetchBody` and `profileLanguages`, new `skipped_language` bucket, summary line.
- `tests/lib/prefilter-rules.test.mjs` — add cases for body-aware `checkTitle`, `checkLanguages`, async short-circuit.
- `tests/scan/scan.test.mjs` — integration: language bucket + summary line.
- `templates/portals.example.yml` — document `required_any_in`.

---

### Task 1: Language level ranker

**Files:**
- Create: `src/lib/language-detect.mjs`
- Test: `tests/lib/language-detect.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
// tests/lib/language-detect.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelRank, MIN_LANGUAGE_LEVEL } from '../../src/lib/language-detect.mjs';

test('levelRank: orders A1 < A2 < B1 < B2 < C1 < C2 < native', () => {
  assert.ok(levelRank('A1') < levelRank('A2'));
  assert.ok(levelRank('A2') < levelRank('B1'));
  assert.ok(levelRank('B1') < levelRank('B2'));
  assert.ok(levelRank('B2') < levelRank('C1'));
  assert.ok(levelRank('C1') < levelRank('C2'));
  assert.ok(levelRank('C2') < levelRank('native'));
});

test('levelRank: unknown level returns 0', () => {
  assert.equal(levelRank('Z9'), 0);
  assert.equal(levelRank(undefined), 0);
  assert.equal(levelRank(null), 0);
  assert.equal(levelRank(''), 0);
});

test('levelRank: case-insensitive', () => {
  assert.equal(levelRank('b2'), levelRank('B2'));
  assert.equal(levelRank('NATIVE'), levelRank('native'));
});

test('MIN_LANGUAGE_LEVEL constant equals B2', () => {
  assert.equal(MIN_LANGUAGE_LEVEL, 'B2');
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `node --test tests/lib/language-detect.test.mjs`
Expected: FAIL — "Cannot find module './src/lib/language-detect.mjs'".

- [ ] **Step 3: Implement minimal module**

```js
// src/lib/language-detect.mjs
export const MIN_LANGUAGE_LEVEL = 'B2';

const LEVEL_RANK = {
  a1: 1,
  a2: 2,
  b1: 3,
  b2: 4,
  c1: 5,
  c2: 6,
  native: 7,
};

export function levelRank(level) {
  if (typeof level !== 'string' || level.length === 0) return 0;
  return LEVEL_RANK[level.toLowerCase()] ?? 0;
}
```

- [ ] **Step 4: Run tests and verify pass**

Run: `node --test tests/lib/language-detect.test.mjs`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/language-detect.mjs tests/lib/language-detect.test.mjs
git commit -m "feat(scan): add language level ranker"
```

---

### Task 2: Language requirement detection

**Files:**
- Modify: `src/lib/language-detect.mjs`
- Modify: `tests/lib/language-detect.test.mjs`

- [ ] **Step 1: Write failing tests for detectRequiredLanguages**

Append to `tests/lib/language-detect.test.mjs`:

```js
import { detectRequiredLanguages } from '../../src/lib/language-detect.mjs';

test('detectRequiredLanguages: "Spanish speaker" → [es]', () => {
  assert.deepEqual(detectRequiredLanguages('Data Scientist - Spanish speaker'), ['es']);
});

test('detectRequiredLanguages: "Deutschsprachig" → [de]', () => {
  assert.deepEqual(detectRequiredLanguages('Senior Deutschsprachig Engineer'), ['de']);
});

test('detectRequiredLanguages: "Nederlandstalig" → [nl]', () => {
  assert.deepEqual(detectRequiredLanguages('Nederlandstalig Analyst'), ['nl']);
});

test('detectRequiredLanguages: Italian marker → [it]', () => {
  assert.deepEqual(detectRequiredLanguages('Italian speaking Data Engineer'), ['it']);
});

test('detectRequiredLanguages: Portuguese marker → [pt]', () => {
  assert.deepEqual(detectRequiredLanguages('Portuguese speaker - LATAM'), ['pt']);
});

test('detectRequiredLanguages: accent support "español" → [es]', () => {
  assert.deepEqual(detectRequiredLanguages('Español native required'), ['es']);
});

test('detectRequiredLanguages: multi-language bilingual title', () => {
  const res = detectRequiredLanguages('Bilingual German/Spanish Analyst');
  assert.deepEqual(res.sort(), ['de', 'es']);
});

test('detectRequiredLanguages: no language marker → []', () => {
  assert.deepEqual(detectRequiredLanguages('Machine Learning Engineer'), []);
});

test('detectRequiredLanguages: country name without language marker does not match', () => {
  assert.deepEqual(detectRequiredLanguages('Argentinian Data Scientist'), []);
});

test('detectRequiredLanguages: empty / null input → []', () => {
  assert.deepEqual(detectRequiredLanguages(''), []);
  assert.deepEqual(detectRequiredLanguages(null), []);
  assert.deepEqual(detectRequiredLanguages(undefined), []);
});

test('detectRequiredLanguages: Japanese marker → [ja]', () => {
  assert.deepEqual(detectRequiredLanguages('Japanese speaking Sales Engineer'), ['ja']);
});
```

- [ ] **Step 2: Run and verify fail**

Run: `node --test tests/lib/language-detect.test.mjs`
Expected: FAIL — `detectRequiredLanguages` is not exported.

- [ ] **Step 3: Implement detectRequiredLanguages**

Append to `src/lib/language-detect.mjs`:

```js
// Regex per ISO-639-1 code. English and French are excluded — treated as
// baseline for the scanner's target audience.
// Patterns must match language markers (Spanish speaker, Deutschsprachig)
// but NOT unrelated uses of the country name (Argentinian Data Scientist
// does not match `es`).
const LANG_PATTERNS = {
  es: /\b(spanish|espagnol|español|castellano|hispanohablante)(?:[-\s]*(?:speaker|speaking|native|fluent|required))?\b/i,
  de: /\b(german|allemand|deutsch|deutschsprachig)(?:[-\s]*(?:speaker|speaking|native|fluent|required))?\b/i,
  it: /\b(italian|italien|italiano|italophone)(?:[-\s]*(?:speaker|speaking|native|fluent|required))?\b/i,
  nl: /\b(dutch|flemish|néerlandais|neerlandais|nederlands|nederlandstalig)(?:[-\s]*(?:speaker|speaking|native|fluent|required))?\b/i,
  pt: /\b(portuguese|portugais|português|portugues)(?:[-\s]*(?:speaker|speaking|native|fluent|required))?\b/i,
  ja: /\b(japanese|japonais)(?:[-\s]*(?:speaker|speaking|native|fluent|required))?\b/i,
  zh: /\b(chinese|mandarin|chinois)(?:[-\s]*(?:speaker|speaking|native|fluent|required))?\b/i,
  ar: /\b(arabic|arabe)(?:[-\s]*(?:speaker|speaking|native|fluent|required))?\b/i,
};

export function detectRequiredLanguages(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const hits = [];
  for (const [code, re] of Object.entries(LANG_PATTERNS)) {
    if (re.test(text)) hits.push(code);
  }
  return hits;
}
```

- [ ] **Step 4: Run and verify all pass**

Run: `node --test tests/lib/language-detect.test.mjs`
Expected: PASS (15 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/language-detect.mjs tests/lib/language-detect.test.mjs
git commit -m "feat(scan): detect required languages from offer title"
```

---

### Task 3: checkLanguages prefilter rule

**Files:**
- Modify: `src/lib/prefilter-rules.mjs`
- Modify: `tests/lib/prefilter-rules.test.mjs`

- [ ] **Step 1: Write failing tests for checkLanguages**

Append to `tests/lib/prefilter-rules.test.mjs`:

```js
import { checkLanguages } from '../../src/lib/prefilter-rules.mjs';

// ---------- checkLanguages ----------
test('checkLanguages: pass when candidate has required language at C1', () => {
  const offer = { title: 'Data Scientist - Spanish speaker' };
  const profileLangs = [
    { code: 'fr', level: 'native' },
    { code: 'en', level: 'C1' },
    { code: 'es', level: 'C1' },
  ];
  assert.deepEqual(checkLanguages(offer, profileLangs), { pass: true });
});

test('checkLanguages: reject when candidate has language below B2', () => {
  const offer = { title: 'Data Scientist - Spanish speaker' };
  const profileLangs = [
    { code: 'en', level: 'C1' },
    { code: 'es', level: 'A2' },
  ];
  const r = checkLanguages(offer, profileLangs);
  assert.equal(r.pass, false);
  assert.match(r.reason, /language: requires es/);
  assert.match(r.reason, /A2/);
});

test('checkLanguages: reject when candidate lacks language entirely', () => {
  const offer = { title: 'Deutschsprachig Analyst' };
  const profileLangs = [{ code: 'en', level: 'C1' }];
  const r = checkLanguages(offer, profileLangs);
  assert.equal(r.pass, false);
  assert.match(r.reason, /language: requires de/);
  assert.match(r.reason, /none/);
});

test('checkLanguages: multi-language title needs ALL at B2+', () => {
  const offer = { title: 'Bilingual German/Spanish Analyst' };
  const profileLangs = [
    { code: 'en', level: 'C1' },
    { code: 'de', level: 'B2' },
  ];
  const r = checkLanguages(offer, profileLangs);
  assert.equal(r.pass, false);
  assert.match(r.reason, /es/);
});

test('checkLanguages: pass when no language marker in title', () => {
  const offer = { title: 'Machine Learning Engineer' };
  const profileLangs = [{ code: 'en', level: 'C1' }];
  assert.deepEqual(checkLanguages(offer, profileLangs), { pass: true });
});

test('checkLanguages: pass when profileLanguages undefined', () => {
  const offer = { title: 'Spanish speaker Sales' };
  assert.deepEqual(checkLanguages(offer, undefined), { pass: true });
});

test('checkLanguages: pass when profileLanguages empty array', () => {
  const offer = { title: 'Machine Learning Engineer' };
  assert.deepEqual(checkLanguages(offer, []), { pass: true });
});

test('checkLanguages: B2 candidate level passes threshold', () => {
  const offer = { title: 'Spanish speaker Analyst' };
  const profileLangs = [{ code: 'es', level: 'B2' }];
  assert.deepEqual(checkLanguages(offer, profileLangs), { pass: true });
});
```

- [ ] **Step 2: Run and verify fail**

Run: `node --test tests/lib/prefilter-rules.test.mjs`
Expected: FAIL — `checkLanguages` not exported.

- [ ] **Step 3: Implement checkLanguages**

Add after `checkBlacklist` in `src/lib/prefilter-rules.mjs`:

```js
import {
  detectRequiredLanguages,
  levelRank,
  MIN_LANGUAGE_LEVEL,
} from './language-detect.mjs';

export function checkLanguages(offer, profileLanguages) {
  if (!Array.isArray(profileLanguages) || profileLanguages.length === 0) {
    return { pass: true };
  }
  const required = detectRequiredLanguages(offer.title || '');
  if (required.length === 0) return { pass: true };
  const minRank = levelRank(MIN_LANGUAGE_LEVEL);
  const byCode = new Map(profileLanguages.map((l) => [l.code, l.level]));
  for (const code of required) {
    const have = byCode.get(code);
    if (!have || levelRank(have) < minRank) {
      return {
        pass: false,
        reason: `language: requires ${code} (have ${have ?? 'none'})`,
      };
    }
  }
  return { pass: true };
}
```

- [ ] **Step 4: Run and verify pass**

Run: `node --test tests/lib/prefilter-rules.test.mjs`
Expected: PASS (all existing + 8 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefilter-rules.mjs tests/lib/prefilter-rules.test.mjs
git commit -m "feat(scan): add checkLanguages prefilter rule"
```

---

### Task 4: checkTitle accepts optional body for required_any

**Files:**
- Modify: `src/lib/prefilter-rules.mjs`
- Modify: `tests/lib/prefilter-rules.test.mjs`

- [ ] **Step 1: Write failing tests**

Append to `tests/lib/prefilter-rules.test.mjs`:

```js
// ---------- checkTitle with body (required_any soft match) ----------
const wlReq = {
  positive: ['Research', 'Scientist', 'Intern'],
  negative: ['Senior'],
  required_any: ['AI', 'ML', 'Machine Learning'],
};

test('checkTitle: required_any misses title but matches body', () => {
  const offer = {
    title: 'Research Scientist Intern',
    body: 'You will work on Machine Learning research.',
  };
  const r = checkTitle(offer, wlReq, { body: offer.body });
  assert.deepEqual(r, { pass: true });
});

test('checkTitle: required_any misses both title and body → reject', () => {
  const offer = {
    title: 'Research Scientist Intern',
    body: 'You will work on distributed systems.',
  };
  const r = checkTitle(offer, wlReq, { body: offer.body });
  assert.equal(r.pass, false);
  assert.match(r.reason, /title.*required_any/);
});

test('checkTitle: body does NOT rescue negative match', () => {
  const offer = {
    title: 'Senior ML Researcher',
    body: 'ML, AI, Research, Intern',
  };
  const r = checkTitle(offer, wlReq, { body: offer.body });
  assert.equal(r.pass, false);
  assert.match(r.reason, /negative/);
});

test('checkTitle: body does NOT rescue missing positive match', () => {
  const offer = {
    title: 'Designer UX',
    body: 'We love Research and Science here.',
  };
  const r = checkTitle(offer, wlReq, { body: offer.body });
  assert.equal(r.pass, false);
  assert.match(r.reason, /no positive/);
});

test('checkTitle: no body arg behaves like before (title-only required_any)', () => {
  const offer = { title: 'Research Scientist Intern' };
  const r = checkTitle(offer, wlReq);
  assert.equal(r.pass, false);
  assert.match(r.reason, /required_any/);
});
```

- [ ] **Step 2: Run and verify fail**

Run: `node --test tests/lib/prefilter-rules.test.mjs`
Expected: FAIL — `checkTitle` signature doesn't handle body.

- [ ] **Step 3: Modify checkTitle to accept opts.body**

Replace `checkTitle` in `src/lib/prefilter-rules.mjs` with:

```js
export function checkTitle(offer, whitelist, opts = {}) {
  const title = offer.title || '';
  const body = opts.body || '';
  try {
    const neg = findMatch(whitelist.negative, title);
    if (neg) return { pass: false, reason: `title: negative match "${neg}"` };
    const pos = findMatch(whitelist.positive, title);
    if (!pos) return { pass: false, reason: 'title: no positive match' };
    if (Array.isArray(whitelist.required_any) && whitelist.required_any.length > 0) {
      const haystack = body ? `${title}\n${body}` : title;
      const req = findMatch(whitelist.required_any, haystack);
      if (!req) {
        return {
          pass: false,
          reason: body
            ? 'title: missing required_any (title+description)'
            : 'title: missing required_any keyword',
        };
      }
    }
    return { pass: true };
  } catch (err) {
    if (err.code === 'INVALID_TITLE_FILTER_TERM') {
      return { pass: false, reason: `title: ${err.message}` };
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run and verify pass**

Run: `node --test tests/lib/prefilter-rules.test.mjs`
Expected: PASS (all existing + 5 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefilter-rules.mjs tests/lib/prefilter-rules.test.mjs
git commit -m "feat(scan): checkTitle accepts optional body for required_any soft match"
```

---

### Task 5: runPrefilter becomes async with fetchBody short-circuit

**Files:**
- Modify: `src/lib/prefilter-rules.mjs`
- Modify: `tests/lib/prefilter-rules.test.mjs`

- [ ] **Step 1: Write failing tests for async short-circuit**

Append to `tests/lib/prefilter-rules.test.mjs`:

```js
// ---------- runPrefilter async + soft-match short-circuit ----------
test('runPrefilter: returns promise (async)', () => {
  const offer = {
    title: 'ML Engineer Intern',
    body: 'Paris office, starting September 2026',
    company: 'Mistral',
    location: 'Paris, France',
  };
  const config = {
    minStartDate: '2026-08-24',
    blacklist: [],
    whitelist: wl,
    targetLocations: ['France', 'Paris', 'Remote'],
  };
  const result = runPrefilter(offer, config);
  assert.ok(result instanceof Promise, 'expected runPrefilter to return a Promise');
  return result.then((r) => assert.deepEqual(r, { pass: true }));
});

test('runPrefilter: soft-match fetches body when required_any missing in title', async () => {
  let fetchBodyCalled = 0;
  const offer = {
    title: 'Research Scientist Intern',
    company: 'Mistral',
    location: 'Paris, France',
    body: '',
  };
  const config = {
    minStartDate: '2026-08-24',
    blacklist: [],
    whitelist: {
      positive: ['Research', 'Scientist', 'Intern'],
      negative: [],
      required_any: ['AI', 'ML'],
      required_any_in: ['title', 'description'],
    },
    targetLocations: ['France', 'Paris', 'Remote'],
    fetchBody: async () => {
      fetchBodyCalled++;
      return 'We build Machine Learning systems (ML at scale).';
    },
  };
  const r = await runPrefilter(offer, config);
  assert.deepEqual(r, { pass: true });
  assert.equal(fetchBodyCalled, 1);
});

test('runPrefilter: soft-match reject when body lacks keyword too', async () => {
  const offer = {
    title: 'Research Scientist Intern',
    company: 'Mistral',
    location: 'Paris, France',
    body: '',
  };
  const config = {
    minStartDate: '2026-08-24',
    blacklist: [],
    whitelist: {
      positive: ['Research', 'Scientist', 'Intern'],
      negative: [],
      required_any: ['AI', 'ML'],
      required_any_in: ['title', 'description'],
    },
    targetLocations: ['France', 'Paris', 'Remote'],
    fetchBody: async () => 'We build distributed systems only.',
  };
  const r = await runPrefilter(offer, config);
  assert.equal(r.pass, false);
  assert.match(r.reason, /title.*required_any.*title\+description/);
});

test('runPrefilter: no fetchBody call when required_any_in is [title]', async () => {
  let fetchBodyCalled = 0;
  const offer = {
    title: 'Research Scientist Intern',
    company: 'Mistral',
    location: 'Paris, France',
    body: '',
  };
  const config = {
    minStartDate: '2026-08-24',
    blacklist: [],
    whitelist: {
      positive: ['Research', 'Scientist', 'Intern'],
      negative: [],
      required_any: ['AI', 'ML'],
      required_any_in: ['title'],
    },
    targetLocations: ['France', 'Paris', 'Remote'],
    fetchBody: async () => {
      fetchBodyCalled++;
      return 'ML everywhere';
    },
  };
  const r = await runPrefilter(offer, config);
  assert.equal(r.pass, false);
  assert.equal(fetchBodyCalled, 0);
});

test('runPrefilter: no fetchBody call when title passes required_any', async () => {
  let fetchBodyCalled = 0;
  const offer = {
    title: 'ML Engineer Intern',
    company: 'Mistral',
    location: 'Paris, France',
    body: '',
  };
  const config = {
    minStartDate: '2026-08-24',
    blacklist: [],
    whitelist: {
      positive: ['ML', 'Intern'],
      negative: [],
      required_any: ['ML', 'AI'],
      required_any_in: ['title', 'description'],
    },
    targetLocations: ['France', 'Paris', 'Remote'],
    fetchBody: async () => {
      fetchBodyCalled++;
      return '';
    },
  };
  const r = await runPrefilter(offer, config);
  assert.deepEqual(r, { pass: true });
  assert.equal(fetchBodyCalled, 0);
});

test('runPrefilter: fetchBody returns null → reject with soft-match reason', async () => {
  const offer = {
    title: 'Research Scientist Intern',
    company: 'Mistral',
    location: 'Paris, France',
    body: '',
  };
  const config = {
    minStartDate: '2026-08-24',
    blacklist: [],
    whitelist: {
      positive: ['Research', 'Scientist', 'Intern'],
      negative: [],
      required_any: ['AI', 'ML'],
      required_any_in: ['title', 'description'],
    },
    targetLocations: ['France', 'Paris', 'Remote'],
    fetchBody: async () => null,
  };
  const r = await runPrefilter(offer, config);
  assert.equal(r.pass, false);
  assert.match(r.reason, /title.*required_any.*title\+description/);
});

test('runPrefilter: includes language check in chain', async () => {
  const offer = {
    title: 'ML Engineer Intern - Spanish speaker',
    company: 'Mistral',
    location: 'Paris, France',
    body: 'Paris',
  };
  const config = {
    minStartDate: '2026-08-24',
    blacklist: [],
    whitelist: wl,
    targetLocations: ['France', 'Paris', 'Remote'],
    profileLanguages: [
      { code: 'fr', level: 'native' },
      { code: 'en', level: 'C1' },
      { code: 'es', level: 'A2' },
    ],
  };
  const r = await runPrefilter(offer, config);
  assert.equal(r.pass, false);
  assert.match(r.reason, /language.*es/);
});
```

Also update the two existing sync `runPrefilter` tests (lines ~173-199 of the file) to `await` the result:

```js
test('runPrefilter: court-circuit sur la première règle qui échoue', async () => {
  const offer = { title: 'Senior Dev', body: 'Paris', company: 'Foo', location: '' };
  const config = {
    minStartDate: '2026-08-24',
    blacklist: [],
    whitelist: wl,
    targetLocations: ['France', 'Paris', 'Remote'],
  };
  const r = await runPrefilter(offer, config);
  assert.equal(r.pass, false);
  assert.match(r.reason, /negative|title/);
});

test('runPrefilter: pass offre valide', async () => {
  const offer = {
    title: 'ML Engineer Intern',
    body: 'Paris office, starting September 2026',
    company: 'Mistral',
    location: 'Paris, France',
  };
  const config = {
    minStartDate: '2026-08-24',
    blacklist: [],
    whitelist: wl,
    targetLocations: ['France', 'Paris', 'Remote'],
  };
  assert.deepEqual(await runPrefilter(offer, config), { pass: true });
});
```

- [ ] **Step 2: Run and verify fail**

Run: `node --test tests/lib/prefilter-rules.test.mjs`
Expected: FAIL — `runPrefilter` still sync.

- [ ] **Step 3: Implement async runPrefilter**

Replace `runPrefilter` in `src/lib/prefilter-rules.mjs` with:

```js
export async function runPrefilter(offer, config) {
  const whitelist = config.whitelist || { positive: [], negative: [] };
  const wantsSoftMatch =
    Array.isArray(whitelist.required_any_in) &&
    whitelist.required_any_in.includes('description') &&
    typeof config.fetchBody === 'function';

  let titleResult = checkTitle(offer, whitelist);
  if (
    !titleResult.pass &&
    titleResult.reason === 'title: missing required_any keyword' &&
    wantsSoftMatch
  ) {
    const body = await config.fetchBody(offer);
    if (body && body.length > 0) {
      titleResult = checkTitle(offer, whitelist, { body });
    } else {
      titleResult = {
        pass: false,
        reason: 'title: missing required_any (title+description)',
      };
    }
  }
  if (!titleResult.pass) return titleResult;

  const blacklistResult = checkBlacklist(offer, config.blacklist);
  if (!blacklistResult.pass) return blacklistResult;

  const langResult = checkLanguages(offer, config.profileLanguages);
  if (!langResult.pass) return langResult;

  const locResult = checkLocation(offer, config.targetLocations);
  if (!locResult.pass) return locResult;

  const dateResult = checkStartDate(offer, config.minStartDate);
  if (!dateResult.pass) return dateResult;

  return { pass: true };
}
```

- [ ] **Step 4: Run and verify pass**

Run: `node --test tests/lib/prefilter-rules.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prefilter-rules.mjs tests/lib/prefilter-rules.test.mjs
git commit -m "feat(scan): runPrefilter becomes async with soft-match short-circuit"
```

---

### Task 6: fetchOfferBody platform dispatcher

**Files:**
- Create: `src/scan/fetch-offer-body.mjs`
- Test: `tests/scan/fetch-offer-body.test.mjs`

- [ ] **Step 1: Write failing tests**

```js
// tests/scan/fetch-offer-body.test.mjs
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchOfferBody, _resetWarnings } from '../../src/scan/fetch-offer-body.mjs';

beforeEach(() => _resetWarnings());

test('fetchOfferBody: lever with body → returns body', async () => {
  const res = await fetchOfferBody({
    platform: 'lever',
    body: 'Join our team to build ML.',
    url: 'https://jobs.lever.co/mistral/abc',
  });
  assert.equal(res, 'Join our team to build ML.');
});

test('fetchOfferBody: greenhouse with body → returns body', async () => {
  const res = await fetchOfferBody({
    platform: 'greenhouse',
    body: 'We are hiring.',
    url: 'https://example.com',
  });
  assert.equal(res, 'We are hiring.');
});

test('fetchOfferBody: ashby with body → returns body', async () => {
  const res = await fetchOfferBody({
    platform: 'ashby',
    body: 'We build LLMs.',
    url: 'https://jobs.ashbyhq.com/foo/abc',
  });
  assert.equal(res, 'We build LLMs.');
});

test('fetchOfferBody: empty body → returns null', async () => {
  const res = await fetchOfferBody({
    platform: 'lever',
    body: '',
    url: 'https://jobs.lever.co/mistral/abc',
  });
  assert.equal(res, null);
});

test('fetchOfferBody: missing body field → returns null', async () => {
  const res = await fetchOfferBody({
    platform: 'greenhouse',
    url: 'https://example.com',
  });
  assert.equal(res, null);
});

test('fetchOfferBody: workday → returns null (limitation)', async () => {
  const res = await fetchOfferBody({
    platform: 'workday',
    body: '',
    url: 'https://foo.wd1.myworkdayjobs.com/en-US/site/job/abc',
  });
  assert.equal(res, null);
});

test('fetchOfferBody: unknown platform → returns null', async () => {
  const res = await fetchOfferBody({
    platform: 'custom',
    body: 'text',
    url: 'https://example.com',
  });
  assert.equal(res, null);
});
```

- [ ] **Step 2: Run and verify fail**

Run: `node --test tests/scan/fetch-offer-body.test.mjs`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement fetchOfferBody**

```js
// src/scan/fetch-offer-body.mjs
//
// Platform-aware dispatcher returning the offer description when available.
// Lever / Greenhouse / Ashby already populate offer.body in the listing.
// Workday's listing returns titles only; detail-fetch via a second POST per
// offer is out of scope for v1 — returns null with a one-shot warning.

const PLATFORMS_WITH_BODY = new Set(['lever', 'greenhouse', 'ashby']);

let warnedWorkday = false;

export function _resetWarnings() {
  warnedWorkday = false;
}

export async function fetchOfferBody(offer) {
  if (!offer || typeof offer !== 'object') return null;
  const platform = offer.platform;
  if (PLATFORMS_WITH_BODY.has(platform)) {
    const body = typeof offer.body === 'string' ? offer.body.trim() : '';
    return body.length > 0 ? body : null;
  }
  if (platform === 'workday') {
    if (!warnedWorkday) {
      process.stderr.write(
        '[fetchOfferBody] Workday detail-fetch not implemented; soft-match disabled for Workday offers\n'
      );
      warnedWorkday = true;
    }
    return null;
  }
  return null;
}
```

- [ ] **Step 4: Run and verify pass**

Run: `node --test tests/scan/fetch-offer-body.test.mjs`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/scan/fetch-offer-body.mjs tests/scan/fetch-offer-body.test.mjs
git commit -m "feat(scan): add fetchOfferBody platform dispatcher"
```

---

### Task 7: Integrate into runScan + summary

**Files:**
- Modify: `src/scan/index.mjs`
- Modify: `tests/scan/scan.test.mjs`

- [ ] **Step 1: Write failing integration test**

Append this test to `tests/scan/scan.test.mjs`. It follows the existing pattern: `installMockFetch` stubs the Lever API, `runScan` runs against a tmp directory.

```js
test('runScan — offer requiring Spanish rejected when candidate has only A2', async () => {
  const portalsConfig = {
    title_filter: { positive: ['Engineer', 'Intern'], negative: [] },
    tracked_companies: [
      { name: 'TestCo', careers_url: 'https://jobs.lever.co/testco', enabled: true },
    ],
  };
  const profile = {
    min_start_date: '2026-08-24',
    target_locations: ['France', 'Paris', 'Remote'],
    languages: [
      { code: 'fr', level: 'native' },
      { code: 'en', level: 'C1' },
      { code: 'es', level: 'A2' },
    ],
  };

  const leverJson = [
    {
      hostedUrl: 'https://jobs.lever.co/testco/job1',
      text: 'ML Engineer Intern - Spanish speaker',
      categories: { location: 'Paris' },
      descriptionPlain: 'Paris France, starting September 2026',
    },
    {
      hostedUrl: 'https://jobs.lever.co/testco/job2',
      text: 'ML Engineer Intern',
      categories: { location: 'Paris' },
      descriptionPlain: 'Paris France, starting September 2026',
    },
  ];

  const restore = installMockFetch({
    'https://api.lever.co/v0/postings/testco?mode=json': leverJson,
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

  assert.equal(result.filtered.skipped_language, 1);
  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].title, 'ML Engineer Intern');

  const summary = formatSummary(result, false);
  assert.match(summary, /Langue\s+1/);
});
```

Also add a summary-zero test to keep the new line visible even when no language reject occurs:

```js
test('formatSummary: includes Langue line even when zero', () => {
  const result = {
    scanned: 1,
    eligibleTotal: 1,
    raw: 0,
    perCompany: [],
    filtered: {
      skipped_dup: 0,
      skipped_title: 0,
      skipped_blacklist: 0,
      skipped_location: 0,
      skipped_date: 0,
      skipped_language: 0,
      skipped_other: 0,
    },
    added: [],
    errors: [],
    historyWrites: 0,
    filteredWrites: 0,
  };
  const summary = formatSummary(result, false);
  assert.match(summary, /Langue\s+0/);
});
```

- [ ] **Step 2: Run and verify fail**

Run: `node --test tests/scan/scan.test.mjs`
Expected: FAIL — `skipped_language` undefined, summary does not include `Langue`.

- [ ] **Step 3: Modify `src/scan/index.mjs`**

In `reasonToStatus`, add before `return 'skipped_other'`:

```js
  if (reason.startsWith('language:')) return 'skipped_language';
```

In `runScan`, locate the `filtered` initializer and add `skipped_language: 0`:

```js
const filtered = {
  skipped_dup: 0,
  skipped_title: 0,
  skipped_blacklist: 0,
  skipped_location: 0,
  skipped_date: 0,
  skipped_language: 0,
  skipped_other: 0,
};
```

Add an import at the top:

```js
import { fetchOfferBody } from './fetch-offer-body.mjs';
```

In `runScan`, extend `prefilterConfig` with `profileLanguages` and `fetchBody`:

```js
const prefilterConfig = {
  whitelist,
  blacklist: profile.blacklist_companies || [],
  minStartDate: profile.min_start_date || '2026-08-24',
  targetLocations,
  profileLanguages: profile.languages || [],
  fetchBody: fetchOfferBody,
};
```

Change the per-offer prefilter call from sync to async (around line 197). Wrap the existing try/catch so the `await` is inside the try:

```js
let check;
try {
  check = await runPrefilter(offer, effectiveConfig);
} catch (err) {
  // existing catch block unchanged
}
```

In `formatSummary`, add the `Langue` line alongside the existing filter stats:

```js
lines.push('Filtrage :');
lines.push(`  • Déjà vues       ${result.filtered.skipped_dup}`);
lines.push(`  • Titre rejeté    ${result.filtered.skipped_title}`);
lines.push(`  • Blacklist       ${result.filtered.skipped_blacklist}`);
lines.push(`  • Langue          ${result.filtered.skipped_language ?? 0}`);
lines.push(`  • Localisation    ${result.filtered.skipped_location}`);
lines.push(`  • Date            ${result.filtered.skipped_date}`);
```

- [ ] **Step 4: Run and verify pass**

Run: `node --test tests/scan/scan.test.mjs`
Expected: PASS.

- [ ] **Step 5: Run full suite to check no regression**

Run: `npm test 2>&1 | tail -10`
Expected: all tests pass, no new failures.

- [ ] **Step 6: Commit**

```bash
git add src/scan/index.mjs tests/scan/scan.test.mjs
git commit -m "feat(scan): integrate language filter and soft-match into runScan"
```

---

### Task 8: Document required_any_in in portals.example.yml

**Files:**
- Modify: `templates/portals.example.yml`

- [ ] **Step 1: Add documentation under `required_any`**

Locate the `required_any` comment block (around line 52) in `templates/portals.example.yml` and append:

```yaml
  required_any: []

  # When `required_any` is set, also match against the offer description
  # if the title alone doesn't contain one of the keywords. Default: [title].
  # Setting [title, description] catches titles like "Research Scientist Intern"
  # whose body mentions "Machine Learning" or "AI" but whose title does not.
  # Only required_any is soft-matched — positive and negative remain title-only.
  # Note: Workday descriptions are not fetched in v1 (soft match disabled there).
  required_any_in: [title]
```

- [ ] **Step 2: Run PII gate to ensure docs commit is clean**

Run: `npm run check:pii`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add templates/portals.example.yml
git commit -m "docs(scan): document required_any_in in portals template"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test 2>&1 | tail -10`
Expected: all tests pass (baseline was 486 pass; expect at least 486 + ~25 new).

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Run PII gate**

Run: `npm run check:pii`
Expected: PASS.

- [ ] **Step 4: Dry-run scan (needs user config, skip if unavailable)**

Run (only if `config/portals.yml` exists locally): `npm run scan -- --dry-run 2>&1 | tail -20`
Expected: summary includes new `Langue` line.

- [ ] **Step 5: Optional PR prep**

Review `git log --oneline main..HEAD` and confirm 8 focused commits (one per task 1-8).

Request code review via `superpowers:requesting-code-review` skill or open PR targeting `main`.
