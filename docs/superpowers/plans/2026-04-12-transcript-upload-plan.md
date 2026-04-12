# Transcript/Portfolio/Other Upload Classification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `transcript_upload`, `portfolio_upload`, and `other_upload` field classes to the classifier with optional profile paths and CV fallback.

**Architecture:** 3 new rules in the ordered RULES array (before the generic `cv_upload` fallback), 3 new entries in `mapProfileValue` with fallback to existing CV path, 3 optional fields in the profile template. TDD throughout.

**Tech Stack:** Node.js ESM, `node:test`, `node:assert/strict`

**Spec:** `docs/superpowers/specs/2026-04-12-transcript-upload-design.md`

---

### Task 1: Add classifier tests for `transcript_upload`

**Files:**
- Modify: `tests/apply/field-classifier.test.mjs:10-56` (add to `cases` array)

- [ ] **Step 1: Add 2 test cases to the `cases` array**

Insert after the `cover_letter_text` case (line 27) and before `eeo_gender` (line 28):

```js
  [{ name: 'transcript', type: 'file', label: 'Transcripts' }, 'transcript_upload'],
  [{ name: 'releve', type: 'file', label: 'Relevé de notes' }, 'transcript_upload'],
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/apply/field-classifier.test.mjs`

Expected: 2 failures — both transcript cases return `cv_upload` instead of `transcript_upload` (because the generic file fallback catches them).

### Task 2: Implement `transcript_upload` classifier rule

**Files:**
- Modify: `src/apply/field-classifier.mjs:13-22` (add rule to RULES array)

- [ ] **Step 1: Add the `transcript_upload` rule**

Insert after the `cover_letter_upload` rule (after line 17, before the `cv_upload` specific rule at line 18):

```js
  {
    key: 'transcript_upload',
    when: (f) =>
      f.type === 'file' &&
      test_norm(/transcript|releve de notes|academic record|grade report|bulletin/, f.label, f.name),
  },
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test tests/apply/field-classifier.test.mjs`

Expected: ALL PASS — the 2 new transcript cases now match, existing cases unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/apply/field-classifier.mjs tests/apply/field-classifier.test.mjs
git commit -m "feat(apply): add transcript_upload classifier rule and tests"
```

### Task 3: Add classifier tests for `portfolio_upload`

**Files:**
- Modify: `tests/apply/field-classifier.test.mjs` (add to `cases` array)

- [ ] **Step 1: Add 2 test cases to the `cases` array**

Insert right after the `transcript_upload` cases:

```js
  [{ name: 'portfolio', type: 'file', label: 'Portfolio' }, 'portfolio_upload'],
  [{ name: 'samples', type: 'file', label: 'Writing Sample' }, 'portfolio_upload'],
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/apply/field-classifier.test.mjs`

Expected: 2 failures — both portfolio cases return `cv_upload`.

### Task 4: Implement `portfolio_upload` classifier rule

**Files:**
- Modify: `src/apply/field-classifier.mjs` (add rule to RULES array)

- [ ] **Step 1: Add the `portfolio_upload` rule**

Insert after the `transcript_upload` rule just added:

```js
  {
    key: 'portfolio_upload',
    when: (f) =>
      f.type === 'file' &&
      test_norm(/portfolio|work sample|travaux|book|writing sample|echantillon/, f.label, f.name),
  },
```

**Important:** The existing `website` rule (line 40) matches `portfolio` for URL-type fields. Our new rule only fires on `f.type === 'file'`, so no conflict.

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test tests/apply/field-classifier.test.mjs`

Expected: ALL PASS.

- [ ] **Step 3: Commit**

```bash
git add src/apply/field-classifier.mjs tests/apply/field-classifier.test.mjs
git commit -m "feat(apply): add portfolio_upload classifier rule and tests"
```

### Task 5: Add classifier tests for `other_upload`

**Files:**
- Modify: `tests/apply/field-classifier.test.mjs` (add to `cases` array)

- [ ] **Step 1: Add 2 test cases to the `cases` array**

Insert right after the `portfolio_upload` cases:

```js
  [{ name: 'additional', type: 'file', label: 'Additional Documents' }, 'other_upload'],
  [{ name: 'other', type: 'file', label: 'Other Document' }, 'other_upload'],
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/apply/field-classifier.test.mjs`

Expected: 2 failures — both other cases return `cv_upload`.

### Task 6: Implement `other_upload` classifier rule

**Files:**
- Modify: `src/apply/field-classifier.mjs` (add rule to RULES array)

- [ ] **Step 1: Add the `other_upload` rule**

Insert after the `portfolio_upload` rule:

```js
  {
    key: 'other_upload',
    when: (f) =>
      f.type === 'file' &&
      test_norm(/additional.*doc|other.*doc|autre.*doc|supplement|piece jointe/, f.label, f.name),
  },
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test tests/apply/field-classifier.test.mjs`

Expected: ALL PASS.

- [ ] **Step 3: Commit**

```bash
git add src/apply/field-classifier.mjs tests/apply/field-classifier.test.mjs
git commit -m "feat(apply): add other_upload classifier rule and tests"
```

### Task 7: Add `mapProfileValue` tests for new upload classes

**Files:**
- Modify: `tests/apply/field-classifier.test.mjs` (add new test block after existing mapProfileValue tests)

- [ ] **Step 1: Add test for new upload mappings with and without fallback**

Add after the `countEntriesForSection` test (after line 150):

```js
test('mapProfileValue: transcript/portfolio/other with dedicated paths', () => {
  const profile = {
    first_name: 'Alice',
    last_name: 'Martin',
    cv_en_path: '/path/to/cv.pdf',
    transcript_path: '/path/to/transcript.pdf',
    portfolio_path: '/path/to/portfolio.pdf',
    other_document_path: '/path/to/other.pdf',
  };
  assert.equal(mapProfileValue('transcript_upload', profile), '/path/to/transcript.pdf');
  assert.equal(mapProfileValue('portfolio_upload', profile), '/path/to/portfolio.pdf');
  assert.equal(mapProfileValue('other_upload', profile), '/path/to/other.pdf');
});

test('mapProfileValue: transcript/portfolio/other fallback to CV', () => {
  const profile = {
    first_name: 'Alice',
    last_name: 'Martin',
    cv_en_path: '/path/to/cv.pdf',
  };
  assert.equal(mapProfileValue('transcript_upload', profile), '/path/to/cv.pdf');
  assert.equal(mapProfileValue('portfolio_upload', profile), '/path/to/cv.pdf');
  assert.equal(mapProfileValue('other_upload', profile), '/path/to/cv.pdf');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/apply/field-classifier.test.mjs`

Expected: 2 failures — `mapProfileValue` returns `undefined` for the new keys.

### Task 8: Implement `mapProfileValue` for new upload classes

**Files:**
- Modify: `src/apply/field-classifier.mjs:141-175` (add entries to `map` object in `mapProfileValue`)

- [ ] **Step 1: Add 3 new entries to the map object**

Inside the `map` object in `mapProfileValue` (after the `eeo_disability` line, before the closing `};`), add:

```js
    transcript_upload: profile.transcript_path ?? profile.cv_en_path,
    portfolio_upload: profile.portfolio_path ?? profile.cv_en_path,
    other_upload: profile.other_document_path ?? profile.cv_en_path,
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test tests/apply/field-classifier.test.mjs`

Expected: ALL PASS.

- [ ] **Step 3: Commit**

```bash
git add src/apply/field-classifier.mjs tests/apply/field-classifier.test.mjs
git commit -m "feat(apply): add mapProfileValue entries for transcript/portfolio/other uploads"
```

### Task 9: Update profile template and docs

**Files:**
- Modify: `templates/candidate-profile.example.yml:60-62`
- Modify: `docs/apply-workflow.md:43`

- [ ] **Step 1: Add optional document paths to profile template**

In `templates/candidate-profile.example.yml`, after line 62 (`cv_en_path: ...`), add:

```yaml

# --- Optional document paths (absolute) ---
transcript_path: null       # releve de notes / academic transcript
portfolio_path: null        # portfolio / work samples
other_document_path: null   # any additional document
```

- [ ] **Step 2: Update supported classes in docs**

In `docs/apply-workflow.md`, replace line 43:

```markdown
- Uploads: `cv_upload`, `cover_letter_upload`, `cover_letter_text`
```

with:

```markdown
- Uploads: `cv_upload`, `cover_letter_upload`, `cover_letter_text`, `transcript_upload`, `portfolio_upload`, `other_upload`
```

- [ ] **Step 3: Run full test suite**

Run: `npm test`

Expected: ALL PASS — no regressions.

- [ ] **Step 4: Run lint**

Run: `npm run lint`

Expected: PASS. If Prettier issues, run `npm run format` then re-check.

- [ ] **Step 5: Commit**

```bash
git add templates/candidate-profile.example.yml docs/apply-workflow.md
git commit -m "docs: add transcript/portfolio/other paths to profile template and supported classes"
```
