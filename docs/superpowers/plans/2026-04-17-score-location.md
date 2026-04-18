# Issue #66 — Location Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate `location` reliably in `data/evaluations.jsonl` by extracting from ld+json, meta/og, CSS and body-text patterns — with `null` when no signal is found.

**Architecture:** Add one pure-function module `src/score/location-extractor.mjs` with a 4-strategy cascade. Wire it into `fetchOfferBody`/`buildOffer` by capturing extra DOM signals in the existing Playwright `page.evaluate()` and using the extracted value as a fallback for all source paths. Switch the final record to `null` (not `""`) when extraction fails.

**Tech Stack:** Node 20+ ESM, `node:test`, `node:assert/strict`, Playwright (existing), no new deps.

---

## File structure

- Create: `src/score/location-extractor.mjs` — pure fn `extractLocation(signals) → { location, source }`
- Create: `tests/score/location-extractor.test.mjs` — unit tests (no Playwright)
- Modify: `src/score/index.mjs` — `fetchOfferBody` (line ~56–76), `buildOffer` (line ~80–105), record assembly in `main()` (line ~418 batch, ~551 single)
- Modify: `docs/score-workflow.md` — one-line note about `null` semantics
- Potentially modify: `tests/score/metadata-source.test.mjs`, `tests/score/score-batch.test.mjs` — if any assert `location === ''`

---

## Task 1: Create `location-extractor.mjs` with full cascade (TDD)

**Files:**
- Create: `src/score/location-extractor.mjs`
- Test: `tests/score/location-extractor.test.mjs`

This task builds the entire cascade incrementally via TDD. Each strategy gets red → green → commit.

### Task 1.1 — Scaffold module + first ld+json test

- [ ] **Step 1: Write failing test for ld+json addressLocality**

Create `tests/score/location-extractor.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLocation } from '../../src/score/location-extractor.mjs';

// ---------- ld+json ----------
test('extractLocation: ld+json jobLocation.address.addressLocality', () => {
  const ldJsonRaw = JSON.stringify({
    '@type': 'JobPosting',
    jobLocation: { address: { addressLocality: 'Paris' } },
  });
  const r = extractLocation({ ldJsonRaw, ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: 'Paris', source: 'jsonld' });
});
```

- [ ] **Step 2: Run test — expect FAIL (module missing)**

Run: `node --test tests/score/location-extractor.test.mjs`
Expected: FAIL — `Cannot find module '.../src/score/location-extractor.mjs'`

- [ ] **Step 3: Create minimal module**

Create `src/score/location-extractor.mjs`:

```js
export function extractLocation(signals) {
  const { ldJsonRaw } = signals;
  const fromJsonLd = tryJsonLd(ldJsonRaw);
  if (fromJsonLd) return { location: fromJsonLd, source: 'jsonld' };
  return { location: null, source: null };
}

function tryJsonLd(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const blocks = raw.split('\n---\n');
  for (const block of blocks) {
    const obj = safeParse(block);
    if (!obj) continue;
    const loc = pickLocalityFromJobPosting(obj);
    if (loc) return loc;
  }
  return null;
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function pickLocalityFromJobPosting(obj) {
  const jobLoc = obj?.jobLocation;
  const locs = Array.isArray(jobLoc) ? jobLoc : [jobLoc];
  for (const jl of locs) {
    const addr = jl?.address;
    if (!addr) continue;
    const v = trimOrNull(addr.addressLocality) || trimOrNull(addr.addressRegion);
    if (v) return v;
  }
  return null;
}

function trimOrNull(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `node --test tests/score/location-extractor.test.mjs`
Expected: PASS (1/1)

- [ ] **Step 5: Commit**

```bash
git add src/score/location-extractor.mjs tests/score/location-extractor.test.mjs
git commit -m "feat(score): add location-extractor with ld+json strategy"
```

### Task 1.2 — ld+json array + region fallback + malformed

- [ ] **Step 1: Add 3 failing tests to the same test file**

Append to `tests/score/location-extractor.test.mjs`:

```js
test('extractLocation: ld+json array jobLocation picks first', () => {
  const ldJsonRaw = JSON.stringify({
    '@type': 'JobPosting',
    jobLocation: [
      { address: { addressLocality: 'Lyon' } },
      { address: { addressLocality: 'Nantes' } },
    ],
  });
  const r = extractLocation({ ldJsonRaw, ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: 'Lyon', source: 'jsonld' });
});

test('extractLocation: ld+json falls back to addressRegion', () => {
  const ldJsonRaw = JSON.stringify({
    '@type': 'JobPosting',
    jobLocation: { address: { addressRegion: 'Île-de-France' } },
  });
  const r = extractLocation({ ldJsonRaw, ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: 'Île-de-France', source: 'jsonld' });
});

test('extractLocation: malformed ld+json block is skipped', () => {
  const ldJsonRaw = 'not-json\n---\n' + JSON.stringify({
    '@type': 'JobPosting',
    jobLocation: { address: { addressLocality: 'Berlin' } },
  });
  const r = extractLocation({ ldJsonRaw, ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: 'Berlin', source: 'jsonld' });
});
```

- [ ] **Step 2: Run — expect all PASS (current impl already handles these)**

Run: `node --test tests/score/location-extractor.test.mjs`
Expected: PASS (4/4) — the current implementation already covers arrays, addressRegion fallback, and malformed-block skipping.

- [ ] **Step 3: Commit the additional tests**

```bash
git add tests/score/location-extractor.test.mjs
git commit -m "test(score): cover ld+json array, region fallback, malformed blocks"
```

### Task 1.3 — Add meta/og strategy

- [ ] **Step 1: Add failing test**

Append:

```js
// ---------- meta / og ----------
test('extractLocation: og:location when ld+json absent', () => {
  const r = extractLocation({
    ldJsonRaw: '',
    ogLocation: 'Paris',
    cssLocation: '',
    bodyText: '',
  });
  assert.deepEqual(r, { location: 'Paris', source: 'meta' });
});

test('extractLocation: malformed ld+json + valid ogLocation falls through', () => {
  const r = extractLocation({
    ldJsonRaw: 'not-json',
    ogLocation: 'Lyon',
    cssLocation: '',
    bodyText: '',
  });
  assert.deepEqual(r, { location: 'Lyon', source: 'meta' });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `node --test tests/score/location-extractor.test.mjs`
Expected: 2 failures — meta strategy not implemented.

- [ ] **Step 3: Add meta strategy to `extractLocation`**

Edit `src/score/location-extractor.mjs` — replace body of `extractLocation`:

```js
export function extractLocation(signals) {
  const { ldJsonRaw, ogLocation } = signals;

  const fromJsonLd = tryJsonLd(ldJsonRaw);
  if (fromJsonLd) return { location: fromJsonLd, source: 'jsonld' };

  const fromMeta = trimOrNull(ogLocation);
  if (fromMeta) return { location: fromMeta, source: 'meta' };

  return { location: null, source: null };
}
```

- [ ] **Step 4: Run — expect PASS (6/6)**

Run: `node --test tests/score/location-extractor.test.mjs`
Expected: PASS (6/6)

- [ ] **Step 5: Commit**

```bash
git add src/score/location-extractor.mjs tests/score/location-extractor.test.mjs
git commit -m "feat(score): add meta/og location strategy"
```

### Task 1.4 — Add CSS/dom strategy

- [ ] **Step 1: Add failing tests**

Append:

```js
// ---------- dom ----------
test('extractLocation: cssLocation when higher strategies empty', () => {
  const r = extractLocation({
    ldJsonRaw: '',
    ogLocation: '',
    cssLocation: 'Berlin',
    bodyText: '',
  });
  assert.deepEqual(r, { location: 'Berlin', source: 'dom' });
});

test('extractLocation: cssLocation whitespace-only is treated as empty', () => {
  const r = extractLocation({
    ldJsonRaw: '',
    ogLocation: '',
    cssLocation: '   \n ',
    bodyText: '',
  });
  assert.deepEqual(r, { location: null, source: null });
});
```

- [ ] **Step 2: Run — expect FAIL**

Expected: 2 failures.

- [ ] **Step 3: Add dom strategy**

Edit `extractLocation` — insert before the final return:

```js
  const fromDom = trimOrNull(signals.cssLocation);
  if (fromDom) return { location: fromDom, source: 'dom' };
```

- [ ] **Step 4: Run — expect PASS (8/8)**

Expected: PASS (8/8)

- [ ] **Step 5: Commit**

```bash
git add src/score/location-extractor.mjs tests/score/location-extractor.test.mjs
git commit -m "feat(score): add dom (css) location strategy"
```

### Task 1.5 — Add regex/body strategy

- [ ] **Step 1: Add failing tests**

Append:

```js
// ---------- regex on body ----------
test('extractLocation: regex Location: Paris', () => {
  const r = extractLocation({
    ldJsonRaw: '',
    ogLocation: '',
    cssLocation: '',
    bodyText: 'Some intro\nLocation: Paris\nMore body',
  });
  assert.deepEqual(r, { location: 'Paris', source: 'regex' });
});

test('extractLocation: regex Lieu : Lyon (French)', () => {
  const r = extractLocation({
    ldJsonRaw: '',
    ogLocation: '',
    cssLocation: '',
    bodyText: 'Détails\nLieu : Lyon\nFin',
  });
  assert.deepEqual(r, { location: 'Lyon', source: 'regex' });
});

test('extractLocation: regex emoji 📍 Berlin', () => {
  const r = extractLocation({
    ldJsonRaw: '',
    ogLocation: '',
    cssLocation: '',
    bodyText: '📍 Berlin\n',
  });
  assert.deepEqual(r, { location: 'Berlin', source: 'regex' });
});

test('extractLocation: no signals returns null', () => {
  const r = extractLocation({ ldJsonRaw: '', ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: null, source: null });
});
```

- [ ] **Step 2: Run — expect 3 FAIL, 1 PASS**

The "no signals" case already passes; the 3 regex cases fail.

- [ ] **Step 3: Add regex strategy**

Edit `src/score/location-extractor.mjs` — add regex consts near top of file and a new helper:

```js
const LABEL_RE = /(?:Location|Lieu|Ville|Standort|Ubicación)\s*[:：]\s*([^\n]{2,80})/i;
const EMOJI_RE = /📍\s*([^\n]{2,80})/;

function tryRegex(bodyText) {
  if (!bodyText || typeof bodyText !== 'string') return null;
  for (const re of [LABEL_RE, EMOJI_RE]) {
    const m = bodyText.match(re);
    if (m) {
      const cleaned = m[1].trim().replace(/[.,;:]+$/, '').trim();
      if (cleaned.length > 0) return cleaned;
    }
  }
  return null;
}
```

Then in `extractLocation`, insert before the final return:

```js
  const fromRegex = tryRegex(signals.bodyText);
  if (fromRegex) return { location: fromRegex, source: 'regex' };
```

- [ ] **Step 4: Run — expect PASS (12/12)**

Run: `node --test tests/score/location-extractor.test.mjs`
Expected: PASS (12/12)

- [ ] **Step 5: Commit**

```bash
git add src/score/location-extractor.mjs tests/score/location-extractor.test.mjs
git commit -m "feat(score): add regex body-text location strategy"
```

---

## Task 2: Capture ld+json and og signals in `fetchOfferBody`

**Files:**
- Modify: `src/score/index.mjs` — `fetchOfferBody()` (lines ~56–76)

- [ ] **Step 1: Open `src/score/index.mjs` and locate `fetchOfferBody`**

Current `page.evaluate()` block captures `body`, `scrapedCompany`, `scrapedLocation`.

- [ ] **Step 2: Add two new signal captures inside `page.evaluate` calls**

Replace the three existing `await page.evaluate(...)` captures with a single consolidated one that adds `ldJsonRaw` and `ogLocation`:

```js
    const pageTitle = await page.title();
    const signals = await page.evaluate(() => {
      const body = document.body?.innerText || '';
      const scripts = Array.from(
        document.querySelectorAll('script[type="application/ld+json"]')
      );
      const ldJsonRaw = scripts.map((s) => s.innerHTML).join('\n---\n');
      const ogEl = document.querySelector(
        'meta[property="og:location"], meta[name="location"]'
      );
      const ogLocation = ogEl?.getAttribute('content') || '';
      const companyOg = document
        .querySelector('meta[property="og:site_name"]')
        ?.getAttribute('content');
      const scrapedCompany =
        companyOg || document.querySelector('h1')?.innerText || '';
      const cssEl = document.querySelector(
        '[class*="location" i], [data-testid*="location" i]'
      );
      const cssLocation = cssEl?.innerText || '';
      return { body, ldJsonRaw, ogLocation, scrapedCompany, cssLocation };
    });
    const { body, ldJsonRaw, ogLocation, scrapedCompany, cssLocation } = signals;
    return {
      finalUrl,
      status,
      body,
      scrapedTitle: pageTitle,
      scrapedCompany,
      scrapedLocation: cssLocation,
      ldJsonRaw,
      ogLocation,
      cssLocation,
    };
  } finally {
    await browser.close();
  }
}
```

Note: we keep `scrapedLocation` (backward-compat for any call sites) and add the three new fields.

- [ ] **Step 3: Run full test suite to confirm no regression**

Run: `npm test`
Expected: PASS (≥ 434 tests, same as baseline + 12 new location-extractor tests = 446)

- [ ] **Step 4: Commit**

```bash
git add src/score/index.mjs
git commit -m "feat(score): capture ld+json and og signals in fetchOfferBody"
```

---

## Task 3: Wire `extractLocation` into `buildOffer` with fallback logic

**Files:**
- Modify: `src/score/index.mjs` — `buildOffer()` (lines ~80–105) + batch path fetch (line ~373–380)

- [ ] **Step 1: Add import at top of `src/score/index.mjs`**

Near existing score-local imports:

```js
import { extractLocation } from './location-extractor.mjs';
```

- [ ] **Step 2: Rewrite `buildOffer` to compute extracted location and use as fallback**

Replace the current `buildOffer` function body with:

```js
async function buildOffer(url, overrides = {}) {
  const { company, title, location, source } = overrides;
  const fetched = await fetchOfferBody(url);
  const extracted = extractLocation({
    ldJsonRaw: fetched.ldJsonRaw,
    ogLocation: fetched.ogLocation,
    cssLocation: fetched.cssLocation,
    bodyText: fetched.body,
  });
  const overrideLocation = typeof location === 'string' ? location.trim() : '';
  const resolvedLocation =
    source === 'scrape'
      ? extracted.location
      : overrideLocation || extracted.location;
  return {
    url,
    finalUrl: fetched.finalUrl,
    status: fetched.status,
    body: fetched.body,
    title: source === 'scrape' ? fetched.scrapedTitle || '' : title ?? '',
    company: source === 'scrape' ? fetched.scrapedCompany || '' : company ?? '',
    location: resolvedLocation,
    metadata_source: source,
  };
}
```

- [ ] **Step 3: Apply the same extraction in the batch path**

Locate the batch inner task (around line 373–380 where `fullOffer` is built from `fetched`). Replace:

```js
          const fetched = await fetchOfferBody(offer.url);
          const fullOffer = {
            ...offer,
            finalUrl: fetched.finalUrl,
            status: fetched.status,
            body: fetched.body,
            metadata_source: 'pipeline',
          };
```

With:

```js
          const fetched = await fetchOfferBody(offer.url);
          const extracted = extractLocation({
            ldJsonRaw: fetched.ldJsonRaw,
            ogLocation: fetched.ogLocation,
            cssLocation: fetched.cssLocation,
            bodyText: fetched.body,
          });
          const pipelineLoc =
            typeof offer.location === 'string' ? offer.location.trim() : '';
          const fullOffer = {
            ...offer,
            finalUrl: fetched.finalUrl,
            status: fetched.status,
            body: fetched.body,
            location: pipelineLoc || extracted.location,
            metadata_source: 'pipeline',
          };
```

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: PASS. If any `tests/score/metadata-source.test.mjs` assertion fails on `location === ''`, fix in Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/score/index.mjs
git commit -m "feat(score): use extracted location as fallback in buildOffer and batch path"
```

---

## Task 4: Switch record assembly to `null` instead of `""`

**Files:**
- Modify: `src/score/index.mjs` — two `location: offer.location || ''` / `fullOffer.location || ''` sites

- [ ] **Step 1: Locate and replace both sites**

Find the batch record assembly (around line ~418):

```js
            location: fullOffer.location || '',
```

Replace with:

```js
            location: fullOffer.location ?? null,
```

Find the single-URL record assembly (around line ~551):

```js
    location: offer.location || '',
```

Replace with:

```js
    location: offer.location ?? null,
```

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: PASS — unless an existing test asserts `location === ''` on an offer with no location.

- [ ] **Step 3: If tests fail, audit and fix assertions**

Grep: `grep -rn "location.*''" tests/score/`

For any failing assertion that expects `''` for a genuinely-empty-location offer, update to `null`:
- `assert.equal(rec.location, '')` → `assert.equal(rec.location, null)`

If a test exercises a location that should now be extracted (e.g. fixture contains `"Location: Paris"` in body), decide whether to update the assertion to the extracted value or neutralise the fixture.

- [ ] **Step 4: Re-run tests until green**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/score/index.mjs tests/score/
git commit -m "fix(score): emit null (not empty string) when location is unknown"
```

---

## Task 5: Update docs + run lint/PII gate

**Files:**
- Modify: `docs/score-workflow.md`

- [ ] **Step 1: Add one-line note about `null` semantics**

Find the "Output line" section and add immediately after the JSON example:

```markdown
The `location` field is populated from `<script type="application/ld+json">`, OpenGraph/meta tags, CSS selectors, or a regex on the page body — in that order. When no signal is found, the value is `null` (distinct from the legacy `""` used by entries scored before this feature landed).
```

- [ ] **Step 2: Run lint + PII gate**

Run: `npm run lint && npm run check:pii`
Expected: both PASS.

- [ ] **Step 3: Run full test suite one last time**

Run: `npm test`
Expected: PASS (full suite, no regressions).

- [ ] **Step 4: Commit**

```bash
git add docs/score-workflow.md
git commit -m "docs(score): document location extraction and null semantics"
```

---

## Task 6: Push branch and open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin fix/issue-66-score-location
```

- [ ] **Step 2: Open PR**

```bash
gh pr create --title "fix(score): extract location into evaluations.jsonl (#66)" --body "$(cat <<'EOF'
## Summary
- Add `src/score/location-extractor.mjs` with a 4-strategy cascade: ld+json → og/meta → CSS → regex on body
- Capture raw ld+json and og:location signals in `fetchOfferBody`'s Playwright page.evaluate
- Use extracted location as a fallback for `pipeline`/`flags` sources when caller metadata is empty
- Emit `null` (not `""`) when no signal is found, so legacy empty entries stay distinguishable

Fixes #66.

## Test plan
- [ ] `node --test tests/score/location-extractor.test.mjs` — 12 unit tests pass
- [ ] `npm test` — full suite green
- [ ] Manual smoke: `node src/score/index.mjs <lever/greenhouse URL>` — evaluations.jsonl shows populated `location`
- [ ] Manual smoke: score a page with no location signal — evaluations.jsonl shows `"location": null`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Confirm CI is green**

Monitor `gh pr checks` until all green.

---

## Verification checklist (end-to-end)

1. `node --test tests/score/location-extractor.test.mjs` → 12/12 PASS
2. `npm test` → full suite green
3. `npm run lint` → PASS
4. `npm run check:pii` → PASS
5. Manual: score a Lever/Greenhouse URL → `"location": "<real city>"` in `data/evaluations.jsonl`
6. Manual: score a SPA with no location signal → `"location": null`
7. PR open, CI green, linked to #66
