# Confirmation Freeze Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make confirmation detection resilient to page freeze, tab closure, and third-party redirects by adding a 3-level fallback strategy (L1 normal → L2 tab context → L3 probe URLs).

**Architecture:** Two new pure functions (`classifyTabContext`, `suggestProbeUrls`) in `confirmation-detector.mjs`. Playbook step 8 (apply.md) rewritten with L1→L2→L3 algorithm. Workday playbook step 5 replaced with a reference to apply.md step 8.

**Tech Stack:** Node 20+, ESM, `node:test`, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-12-confirmation-freeze-fallback-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/apply/confirmation-detector.mjs` | Modify | Add `classifyTabContext`, `suggestProbeUrls` exports |
| `tests/apply/confirmation-detector.test.mjs` | Modify | Add 9 tests for the two new functions |
| `.claude/commands/apply.md` | Modify (lines 240-257) | Rewrite step 8 with L1→L2→L3 |
| `docs/playbooks/apply-workday.md` | Modify (lines 174-186) | Replace step 5 with reference |

---

### Task 1: `suggestProbeUrls` — tests then implementation

**Files:**
- Modify: `tests/apply/confirmation-detector.test.mjs`
- Modify: `src/apply/confirmation-detector.mjs`

- [ ] **Step 1: Write 3 failing tests for `suggestProbeUrls`**

Add at the end of `tests/apply/confirmation-detector.test.mjs`:

```javascript
import {
  classifyConfirmation,
  classifyTabContext,
  suggestProbeUrls,
} from '../../src/apply/confirmation-detector.mjs';

// --- suggestProbeUrls ---

test('suggestProbeUrls returns 6 candidate URLs', () => {
  const urls = suggestProbeUrls('https://jobs.lever.co/acme/abc123');
  assert.equal(urls.length, 6);
  assert.ok(urls.includes('https://jobs.lever.co/acme/abc123/thanks'));
  assert.ok(urls.includes('https://jobs.lever.co/acme/abc123/thank-you'));
  assert.ok(urls.includes('https://jobs.lever.co/acme/abc123/confirmation'));
  assert.ok(urls.includes('https://jobs.lever.co/acme/abc123/submitted'));
  assert.ok(urls.includes('https://jobs.lever.co/acme/abc123/merci'));
  assert.ok(urls.includes('https://jobs.lever.co/acme/abc123/already-received'));
});

test('suggestProbeUrls strips trailing slash', () => {
  const urls = suggestProbeUrls('https://jobs.lever.co/acme/abc123/');
  assert.ok(urls[0].includes('abc123/thanks'));
  assert.ok(!urls[0].includes('abc123//thanks'));
});

test('suggestProbeUrls strips query string before suffixing', () => {
  const urls = suggestProbeUrls('https://jobs.lever.co/acme/abc123?source=linkedin');
  assert.ok(urls[0].includes('abc123/thanks'));
  assert.ok(!urls[0].includes('?source'));
});
```

Note: also update the existing import at line 3 to use the destructured form above — replace `import { classifyConfirmation }` with the multi-line import.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/apply/confirmation-detector.test.mjs`
Expected: 3 new tests FAIL (suggestProbeUrls is not exported), 6 existing tests PASS.

- [ ] **Step 3: Implement `suggestProbeUrls`**

Add at the end of `src/apply/confirmation-detector.mjs`, before the closing of the file:

```javascript
const PROBE_SUFFIXES = [
  '/thanks',
  '/thank-you',
  '/confirmation',
  '/submitted',
  '/merci',
  '/already-received',
];

export function suggestProbeUrls(baseUrl) {
  const stripped = baseUrl.replace(/[?#].*$/, '').replace(/\/+$/, '');
  return PROBE_SUFFIXES.map((suffix) => stripped + suffix);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/apply/confirmation-detector.test.mjs`
Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apply/confirmation-detector.mjs tests/apply/confirmation-detector.test.mjs
git commit -m "feat(apply): add suggestProbeUrls for L3 confirmation fallback (#18)"
```

---

### Task 2: `classifyTabContext` — tests then implementation

**Files:**
- Modify: `tests/apply/confirmation-detector.test.mjs`
- Modify: `src/apply/confirmation-detector.mjs`

- [ ] **Step 1: Write 6 failing tests for `classifyTabContext`**

Add after the `suggestProbeUrls` tests in `tests/apply/confirmation-detector.test.mjs`:

```javascript
// --- classifyTabContext ---

test('classifyTabContext: title with "Thank you for applying" → Applied', () => {
  const r = classifyTabContext({
    url: 'https://jobs.lever.co/acme/abc123',
    title: 'Thank you for applying | Acme Corp',
  });
  assert.equal(r.status, 'Applied');
});

test('classifyTabContext: title with "Merci pour votre candidature" → Applied', () => {
  const r = classifyTabContext({
    url: 'https://example.com/job/x',
    title: 'Merci pour votre candidature - Example',
  });
  assert.equal(r.status, 'Applied');
});

test('classifyTabContext: URL matches /confirmation → Applied', () => {
  const r = classifyTabContext({
    url: 'https://boards.greenhouse.io/acme/jobs/123/confirmation',
    title: 'Acme Corp Careers',
  });
  assert.equal(r.status, 'Applied');
});

test('classifyTabContext: URL matches /already-received → Applied', () => {
  const r = classifyTabContext({
    url: 'https://jobs.lever.co/acme/abc123/already-received',
    title: 'Lever',
  });
  assert.equal(r.status, 'Applied');
});

test('classifyTabContext: generic title and unchanged URL → Submitted (unconfirmed)', () => {
  const r = classifyTabContext({
    url: 'https://jobs.lever.co/acme/abc123',
    title: 'Software Engineer - Acme Corp - Lever',
  });
  assert.equal(r.status, 'Submitted (unconfirmed)');
});

test('classifyTabContext: null title does not crash', () => {
  const r = classifyTabContext({
    url: 'https://jobs.lever.co/acme/abc123',
    title: null,
  });
  assert.equal(r.status, 'Submitted (unconfirmed)');
});
```

- [ ] **Step 2: Run tests to verify the 6 new tests fail**

Run: `node --test tests/apply/confirmation-detector.test.mjs`
Expected: 6 new tests FAIL (classifyTabContext not exported), previous 9 PASS.

- [ ] **Step 3: Implement `classifyTabContext`**

Add in `src/apply/confirmation-detector.mjs`, after `SUCCESS_URL` and before `ERROR_TEXT`:

```javascript
const ALREADY_RECEIVED_URL = /\/already-received\b/i;

const TAB_TITLE_SUCCESS = [
  /thank you for (applying|your application)/i,
  /application (has been )?(received|submitted)/i,
  /your application is (complete|received)/i,
  /merci (pour|de) votre candidature/i,
  /candidature (bien )?(re[çc]ue|envoy[ée]e|enregistr[ée]e)/i,
];
```

Then add the function after `classifyConfirmation` and before `suggestProbeUrls`:

```javascript
export function classifyTabContext({ url, title }) {
  if (url && ALREADY_RECEIVED_URL.test(url))
    return { status: 'Applied', reason: 'tab context: already-received url' };
  if (url && SUCCESS_URL.some((r) => r.test(url)))
    return { status: 'Applied', reason: 'tab context: success url matched' };
  const t = title || '';
  if (TAB_TITLE_SUCCESS.some((r) => r.test(t)))
    return { status: 'Applied', reason: 'tab context: title matched' };
  return {
    status: 'Submitted (unconfirmed)',
    reason: 'tab context: no pattern matched',
  };
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `node --test tests/apply/confirmation-detector.test.mjs`
Expected: all 15 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/apply/confirmation-detector.mjs tests/apply/confirmation-detector.test.mjs
git commit -m "feat(apply): add classifyTabContext for L2 confirmation fallback (#18)"
```

---

### Task 3: Rewrite apply.md step 8 with L1→L2→L3

**Files:**
- Modify: `.claude/commands/apply.md` (lines 240-257)

- [ ] **Step 1: Replace step 8 in apply.md**

Replace lines 240-257 (from `## 8. Confirmation detection (15 s max)` to `After 15 s with no match → status \`Submitted (unconfirmed)\`, screenshot, notify the user.`) with:

```markdown
## 8. Confirmation detection (20 s max, L1→L2→L3 fallback)

Import `classifyConfirmation`, `classifyTabContext`, `suggestProbeUrls` from `src/apply/confirmation-detector.mjs`.

The renderer may freeze after submit (JS timeout). Use a 3-level fallback:

**Setup:** `attempts = 0`, `level = 'L1'`. Poll every 2 s, max 20 s total.

### L1 — Normal (renderer responsive)

1. Get `afterUrl` via `javascript_tool`: `return window.location.href`.
2. Get `pageText` via `get_page_text`.
3. If **either tool times out or errors**:
   - Increment `attempts`.
   - If `attempts >= 2` → switch to **L2**.
   - Otherwise retry on next poll.
4. Call `classifyConfirmation({ beforeUrl, afterUrl, pageText })`.
   - `Applied` → exit, record success.
   - `Failed` → screenshot, inspect validation errors. Re-check required fields (React re-render may have wiped a checkbox). Fix and retry submit once. If it fails again, stop.
   - `Submitted (unconfirmed)` → keep polling.

### L2 — Renderer blocked (use browser-process data)

1. Call `mcp__claude-in-chrome__tabs_context_mcp` → find the tab by its ID.
2. If **tab is gone** (closed by the site after submit):
   - Status = `Submitted (unconfirmed)`, reason = "tab closed by site after submit".
   - Alert the user. Exit.
3. Extract `{ url, title }` from the tab info.
4. Call `classifyTabContext({ url, title })`.
   - `Applied` → exit, record success.
5. If `url != beforeUrl` and no match yet:
   - Try `get_page_text` — the new page may be responsive even if the old one froze.
   - If it succeeds: `classifyConfirmation({ beforeUrl, afterUrl: url, pageText })`.
   - `Applied` / `Failed` → exit as above.
6. If `url == beforeUrl` → switch to **L3**.

### L3 — Probe candidate URLs (destructive — navigates away)

1. Call `suggestProbeUrls(beforeUrl)` → `candidates[]`.
2. For each candidate URL:
   - `mcp__claude-in-chrome__navigate` → candidate.
   - Wait 2 s.
   - `get_page_text` → `pageText`.
   - `classifyConfirmation({ beforeUrl, afterUrl: candidate, pageText })`.
   - `Applied` → exit, record success.
3. If no candidate matched → status `Submitted (unconfirmed)`.

### After the loop

If 20 s elapsed with no definitive result → status `Submitted (unconfirmed)`, screenshot, notify.

**Known gotchas:**

- **Lever `/already-received`**: caught by L1 (URL regex) and L2 (`classifyTabContext` URL check). Status = `Applied`, not `Failed`.
- **Tab closed by site**: L2 detects the missing tab. Status = `Submitted (unconfirmed)`, alert user — the tab is gone so no screenshot is possible.
- **Redirect to third-party domain**: L2 captures the new URL via `tabs_context_mcp` even if `javascript_tool` fails on the new domain (missing extension permission).
- **Aggregator silent close (e.g. WTTJ)**: L3 probes candidate URLs. If none match, `Submitted (unconfirmed)`.
```

- [ ] **Step 2: Verify the markdown renders correctly**

Read the modified file and verify step numbering, heading levels, and list formatting are consistent with the rest of `apply.md`.

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/apply.md
git commit -m "docs(apply): rewrite step 8 with L1→L2→L3 confirmation fallback (#18)"
```

---

### Task 4: Update Workday playbook step 5

**Files:**
- Modify: `docs/playbooks/apply-workday.md` (lines 174-186)

- [ ] **Step 1: Replace step 5 in the Workday playbook**

Replace lines 174-186 (from `## 5. Confirmation detection (15s max)` to `After 15 seconds with no definitive result → status \`Submitted (unconfirmed)\`.`) with:

```markdown
## 5. Confirmation detection

Follow **step 8** of `.claude/commands/apply.md` (L1→L2→L3 fallback). Use `beforeUrl` captured in step 4.3 above.
```

- [ ] **Step 2: Verify the section reference is correct**

Read `docs/playbooks/apply-workday.md` and confirm step 4 still captures `beforeUrl` at line 170 and step 6 (logging) follows correctly.

- [ ] **Step 3: Commit**

```bash
git add docs/playbooks/apply-workday.md
git commit -m "docs(workday): reference apply.md step 8 for confirmation detection (#18)"
```

---

### Task 5: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all tests pass, including the 9 new ones in `confirmation-detector.test.mjs`.

- [ ] **Step 2: Run linter**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Run PII check**

Run: `npm run check:pii`
Expected: clean.

- [ ] **Step 4: Fix any issues found in steps 1-3, then commit fixes if needed**

- [ ] **Step 5: Final commit (if needed) and verify git log**

Run: `git log --oneline -10`
Expected: 4 commits for this branch (tasks 1-4).
