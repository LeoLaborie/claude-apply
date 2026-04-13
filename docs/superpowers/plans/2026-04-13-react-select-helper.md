# react-select helper for `/apply` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reliable react-select helper so `/apply` can fill custom dropdowns on Greenhouse/Ashby/Doctolib forms that currently block the entire apply flow (issue #41).

**Architecture:** Ship a new ESM module `src/apply/react-select-helper.mjs` that exports (a) a pure `matchOptionText` function, (b) a typed `ReactSelectError` class, and (c) a self-contained `REACT_SELECT_SNIPPET` string injected via `javascript_tool` which performs the full `mousedown` → menu → option → verify sequence in the page. Unit tests cover pure logic + snippet shape; manual validation on a real Doctolib form confirms the runtime behavior. Documentation in `docs/playbooks/apply-greenhouse.md` explains usage, error codes, and the `computer` physical-click fallback.

**Tech Stack:** Node 20+, ESM (`.mjs`), `node:test`, Prettier, existing `mcp__claude-in-chrome__javascript_tool` + `computer` MCP tools.

**Spec:** `docs/superpowers/specs/2026-04-13-react-select-helper-design.md`

---

## File structure

- `src/apply/react-select-helper.mjs` — new. Exports `matchOptionText`, `ReactSelectError`, `REACT_SELECT_SNIPPET`. ~120 lines. Pure-logic module; no Node-only imports beyond standard.
- `tests/apply/react-select-helper.test.mjs` — new. `node:test` unit tests.
- `docs/playbooks/apply-greenhouse.md` — new. Agent-facing playbook.
- `.claude/commands/apply.md` — patch line 185 (custom-dropdown bullet).
- `docs/apply-workflow.md` — patch table row line 62.

---

## Task 1: Pure `matchOptionText` + `ReactSelectError`

**Files:**
- Create: `src/apply/react-select-helper.mjs`
- Test: `tests/apply/react-select-helper.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `tests/apply/react-select-helper.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchOptionText,
  ReactSelectError,
} from '../../src/apply/react-select-helper.mjs';

test('matchOptionText: exact trimmed match wins', () => {
  assert.equal(matchOptionText(['Non', 'Oui', 'NON'], 'Non'), 'Non');
});

test('matchOptionText: case-insensitive exact wins over startsWith', () => {
  assert.equal(matchOptionText(['Nonante', 'NON'], 'non'), 'NON');
});

test('matchOptionText: startsWith picks first prefix match', () => {
  assert.equal(
    matchOptionText(['France métropolitaine', 'Francophonie'], 'France'),
    'France métropolitaine',
  );
});

test('matchOptionText: returns null when no match', () => {
  assert.equal(matchOptionText(['Oui', 'Non'], 'Peut-être'), null);
});

test('matchOptionText: handles empty array', () => {
  assert.equal(matchOptionText([], 'Anything'), null);
});

test('matchOptionText: trims whitespace from options and target', () => {
  assert.equal(matchOptionText(['  Non  '], ' Non '), '  Non  ');
});

test('ReactSelectError: extends Error with code and optional found', () => {
  const err = new ReactSelectError('OPTION_NOT_FOUND', 'missing', {
    found: ['A', 'B'],
  });
  assert.ok(err instanceof Error);
  assert.ok(err instanceof ReactSelectError);
  assert.equal(err.code, 'OPTION_NOT_FOUND');
  assert.equal(err.message, 'missing');
  assert.deepEqual(err.found, ['A', 'B']);
});

test('ReactSelectError: found defaults to undefined', () => {
  const err = new ReactSelectError('CONTROL_NOT_FOUND', 'nope');
  assert.equal(err.found, undefined);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/apply/react-select-helper.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` (file does not exist yet).

- [ ] **Step 3: Create the module with `matchOptionText` and `ReactSelectError`**

Create `src/apply/react-select-helper.mjs`:

```javascript
export class ReactSelectError extends Error {
  constructor(code, message, { found } = {}) {
    super(message);
    this.name = 'ReactSelectError';
    this.code = code;
    this.found = found;
  }
}

export function matchOptionText(options, target) {
  if (!Array.isArray(options) || options.length === 0) return null;
  const t = String(target).trim();
  const tLower = t.toLowerCase();

  for (const opt of options) {
    if (String(opt).trim() === t) return opt;
  }
  for (const opt of options) {
    if (String(opt).trim().toLowerCase() === tLower) return opt;
  }
  for (const opt of options) {
    if (String(opt).trim().toLowerCase().startsWith(tLower)) return opt;
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/apply/react-select-helper.test.mjs`
Expected: PASS — 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/apply/react-select-helper.mjs tests/apply/react-select-helper.test.mjs
git commit -m "feat(apply): add matchOptionText + ReactSelectError (#41)"
```

---

## Task 2: `REACT_SELECT_SNIPPET` browser-side routine

**Files:**
- Modify: `src/apply/react-select-helper.mjs` (append export)
- Modify: `tests/apply/react-select-helper.test.mjs` (append shape tests)

- [ ] **Step 1: Write the failing shape tests**

Append to `tests/apply/react-select-helper.test.mjs`:

```javascript
import { REACT_SELECT_SNIPPET } from '../../src/apply/react-select-helper.mjs';

test('REACT_SELECT_SNIPPET: is a non-empty string', () => {
  assert.equal(typeof REACT_SELECT_SNIPPET, 'string');
  assert.ok(REACT_SELECT_SNIPPET.length > 200);
});

test('REACT_SELECT_SNIPPET: references all required selectors', () => {
  for (const sel of [
    'select__control',
    'select__menu',
    'select__option',
    'select__single-value',
  ]) {
    assert.ok(
      REACT_SELECT_SNIPPET.includes(sel),
      `snippet missing selector ${sel}`,
    );
  }
});

test('REACT_SELECT_SNIPPET: references all four error codes', () => {
  for (const code of [
    'CONTROL_NOT_FOUND',
    'MENU_NOT_OPENED',
    'OPTION_NOT_FOUND',
    'SELECTION_NOT_APPLIED',
  ]) {
    assert.ok(
      REACT_SELECT_SNIPPET.includes(code),
      `snippet missing code ${code}`,
    );
  }
});

test('REACT_SELECT_SNIPPET: uses mousedown (not just click)', () => {
  assert.ok(REACT_SELECT_SNIPPET.includes('mousedown'));
});

test('REACT_SELECT_SNIPPET: exposes controlSelector and optionText bindings', () => {
  assert.ok(REACT_SELECT_SNIPPET.includes('controlSelector'));
  assert.ok(REACT_SELECT_SNIPPET.includes('optionText'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/apply/react-select-helper.test.mjs`
Expected: FAIL — 5 new failures on `REACT_SELECT_SNIPPET` not being exported.

- [ ] **Step 3: Append `REACT_SELECT_SNIPPET` to the module**

Append to `src/apply/react-select-helper.mjs`:

```javascript
export const REACT_SELECT_SNIPPET = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const control = document.querySelector(controlSelector);
  if (!control) {
    return { ok: false, code: 'CONTROL_NOT_FOUND' };
  }

  const fire = (el, type) =>
    el.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }),
    );

  fire(control, 'mousedown');
  fire(control, 'mouseup');

  const container =
    control.closest('[class*="select__container"]') ||
    control.parentElement ||
    document;

  let menu = null;
  for (let i = 0; i < 30; i++) {
    menu =
      container.querySelector('.select__menu') ||
      document.querySelector('.select__menu');
    if (menu) break;
    await sleep(50);
  }
  if (!menu) {
    return { ok: false, code: 'MENU_NOT_OPENED' };
  }

  const optionEls = Array.from(menu.querySelectorAll('.select__option'));
  const labels = optionEls.map((el) => (el.textContent || '').trim());
  const target = String(optionText).trim();
  const targetLower = target.toLowerCase();

  let matchIdx = labels.findIndex((l) => l === target);
  if (matchIdx < 0)
    matchIdx = labels.findIndex((l) => l.toLowerCase() === targetLower);
  if (matchIdx < 0)
    matchIdx = labels.findIndex((l) =>
      l.toLowerCase().startsWith(targetLower),
    );

  if (matchIdx < 0) {
    return { ok: false, code: 'OPTION_NOT_FOUND', found: labels };
  }

  const option = optionEls[matchIdx];
  fire(option, 'mousedown');
  fire(option, 'mouseup');
  option.click();

  let valueEl = null;
  for (let i = 0; i < 10; i++) {
    valueEl =
      container.querySelector('.select__single-value') ||
      container.querySelector('.select__multi-value__label');
    if (valueEl && (valueEl.textContent || '').trim().length > 0) break;
    await sleep(50);
  }
  if (!valueEl || !(valueEl.textContent || '').trim()) {
    return { ok: false, code: 'SELECTION_NOT_APPLIED' };
  }

  return { ok: true, value: valueEl.textContent.trim() };
})()`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/apply/react-select-helper.test.mjs`
Expected: PASS — 13 tests total.

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: PASS (no Prettier diff).

If it fails, run `npm run format` and re-check.

- [ ] **Step 6: Commit**

```bash
git add src/apply/react-select-helper.mjs tests/apply/react-select-helper.test.mjs
git commit -m "feat(apply): add REACT_SELECT_SNIPPET for custom dropdowns (#41)"
```

---

## Task 3: Greenhouse/react-select playbook

**Files:**
- Create: `docs/playbooks/apply-greenhouse.md`

- [ ] **Step 1: Write the playbook**

Create `docs/playbooks/apply-greenhouse.md`:

```markdown
# react-select custom dropdown playbook

This playbook is read by the agent during `/apply` step 5 when the DOM contains any `.select__control` element on a required field. It is **not Greenhouse-specific** — the same helper works on Ashby and any site using [react-select](https://react-select.com). It is stored under `apply-greenhouse.md` because that is where the bug was first hit (issue #41, Doctolib Greenhouse).

## Why a dedicated path

`form_input` writes `input.value` directly, which react-select ignores. The React native-setter pattern from `.claude/commands/apply.md` step 5 also fails because react-select does not render its options until `mousedown` opens the menu, and its selection state lives in React state rather than on a native input.

## Primary path — inject `REACT_SELECT_SNIPPET`

Import the snippet constant from `src/apply/react-select-helper.mjs` (Node-side, via the agent's orchestration) or copy it verbatim. Then run via `mcp__claude-in-chrome__javascript_tool`:

\`\`\`js
const controlSelector = '#some-field .select__control';
const optionText = 'Non';
// then paste REACT_SELECT_SNIPPET here (it reads the two bindings above)
\`\`\`

The snippet returns one of:

- `{ ok: true, value: 'Non' }` — selection applied; verify `value` matches `optionText` before moving on.
- `{ ok: false, code: 'CONTROL_NOT_FOUND' }`
- `{ ok: false, code: 'MENU_NOT_OPENED' }`
- `{ ok: false, code: 'OPTION_NOT_FOUND', found: [...] }`
- `{ ok: false, code: 'SELECTION_NOT_APPLIED' }`

## Error codes

- **`CONTROL_NOT_FOUND`** — `controlSelector` matched nothing. Re-read the DOM with `read_page`, widen or correct the selector, retry once.
- **`MENU_NOT_OPENED`** — `mousedown` did not cause the menu to render within 1500 ms. Typical causes: a portal root outside the container, or a wrapper that swallows events. Fall back to physical click (below).
- **`OPTION_NOT_FOUND`** — the menu opened but no option label matched `optionText`. The `found` array lists what was visible. Map the profile value to a label the page actually offers (the resolver may need to be relaxed), or STOP and ask the user.
- **`SELECTION_NOT_APPLIED`** — the option was clicked but `.select__single-value` stayed empty. Fall back to physical click.

After two consecutive failures on the same field, do **not** loop — switch to the fallback.

## Fallback — physical click via `computer`

1. Get the control center coordinates:
   \`\`\`js
   const r = document.querySelector(controlSelector).getBoundingClientRect();
   ({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
   \`\`\`
2. `mcp__claude-in-chrome__computer` → `left_click` on `(x, y)`.
3. `type` the first 3–5 characters of `optionText` to filter the menu.
4. `key Return` to pick the first highlighted option.
5. Verify via `javascript_tool` that `document.querySelector(controlSelector).closest('[class*="select__container"]').querySelector('.select__single-value').textContent.trim()` equals `optionText`.
6. If verification fails → **STOP** and ask the user.

## Invariants

- Never guess an option label. If the offered labels don't include a safe value, STOP.
- Never submit the form with `SELECTION_NOT_APPLIED` unresolved on a required field.
- Never disable or bypass react-select's internals (e.g. via `__reactProps$...`). Stick to DOM events.
```

- [ ] **Step 2: Commit**

```bash
git add docs/playbooks/apply-greenhouse.md
git commit -m "docs(playbooks): react-select custom dropdown playbook (#41)"
```

---

## Task 4: Reference helper from `/apply` command and workflow doc

**Files:**
- Modify: `.claude/commands/apply.md:185`
- Modify: `docs/apply-workflow.md:62`

- [ ] **Step 1: Patch `.claude/commands/apply.md`**

Replace the single bullet at line 185:

From:
```
- **Custom dropdowns (React Select, etc.)**: use `find` + `click` on the option element.
```

To:
```
- **Custom dropdowns (`.select__control` — React Select)**: use `REACT_SELECT_SNIPPET` from `src/apply/react-select-helper.mjs` via `javascript_tool`. Bind `controlSelector` and `optionText` in the eval preamble. See `docs/playbooks/apply-greenhouse.md` for the error codes (`CONTROL_NOT_FOUND`, `MENU_NOT_OPENED`, `OPTION_NOT_FOUND`, `SELECTION_NOT_APPLIED`) and the `computer`-based fallback.
```

- [ ] **Step 2: Patch `docs/apply-workflow.md`**

Replace line 62:

From:
```
| Custom dropdown (React Select, etc.) | `find` + `click` on the option element                                    |
```

To:
```
| Custom dropdown (`.select__control`) | `REACT_SELECT_SNIPPET` (see `src/apply/react-select-helper.mjs` and `docs/playbooks/apply-greenhouse.md`) |
```

- [ ] **Step 3: Run lint + PII gate**

Run: `npm run lint && npm run check:pii`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add .claude/commands/apply.md docs/apply-workflow.md
git commit -m "docs(apply): reference REACT_SELECT_SNIPPET in /apply + workflow (#41)"
```

---

## Task 5: Final validation + PR

**Files:** none modified.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS. The 13 new tests appear under `tests/apply/react-select-helper.test.mjs`.

- [ ] **Step 2: Run lint + PII gate**

Run: `npm run lint && npm run check:pii`
Expected: both PASS.

- [ ] **Step 3: Verify branch status**

Run: `git status && git log --oneline main..HEAD`
Expected: clean working tree; 4 commits on `fix/issue-41-react-select-helper`:
1. `docs(spec): react-select helper for /apply (#41)` (already present from brainstorming)
2. `feat(apply): add matchOptionText + ReactSelectError (#41)`
3. `feat(apply): add REACT_SELECT_SNIPPET for custom dropdowns (#41)`
4. `docs(playbooks): react-select custom dropdown playbook (#41)`
5. `docs(apply): reference REACT_SELECT_SNIPPET in /apply + workflow (#41)`

- [ ] **Step 4: Push and open PR**

Run:
```bash
git push -u origin fix/issue-41-react-select-helper
gh pr create --title "fix(apply): react-select helper for custom dropdowns (#41)" --body "$(cat <<'EOF'
## Summary
- Add `src/apply/react-select-helper.mjs` exporting `matchOptionText`, `ReactSelectError`, and `REACT_SELECT_SNIPPET` — a self-contained DOM routine that opens the menu via `mousedown`, finds the option by text, clicks it, and verifies `.select__single-value`.
- Add `docs/playbooks/apply-greenhouse.md` documenting the primary path, the four error codes, and a `computer`-based physical-click fallback.
- Reference the helper from `.claude/commands/apply.md` step 5 and `docs/apply-workflow.md`.

Fixes #41.

## Test plan
- [x] `npm test` passes (13 new tests in `tests/apply/react-select-helper.test.mjs`)
- [x] `npm run lint` passes
- [x] `npm run check:pii` passes
- [ ] Manual: run `/apply https://job-boards.greenhouse.io/doctolib/jobs/7642865003` and confirm the four react-select dropdowns (Pays, Établissement, Fonctionnaire, Identité de genre) are filled via the snippet

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 5: Verify CI**

Run: `gh pr checks --watch`
Expected: all checks PASS (lint, tests, PII).

---

## Self-review

**Spec coverage:**
- `matchOptionText` pure function → Task 1 ✓
- `ReactSelectError` with 4 codes → Task 1 ✓
- `REACT_SELECT_SNIPPET` (mousedown, poll menu, match, click, verify) → Task 2 ✓
- Unit tests (pure logic + snippet shape) → Tasks 1, 2 ✓
- Playbook `docs/playbooks/apply-greenhouse.md` → Task 3 ✓
- Patch `.claude/commands/apply.md` step 5 → Task 4 ✓
- Patch `docs/apply-workflow.md` dropdown row → Task 4 ✓
- Fallback `computer`-based sequence documented → Task 3 ✓
- Manual validation on Doctolib Greenhouse URL → Task 5 test plan ✓

**Placeholder scan:** none found.

**Type consistency:** `matchOptionText(options, target)`, `ReactSelectError(code, message, { found })`, `REACT_SELECT_SNIPPET` name used consistently across tasks and docs. Error codes identical in snippet, tests, playbook, and apply.md patch.
