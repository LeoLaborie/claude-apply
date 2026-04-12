# Positive Geographic Filtering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace negative-only regex location filtering with positive matching against user-defined `target_locations`, using the structured `offer.location` field that fetchers already provide.

**Architecture:** `checkLocation(offer, targetLocations)` splits `offer.location` into segments, checks each against target keywords (case-insensitive substring). Falls back to existing regex heuristic when location is empty. `runPrefilter` receives `targetLocations` via config. `index.mjs` derives the list from profile.

**Tech Stack:** Node 20+, `node:test`, ESM (.mjs)

---

### Task 1: Add failing tests for structured location matching

**Files:**
- Modify: `tests/lib/prefilter-rules.test.mjs`

- [ ] **Step 1: Add tests for positive location matching with `targetLocations` param**

Add these tests after the existing `checkLocation` block (line 38):

```javascript
// ---------- checkLocation with targetLocations ----------
const targets = ['France', 'Paris', 'Remote'];

test('checkLocation: pass "Paris, France" matches target "France"', () => {
  const r = checkLocation({ location: 'Paris, France', title: 'Dev', body: '' }, targets);
  assert.deepEqual(r, { pass: true });
});

test('checkLocation: reject "PRC, Shanghai" no target match', () => {
  const r = checkLocation({ location: 'PRC, Shanghai', title: 'Dev', body: '' }, targets);
  assert.equal(r.pass, false);
  assert.match(r.reason, /location/);
});

test('checkLocation: reject "Brazil - Sao Paulo"', () => {
  const r = checkLocation({ location: 'Brazil - Sao Paulo', title: 'Dev', body: '' }, targets);
  assert.equal(r.pass, false);
  assert.match(r.reason, /location/);
});

test('checkLocation: pass "Remote - France" geo segment matches', () => {
  const r = checkLocation({ location: 'Remote - France', title: 'Dev', body: '' }, targets);
  assert.deepEqual(r, { pass: true });
});

test('checkLocation: reject "Remote - US" geo segment no match', () => {
  const r = checkLocation({ location: 'Remote - US', title: 'Dev', body: '' }, targets);
  assert.equal(r.pass, false);
  assert.match(r.reason, /location/);
});

test('checkLocation: pass "Remote" alone (ambiguous, no geo qualifier)', () => {
  const r = checkLocation({ location: 'Remote', title: 'Dev', body: '' }, targets);
  assert.deepEqual(r, { pass: true });
});

test('checkLocation: reject "Taiwan-Hsinchu" hyphen separator', () => {
  const r = checkLocation({ location: 'Taiwan-Hsinchu', title: 'Dev', body: '' }, targets);
  assert.equal(r.pass, false);
  assert.match(r.reason, /location/);
});

test('checkLocation: pass "Paris, France / London, UK" one segment matches', () => {
  const r = checkLocation(
    { location: 'Paris, France / London, UK', title: 'Dev', body: '' },
    targets,
  );
  assert.deepEqual(r, { pass: true });
});
```

- [ ] **Step 2: Add tests for fallback when location is empty**

```javascript
// ---------- checkLocation fallback (empty location) ----------
test('checkLocation: fallback pass body mentions Paris', () => {
  const r = checkLocation({ location: '', title: 'Dev', body: 'Based in Paris office' }, targets);
  assert.deepEqual(r, { pass: true });
});

test('checkLocation: fallback reject body mentions New York only', () => {
  const r = checkLocation(
    { location: '', title: 'FDSE', body: 'Based in New York City, USA only' },
    targets,
  );
  assert.equal(r.pass, false);
  assert.match(r.reason, /location/);
});

test('checkLocation: fallback pass no signal (ambiguous)', () => {
  const r = checkLocation({ location: '', title: 'Dev', body: 'Great team' }, targets);
  assert.deepEqual(r, { pass: true });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /home/leo/Documents/claude-apply-dev/.worktrees/fix-geo-filter && node --test tests/lib/prefilter-rules.test.mjs`

Expected: New tests FAIL because `checkLocation` doesn't accept a second argument and doesn't read `offer.location`.

- [ ] **Step 4: Commit failing tests**

```bash
git add tests/lib/prefilter-rules.test.mjs
git commit -m "test(scan): add failing tests for positive location matching (issue #14)"
```

---

### Task 2: Implement positive location matching in `checkLocation`

**Files:**
- Modify: `src/lib/prefilter-rules.mjs:9-28`

- [ ] **Step 1: Add `splitLocationSegments` helper and rewrite `checkLocation`**

Replace lines 9-28 in `src/lib/prefilter-rules.mjs` with:

```javascript
const LOCATION_SEG_RE = /\s*[-/,]\s*/;
const REMOTE_RE = /^remote$/i;

function splitLocationSegments(loc) {
  return loc.split(LOCATION_SEG_RE).map((s) => s.trim()).filter(Boolean);
}

export function checkLocation(offer, targetLocations) {
  const loc = offer.location || '';

  // Structured location available — use positive matching
  if (loc) {
    const segments = splitLocationSegments(loc);
    const geoSegments = segments.filter((s) => !REMOTE_RE.test(s));

    if (geoSegments.length === 0) {
      // Pure "Remote" with no geographic qualifier — ambiguous, pass
      return { pass: true };
    }

    const match = geoSegments.some((seg) =>
      (targetLocations || []).some((t) => seg.toLowerCase().includes(t.toLowerCase())),
    );
    if (match) return { pass: true };
    return { pass: false, reason: `location: ${loc} not in target zones` };
  }

  // Fallback: no structured location — use regex heuristic on title + body
  const title = offer.title || '';
  const body = offer.body || '';
  const titleHasForeign = LOCATION_FOREIGN_RE.test(title);
  const titleHasFr = LOCATION_FR_RE.test(title);
  if (titleHasForeign && !titleHasFr) {
    return { pass: false, reason: 'location: foreign in title, no FR' };
  }
  const haystack = `${title} ${body}`;
  if (LOCATION_FR_RE.test(haystack)) return { pass: true };
  if (LOCATION_FOREIGN_RE.test(body)) return { pass: false, reason: 'location: foreign only' };
  return { pass: true };
}
```

- [ ] **Step 2: Run new tests to verify they pass**

Run: `cd /home/leo/Documents/claude-apply-dev/.worktrees/fix-geo-filter && node --test tests/lib/prefilter-rules.test.mjs`

Expected: All new tests PASS. Check that no existing tests broke.

- [ ] **Step 3: Commit implementation**

```bash
git add src/lib/prefilter-rules.mjs
git commit -m "fix(scan): positive location matching on offer.location (issue #14)"
```

---

### Task 3: Update existing tests for new signature

**Files:**
- Modify: `tests/lib/prefilter-rules.test.mjs`

The existing `checkLocation` tests (lines 12-38) call `checkLocation({ body, title })` without `targetLocations`. They should still work because the fallback kicks in when `offer.location` is empty/absent. But the `runPrefilter` integration tests need updating.

- [ ] **Step 1: Update `runPrefilter` integration tests to pass `targetLocations`**

Update the existing `runPrefilter` tests to include `targetLocations` in config:

```javascript
test('runPrefilter: court-circuit sur la première règle qui échoue', () => {
  const offer = { title: 'Senior Dev', body: 'Paris', company: 'Foo', location: '' };
  const config = {
    minStartDate: '2026-08-24',
    blacklist: [],
    whitelist: wl,
    targetLocations: ['France', 'Paris', 'Remote'],
  };
  const r = runPrefilter(offer, config);
  assert.equal(r.pass, false);
  assert.match(r.reason, /negative|title/);
});

test('runPrefilter: pass offre valide', () => {
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
  assert.deepEqual(runPrefilter(offer, config), { pass: true });
});
```

- [ ] **Step 2: Wire `targetLocations` through `runPrefilter`**

In `src/lib/prefilter-rules.mjs`, update `runPrefilter` (line 149):

Change:
```javascript
() => checkLocation(offer),
```
To:
```javascript
() => checkLocation(offer, config.targetLocations),
```

- [ ] **Step 3: Run full test suite**

Run: `cd /home/leo/Documents/claude-apply-dev/.worktrees/fix-geo-filter && npm test`

Expected: All 282+ tests pass, 0 failures.

- [ ] **Step 4: Commit**

```bash
git add src/lib/prefilter-rules.mjs tests/lib/prefilter-rules.test.mjs
git commit -m "fix(scan): wire targetLocations through runPrefilter (issue #14)"
```

---

### Task 4: Build `targetLocations` from profile in `index.mjs`

**Files:**
- Modify: `src/scan/index.mjs:79-83`

- [ ] **Step 1: Derive `targetLocations` and add to `prefilterConfig`**

In `src/scan/index.mjs`, update the `prefilterConfig` construction (around line 79):

Change:
```javascript
  const prefilterConfig = {
    whitelist,
    blacklist: profile.blacklist_companies || [],
    minStartDate: profile.min_start_date || '2026-08-24',
  };
```

To:
```javascript
  const targetLocations = profile.target_locations ||
    [profile.country, profile.city, 'Remote'].filter(Boolean);
  const prefilterConfig = {
    whitelist,
    blacklist: profile.blacklist_companies || [],
    minStartDate: profile.min_start_date || '2026-08-24',
    targetLocations,
  };
```

- [ ] **Step 2: Run full test suite**

Run: `cd /home/leo/Documents/claude-apply-dev/.worktrees/fix-geo-filter && npm test`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/scan/index.mjs
git commit -m "fix(scan): derive targetLocations from profile in scan runner (issue #14)"
```

---

### Task 5: Add `target_locations` to example profile template

**Files:**
- Modify: `templates/candidate-profile.example.yml`

- [ ] **Step 1: Add `target_locations` field**

Add after the `min_start_date` line (line 77):

```yaml

# --- Geographic targeting (optional) ---
# Used by /scan to filter offers by location. Case-insensitive substring match.
# When absent, derived from city + country above → ["France", "Paris", "Remote"].
# target_locations:
#   - France
#   - Paris
#   - Remote
```

- [ ] **Step 2: Run PII check and tests**

Run: `cd /home/leo/Documents/claude-apply-dev/.worktrees/fix-geo-filter && npm run check:pii && npm test`

Expected: PII gate clean, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add templates/candidate-profile.example.yml
git commit -m "docs: add target_locations field to example profile (issue #14)"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run full suite + lint + PII gate**

```bash
cd /home/leo/Documents/claude-apply-dev/.worktrees/fix-geo-filter
npm test && npm run lint && npm run check:pii
```

Expected: All green.

- [ ] **Step 2: Review git log**

```bash
git log --oneline main..HEAD
```

Expected: 5-6 commits, clean conventional commit messages, all referencing issue #14.
