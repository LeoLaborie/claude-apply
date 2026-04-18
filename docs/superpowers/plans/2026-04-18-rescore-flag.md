# `--re-score` Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `--re-score` flag to `src/score/index.mjs` so users can re-evaluate previously scored URLs in-place, in both single-URL and batch modes, without manual file editing.

**Architecture:** Two small library helpers (`updateJsonlEntry`, `removeTrackerTsvById`) handle atomic in-place replacement; `src/score/index.mjs` branches on `flags.reScore` in both the single and batch code paths. In batch mode, writes to `evaluations.jsonl` are serialized via a `pLimit(1)` mutex because update-by-URL is not safe under concurrent read-modify-write; fetching and `claude -p` calls keep their existing parallelism.

**Tech Stack:** Node 20 ESM, `node:test`, `node:fs`, existing `src/lib/p-limit.mjs`.

**Spec:** `docs/superpowers/specs/2026-04-18-rescore-flag-design.md`

---

## Task 1: `updateJsonlEntry` helper (atomic in-place update)

**Files:**
- Modify: `src/lib/jsonl-writer.mjs`
- Test: `tests/lib/jsonl-writer.test.mjs`

- [ ] **Step 1: Write failing test — match found, replace line**

Append to `tests/lib/jsonl-writer.test.mjs` (keep the existing `tmp`, `afterEach`, and imports; add `updateJsonlEntry` to the import statement at the top):

```javascript
import { appendJsonl, appendFilteredOut, updateJsonlEntry } from '../../src/lib/jsonl-writer.mjs';
```

```javascript
test('updateJsonlEntry — remplace la première ligne correspondante', () => {
  const p = path.join(tmp, 'evals.jsonl');
  appendJsonl(p, { id: '001', url: 'https://a/1', score: 3.0 });
  appendJsonl(p, { id: '002', url: 'https://a/2', score: 4.0 });
  appendJsonl(p, { id: '003', url: 'https://a/3', score: 5.0 });

  const prev = updateJsonlEntry(
    p,
    (e) => e.url === 'https://a/2',
    { id: '002', url: 'https://a/2', score: 4.5 }
  );

  assert.deepEqual(prev, { id: '002', url: 'https://a/2', score: 4.0 });
  const lines = fs.readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 3);
  assert.deepEqual(lines[0], { id: '001', url: 'https://a/1', score: 3.0 });
  assert.deepEqual(lines[1], { id: '002', url: 'https://a/2', score: 4.5 });
  assert.deepEqual(lines[2], { id: '003', url: 'https://a/3', score: 5.0 });
});

test('updateJsonlEntry — retourne null et ne modifie rien quand rien ne match', () => {
  const p = path.join(tmp, 'evals.jsonl');
  appendJsonl(p, { id: '001', url: 'https://a/1', score: 3.0 });
  const before = fs.readFileSync(p, 'utf8');

  const prev = updateJsonlEntry(p, (e) => e.url === 'https://missing', { id: '999' });

  assert.equal(prev, null);
  const after = fs.readFileSync(p, 'utf8');
  assert.equal(before, after);
});

test('updateJsonlEntry — préserve les lignes JSON invalides sans crasher', () => {
  const p = path.join(tmp, 'evals.jsonl');
  fs.writeFileSync(
    p,
    [
      JSON.stringify({ id: '001', url: 'https://a/1' }),
      'this is not json',
      JSON.stringify({ id: '002', url: 'https://a/2' }),
    ].join('\n') + '\n'
  );

  updateJsonlEntry(p, (e) => e.url === 'https://a/2', { id: '002', url: 'https://a/2', score: 9 });

  const lines = fs.readFileSync(p, 'utf8').trim().split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[1], 'this is not json');
  assert.deepEqual(JSON.parse(lines[2]), { id: '002', url: 'https://a/2', score: 9 });
});

test('updateJsonlEntry — file manquant retourne null', () => {
  const p = path.join(tmp, 'missing.jsonl');
  const prev = updateJsonlEntry(p, () => true, {});
  assert.equal(prev, null);
  assert.equal(fs.existsSync(p), false);
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `node --test tests/lib/jsonl-writer.test.mjs`
Expected: 4 new tests FAIL (`updateJsonlEntry is not a function` or similar).

- [ ] **Step 3: Implement `updateJsonlEntry`**

Edit `src/lib/jsonl-writer.mjs`, add at the bottom of the file:

```javascript
export function updateJsonlEntry(filePath, matchFn, newObj) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  let previous = null;
  let matchedIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (matchFn(obj)) {
      previous = obj;
      matchedIdx = i;
      break;
    }
  }

  if (matchedIdx === -1) return null;

  lines[matchedIdx] = JSON.stringify(newObj);
  const output = lines.join('\n');
  const tmpPath = filePath + '.tmp';
  fs.writeFileSync(tmpPath, output, 'utf8');
  fs.renameSync(tmpPath, filePath);
  return previous;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/lib/jsonl-writer.test.mjs`
Expected: all tests in the file PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/jsonl-writer.mjs tests/lib/jsonl-writer.test.mjs
git commit -m "feat(lib): add updateJsonlEntry helper for atomic in-place JSONL updates (#76)"
```

---

## Task 2: `removeTrackerTsvById` helper

**Files:**
- Modify: `src/lib/tsv-writer.mjs`
- Test: `tests/lib/tsv-writer.test.mjs` (new file)

- [ ] **Step 1: Create the test file with failing tests**

Create `tests/lib/tsv-writer.test.mjs`:

```javascript
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeTrackerTsv, removeTrackerTsvById } from '../../src/lib/tsv-writer.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tsv-writer-'));

afterEach(() => {
  for (const f of fs.readdirSync(tmp)) fs.unlinkSync(path.join(tmp, f));
});

test('removeTrackerTsvById — supprime les fichiers préfixés par <id>-', () => {
  fs.writeFileSync(path.join(tmp, '042-acme.tsv'), 'x\n');
  fs.writeFileSync(path.join(tmp, '042-other-slug.tsv'), 'x\n');
  fs.writeFileSync(path.join(tmp, '043-kept.tsv'), 'x\n');
  fs.writeFileSync(path.join(tmp, '042.tsv'), 'x\n'); // no dash → not matched

  const removed = removeTrackerTsvById(tmp, '042');
  assert.equal(removed.length, 2);
  assert.ok(removed.includes('042-acme.tsv'));
  assert.ok(removed.includes('042-other-slug.tsv'));
  const remaining = fs.readdirSync(tmp).sort();
  assert.deepEqual(remaining, ['042.tsv', '043-kept.tsv']);
});

test('removeTrackerTsvById — dir manquant renvoie tableau vide', () => {
  const removed = removeTrackerTsvById(path.join(tmp, 'missing-dir'), '001');
  assert.deepEqual(removed, []);
});

test('removeTrackerTsvById — aucun fichier matchant renvoie tableau vide', () => {
  fs.writeFileSync(path.join(tmp, '010-keep.tsv'), 'x\n');
  const removed = removeTrackerTsvById(tmp, '042');
  assert.deepEqual(removed, []);
  assert.equal(fs.existsSync(path.join(tmp, '010-keep.tsv')), true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/lib/tsv-writer.test.mjs`
Expected: FAIL on `removeTrackerTsvById is not a function`.

- [ ] **Step 3: Implement `removeTrackerTsvById`**

Edit `src/lib/tsv-writer.mjs`, append at the end of the file:

```javascript
export function removeTrackerTsvById(dir, id) {
  if (!fs.existsSync(dir)) return [];
  const prefix = `${id}-`;
  const removed = [];
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith(prefix) && name.endsWith('.tsv')) {
      fs.unlinkSync(path.join(dir, name));
      removed.push(name);
    }
  }
  return removed;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/lib/tsv-writer.test.mjs`
Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tsv-writer.mjs tests/lib/tsv-writer.test.mjs
git commit -m "feat(lib): add removeTrackerTsvById helper (#76)"
```

---

## Task 3: Parse `--re-score` in `parseScoreArgs`

**Files:**
- Modify: `src/score/index.mjs` (function `parseScoreArgs`)
- Test: `tests/score/metadata-source.test.mjs` (append cases)

- [ ] **Step 1: Write failing tests**

Append to `tests/score/metadata-source.test.mjs`:

```javascript
test('parseScoreArgs — --re-score flag (single URL)', () => {
  const f = parseScoreArgs(['https://jobs.example.com/a', '--re-score']);
  assert.equal(f.reScore, true);
  assert.equal(f.url, 'https://jobs.example.com/a');
  assert.equal(f.batch, false);
});

test('parseScoreArgs — --re-score + --batch', () => {
  const f = parseScoreArgs(['--batch', '--re-score']);
  assert.equal(f.reScore, true);
  assert.equal(f.batch, true);
});

test('parseScoreArgs — --re-score + --from-pipeline', () => {
  const f = parseScoreArgs(['https://jobs.example.com/a', '--from-pipeline', '--re-score']);
  assert.equal(f.reScore, true);
  assert.equal(f.fromPipeline, true);
});

test('parseScoreArgs — --re-score absent → false par défaut', () => {
  const f = parseScoreArgs(['https://jobs.example.com/a']);
  assert.equal(f.reScore, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/score/metadata-source.test.mjs`
Expected: 4 new tests FAIL (`f.reScore` is `undefined`, not `true`/`false`).

- [ ] **Step 3: Add `reScore` to `parseScoreArgs`**

In `src/score/index.mjs`, find the `flags` object in `parseScoreArgs` (around line 269–280) and add `reScore: false` to the defaults:

```javascript
const flags = {
  url: null,
  jsonInput: null,
  id: null,
  company: null,
  role: null,
  location: null,
  fromPipeline: false,
  batch: false,
  parallel: 5,
  reScore: false,
};
```

Then, after the `--batch` handling block (around line 300–304), add a block to detect `--re-score`:

```javascript
const rsIdx = args.indexOf('--re-score');
if (rsIdx !== -1) {
  flags.reScore = true;
  args.splice(rsIdx, 1);
}
```

Place this block **before** `flags.url = args.find(...)` so the positional URL extraction works correctly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/score/metadata-source.test.mjs`
Expected: all tests PASS (old + new).

- [ ] **Step 5: Commit**

```bash
git add src/score/index.mjs tests/score/metadata-source.test.mjs
git commit -m "feat(score): parse --re-score flag (#76)"
```

---

## Task 4: `findEvaluationByUrl` helper + export

**Files:**
- Modify: `src/score/index.mjs`
- Test: `tests/score/score-batch.test.mjs` (append)

- [ ] **Step 1: Write failing test**

Append to `tests/score/score-batch.test.mjs`:

```javascript
import { findEvaluationByUrl } from '../../src/score/index.mjs';

test('findEvaluationByUrl — retourne l\'entrée quand l\'URL existe', () => {
  const tmp = mkTmp();
  const evalPath = path.join(tmp, 'data', 'evaluations.jsonl');
  fs.writeFileSync(
    evalPath,
    [
      JSON.stringify({ id: '001', url: 'https://a/1', score: 3 }),
      JSON.stringify({ id: '002', url: 'https://a/2', score: 4 }),
    ].join('\n') + '\n'
  );
  const hit = findEvaluationByUrl(evalPath, 'https://a/2');
  assert.equal(hit.id, '002');
  assert.equal(hit.score, 4);
});

test('findEvaluationByUrl — null quand l\'URL est absente', () => {
  const tmp = mkTmp();
  const evalPath = path.join(tmp, 'data', 'evaluations.jsonl');
  fs.writeFileSync(evalPath, JSON.stringify({ id: '001', url: 'https://a/1' }) + '\n');
  assert.equal(findEvaluationByUrl(evalPath, 'https://missing'), null);
});

test('findEvaluationByUrl — null quand le fichier n\'existe pas', () => {
  assert.equal(findEvaluationByUrl('/tmp/nonexistent-evals.jsonl', 'https://x'), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/score/score-batch.test.mjs`
Expected: FAIL on `findEvaluationByUrl is not a function` / import error.

- [ ] **Step 3: Implement and export `findEvaluationByUrl`**

In `src/score/index.mjs`, add after `getScoredUrls`:

```javascript
export function findEvaluationByUrl(evaluationsPath, url) {
  if (!fs.existsSync(evaluationsPath)) return null;
  const lines = fs.readFileSync(evaluationsPath, 'utf8').trim().split('\n').filter(Boolean);
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.url === url) return obj;
    } catch {}
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/score/score-batch.test.mjs`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/score/index.mjs tests/score/score-batch.test.mjs
git commit -m "feat(score): add findEvaluationByUrl helper (#76)"
```

---

## Task 5: Single-URL `--re-score` flow

**Files:**
- Modify: `src/score/index.mjs` (imports + `main`)
- Test: `tests/score/score-rescore.test.mjs` (new file)

- [ ] **Step 1: Create the failing integration test**

Create `tests/score/score-rescore.test.mjs`:

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const scoreBin = path.join(repoRoot, 'src/score/index.mjs');

function mkTmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'score-rescore-'));
  fs.mkdirSync(path.join(d, 'config'), { recursive: true });
  fs.mkdirSync(path.join(d, 'data', 'tracker-additions'), { recursive: true });
  fs.writeFileSync(path.join(d, 'config', 'cv.md'), '# CV\nDummy.\n');
  return d;
}

function writeOfferJson(dir, offer) {
  const p = path.join(dir, 'offer.json');
  fs.writeFileSync(p, JSON.stringify(offer));
  return p;
}

function runScore(args, tmp, extraEnv = {}) {
  return spawnSync('node', [scoreBin, ...args], {
    env: {
      ...process.env,
      CLAUDE_APPLY_CONFIG_DIR: path.join(tmp, 'config'),
      CLAUDE_APPLY_DATA_DIR: path.join(tmp, 'data'),
      ...extraEnv,
    },
    encoding: 'utf8',
  });
}

test('--re-score: URL absente de evaluations.jsonl → exit 2', () => {
  const tmp = mkTmp();
  const evalPath = path.join(tmp, 'data', 'evaluations.jsonl');
  fs.writeFileSync(
    evalPath,
    JSON.stringify({ id: '001', url: 'https://other/1', score: 3.0 }) + '\n'
  );
  const offerPath = writeOfferJson(tmp, { url: 'https://missing/1', body: 'x' });

  const proc = runScore(['--json-input', offerPath, '--re-score'], tmp);

  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /not found in .*evaluations\.jsonl/);
});

test('--re-score: URL présente → remplace la ligne, préserve l\'id, supprime l\'ancien TSV', () => {
  const tmp = mkTmp();
  const evalPath = path.join(tmp, 'data', 'evaluations.jsonl');
  const tsvDir = path.join(tmp, 'data', 'tracker-additions');

  fs.writeFileSync(
    evalPath,
    [
      JSON.stringify({
        id: '007',
        date: '2026-01-01',
        company: 'OldCo',
        role: 'Old Role',
        url: 'https://x/7',
        score: 2.0,
        verdict: 'skip',
        reason: 'old reason',
        status: 'Evaluated',
      }),
      JSON.stringify({ id: '008', url: 'https://x/8', score: 4.0 }),
    ].join('\n') + '\n'
  );
  fs.writeFileSync(path.join(tsvDir, '007-oldco.tsv'), 'old tsv\n');

  const offerPath = writeOfferJson(tmp, {
    url: 'https://x/7',
    finalUrl: 'https://x/7',
    status: 200,
    body: 'Full JD text. We are looking for a senior engineer.',
    company: 'NewCo',
    title: 'Senior Engineer',
    location: 'Paris',
    metadata_source: 'json-input',
  });

  const proc = runScore(['--json-input', offerPath, '--re-score'], tmp, {
    CLAUDE_APPLY_STUB_SCORE: '4.5',
    CLAUDE_APPLY_STUB_REASON: 'much better fit now',
  });

  assert.equal(proc.status, 0, `stderr: ${proc.stderr}`);
  const lines = fs
    .readFileSync(evalPath, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  const updated = lines.find((l) => l.url === 'https://x/7');
  assert.equal(updated.id, '007');
  assert.equal(updated.score, 4.5);
  assert.equal(updated.reason, 'much better fit now');
  assert.equal(updated.company, 'NewCo');
  assert.equal(updated.role, 'Senior Engineer');
  assert.notEqual(updated.date, '2026-01-01');
  assert.equal(fs.existsSync(path.join(tsvDir, '007-oldco.tsv')), false);
  const newTsvs = fs.readdirSync(tsvDir).filter((f) => f.startsWith('007-'));
  assert.equal(newTsvs.length, 1);
  assert.match(newTsvs[0], /^007-newco\.tsv$/);
});

test('--re-score + --id NNN: --id ignoré, id existant préservé (warning stderr)', () => {
  const tmp = mkTmp();
  const evalPath = path.join(tmp, 'data', 'evaluations.jsonl');
  fs.writeFileSync(
    evalPath,
    JSON.stringify({
      id: '005',
      url: 'https://x/5',
      company: 'C',
      role: 'R',
      score: 3,
    }) + '\n'
  );
  const offerPath = writeOfferJson(tmp, {
    url: 'https://x/5',
    body: 'jd',
    company: 'C',
    title: 'R',
  });

  const proc = runScore(['--json-input', offerPath, '--re-score', '--id', '999'], tmp, {
    CLAUDE_APPLY_STUB_SCORE: '3.5',
    CLAUDE_APPLY_STUB_REASON: 'ok',
  });

  assert.equal(proc.status, 0);
  assert.match(proc.stderr, /--id ignored.*preserving existing id 005/);
  const line = JSON.parse(fs.readFileSync(evalPath, 'utf8').trim());
  assert.equal(line.id, '005');
  assert.equal(line.score, 3.5);
});
```

Note: these tests rely on a `CLAUDE_APPLY_STUB_SCORE` / `_REASON` stub for `callClaudeAsync`. This stub will be added in the same task as part of the implementation.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/score/score-rescore.test.mjs`
Expected: all 3 tests FAIL (exit status mismatches, missing behaviour).

- [ ] **Step 3: Add the Claude stub for tests**

In `src/score/index.mjs`, modify `callClaudeAsync` so that when `process.env.CLAUDE_APPLY_STUB_SCORE` is set it short-circuits the spawn and returns a stub result. Add at the top of `callClaudeAsync` (before the `spawn` call):

```javascript
export function callClaudeAsync(system, user) {
  if (process.env.CLAUDE_APPLY_STUB_SCORE) {
    const score = parseFloat(process.env.CLAUDE_APPLY_STUB_SCORE);
    const reason = process.env.CLAUDE_APPLY_STUB_REASON || 'stubbed reason';
    return Promise.resolve(JSON.stringify({ score, reason }));
  }
  const emptyMcpPath = path.join(os.tmpdir(), 'claude-apply-empty-mcp.json');
  // ... rest unchanged
```

- [ ] **Step 4: Add imports for the new helpers**

At the top of `src/score/index.mjs`, update the imports so `updateJsonlEntry` and `findEvaluationByUrl` and `removeTrackerTsvById` are available:

```javascript
import { appendJsonl, appendFilteredOut, updateJsonlEntry } from '../lib/jsonl-writer.mjs';
import { writeTrackerTsv, removeTrackerTsvById } from '../lib/tsv-writer.mjs';
```

(`findEvaluationByUrl` is defined in this same file — no import needed.)

- [ ] **Step 5: Implement the single-URL re-score branch in `main()`**

In `src/score/index.mjs`, inside `main()`, after `requireConfig(...)` and `loadProfile(...)` calls in the **single-URL path** (i.e. after the `offer` is fully built and liveness has been checked), replace the final write block:

Find the block that looks like:

```javascript
  const evalPath = path.join(DATA_DIR, 'evaluations.jsonl');
  const id = flags.id || nextId(evalPath);
  const date = new Date().toISOString().slice(0, 10);
  const record = { /* ... */ };
  appendJsonl(evalPath, record);

  const tsvDir = path.join(DATA_DIR, 'tracker-additions');
  writeTrackerTsv(tsvDir, { /* ... */ });

  console.log(JSON.stringify(record));
```

Replace with:

```javascript
  const evalPath = path.join(DATA_DIR, 'evaluations.jsonl');
  const tsvDir = path.join(DATA_DIR, 'tracker-additions');
  const date = new Date().toISOString().slice(0, 10);

  let id;
  if (flags.reScore) {
    const existing = findEvaluationByUrl(evalPath, offer.url);
    if (!existing) {
      console.error(`--re-score: url not found in ${evalPath}: ${offer.url}`);
      process.exit(2);
    }
    if (flags.id) {
      console.error(`[re-score] --id ignored: preserving existing id ${existing.id}`);
    }
    id = existing.id;
  } else {
    id = flags.id || nextId(evalPath);
  }

  const record = {
    id,
    date,
    company: offer.company || 'unknown',
    role: offer.title || 'unknown',
    url: offer.url || '',
    location: offer.location ?? null,
    metadata_source: offer.metadata_source || 'unknown',
    score: scored.score,
    verdict,
    reason: scored.reason,
    status: 'Evaluated',
  };

  if (flags.reScore) {
    updateJsonlEntry(evalPath, (e) => e.url === record.url, record);
    removeTrackerTsvById(tsvDir, id);
  } else {
    appendJsonl(evalPath, record);
  }

  writeTrackerTsv(tsvDir, {
    num: id,
    date,
    company: record.company,
    role: record.role,
    score: scored.score,
    notes: scored.reason,
  });

  console.log(JSON.stringify(record));
```

Also: add a URL-not-found check **before** `detectClosedPage` and `callClaudeAsync` so we fail fast without spawning the CLI or hitting the network for a doomed run. Place this block right before the `const liveness = detectClosedPage(offer);` line in `main()`'s single-URL path (`offer.url` is always set at this point, regardless of json-input / fetch / from-pipeline / metadata-flags path):

```javascript
  if (flags.reScore) {
    const evalPathEarly = path.join(DATA_DIR, 'evaluations.jsonl');
    const existingEarly = findEvaluationByUrl(evalPathEarly, offer.url);
    if (!existingEarly) {
      console.error(`--re-score: url not found in ${evalPathEarly}: ${offer.url}`);
      process.exit(2);
    }
  }
```

The duplicate check later (when building `record`) can then be simplified to trust the existing entry is present — but keep a defensive `if (!existing)` fallback that throws rather than exits 2 (should be unreachable).

- [ ] **Step 6: Run the re-score tests to verify they pass**

Run: `node --test tests/score/score-rescore.test.mjs`
Expected: all 3 tests PASS.

- [ ] **Step 7: Run the full score test suite (no regression)**

Run: `node --test tests/score/**/*.test.mjs tests/lib/**/*.test.mjs`
Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add src/score/index.mjs tests/score/score-rescore.test.mjs
git commit -m "feat(score): --re-score single URL updates entry in place (#76)"
```

---

## Task 6: Single-URL `--re-score` preserves entry on closed page

**Files:**
- Modify: `src/score/index.mjs` (liveness branch in single-URL path)
- Test: `tests/score/score-rescore.test.mjs` (append)

- [ ] **Step 1: Write failing test**

Append to `tests/score/score-rescore.test.mjs`:

```javascript
test('--re-score: page closed → entry inchangée, pas d\'écriture filtered-out', () => {
  const tmp = mkTmp();
  const evalPath = path.join(tmp, 'data', 'evaluations.jsonl');
  const filteredPath = path.join(tmp, 'data', 'filtered-out.tsv');
  const tsvDir = path.join(tmp, 'data', 'tracker-additions');

  const original = {
    id: '011',
    date: '2026-01-01',
    company: 'C',
    role: 'R',
    url: 'https://x/11',
    score: 3.5,
    verdict: 'skip',
    reason: 'original',
    status: 'Evaluated',
  };
  fs.writeFileSync(evalPath, JSON.stringify(original) + '\n');
  fs.writeFileSync(path.join(tsvDir, '011-c.tsv'), 'original tsv\n');

  const offerPath = writeOfferJson(tmp, {
    url: 'https://x/11',
    finalUrl: 'https://x/11',
    status: 404,
    body: '',
  });

  const proc = runScore(['--json-input', offerPath, '--re-score'], tmp);

  assert.equal(proc.status, 0, `stderr: ${proc.stderr}`);
  assert.match(proc.stderr, /page closed.*keeping existing score/);
  const line = JSON.parse(fs.readFileSync(evalPath, 'utf8').trim());
  assert.deepEqual(line, original);
  assert.equal(fs.existsSync(filteredPath), false);
  assert.equal(fs.existsSync(path.join(tsvDir, '011-c.tsv')), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/score/score-rescore.test.mjs`
Expected: FAIL — current code writes to `filtered-out.tsv` regardless of re-score.

- [ ] **Step 3: Branch the liveness handler on `flags.reScore`**

In `src/score/index.mjs`, inside `main()`'s single-URL path, locate the block:

```javascript
  const liveness = detectClosedPage(offer);
  if (liveness.closed) {
    const date = new Date().toISOString().slice(0, 10);
    appendFilteredOut(path.join(DATA_DIR, 'filtered-out.tsv'), { /* ... */ });
    console.error(`[skip] page closed/broken — ${liveness.reason}`);
    console.log(JSON.stringify({ skipped: true, reason: liveness.reason, url: offer.url }));
    return;
  }
```

Replace with:

```javascript
  const liveness = detectClosedPage(offer);
  if (liveness.closed) {
    if (flags.reScore) {
      console.error(
        `[re-score] ${offer.url}: page closed (${liveness.reason}), keeping existing score`
      );
      console.log(
        JSON.stringify({ skipped: true, reason: liveness.reason, url: offer.url, kept: true })
      );
      return;
    }
    const date = new Date().toISOString().slice(0, 10);
    appendFilteredOut(path.join(DATA_DIR, 'filtered-out.tsv'), {
      date,
      url: offer.url || '',
      company: offer.company || 'unknown',
      title: offer.title || '',
      reason: `liveness: ${liveness.reason}`,
    });
    console.error(`[skip] page closed/broken — ${liveness.reason}`);
    console.log(JSON.stringify({ skipped: true, reason: liveness.reason, url: offer.url }));
    return;
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/score/score-rescore.test.mjs`
Expected: all re-score tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/score/index.mjs tests/score/score-rescore.test.mjs
git commit -m "feat(score): --re-score preserves entry when page closed (#76)"
```

---

## Task 7: `--batch --re-score` — mixed re-score + initial score

**Files:**
- Modify: `src/score/index.mjs` (batch branch in `main()`)
- Test: `tests/score/score-rescore.test.mjs` (append)

- [ ] **Step 1: Write failing test**

Append to `tests/score/score-rescore.test.mjs`:

```javascript
test('--batch --re-score: mélange re-score et score initial, progress distinct', () => {
  const tmp = mkTmp();
  const evalPath = path.join(tmp, 'data', 'evaluations.jsonl');
  const pipePath = path.join(tmp, 'data', 'pipeline.md');
  const tsvDir = path.join(tmp, 'data', 'tracker-additions');

  fs.writeFileSync(
    evalPath,
    [
      JSON.stringify({
        id: '001',
        date: '2026-01-01',
        company: 'Alpha',
        role: 'RoleA',
        url: 'https://a/1',
        score: 2.0,
        verdict: 'skip',
        reason: 'old',
        status: 'Evaluated',
      }),
      JSON.stringify({
        id: '002',
        date: '2026-01-01',
        company: 'Beta',
        role: 'RoleB',
        url: 'https://b/1',
        score: 3.0,
        verdict: 'skip',
        reason: 'old',
        status: 'Evaluated',
      }),
    ].join('\n') + '\n'
  );
  fs.writeFileSync(path.join(tsvDir, '001-alpha.tsv'), 'old a\n');
  fs.writeFileSync(path.join(tsvDir, '002-beta.tsv'), 'old b\n');
  fs.writeFileSync(
    pipePath,
    [
      '# Pipeline',
      '',
      '## Alpha (Paris)',
      '',
      '- [ ] https://a/1 | Alpha | RoleA',
      '',
      '## Beta (Paris)',
      '',
      '- [ ] https://b/1 | Beta | RoleB',
      '',
      '## Gamma (Paris)',
      '',
      '- [ ] https://c/1 | Gamma | RoleC',
      '',
    ].join('\n')
  );

  // Stub fetchOfferBody via a fake via --json-input is not wired for batch,
  // so the batch test uses the STUB_FETCH env var instead — see impl.
  const proc = runScore(['--batch', '--re-score', '--parallel', '1'], tmp, {
    CLAUDE_APPLY_STUB_SCORE: '4.0',
    CLAUDE_APPLY_STUB_REASON: 'refreshed',
    CLAUDE_APPLY_STUB_FETCH: '1',
  });

  assert.equal(proc.status, 0, `stderr: ${proc.stderr}`);
  const lines = fs
    .readFileSync(evalPath, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(lines.length, 3);

  const a = lines.find((l) => l.url === 'https://a/1');
  const b = lines.find((l) => l.url === 'https://b/1');
  const c = lines.find((l) => l.url === 'https://c/1');

  assert.equal(a.id, '001');
  assert.equal(a.score, 4.0);
  assert.equal(a.reason, 'refreshed');
  assert.equal(b.id, '002');
  assert.equal(b.score, 4.0);
  assert.equal(c.id, '003');
  assert.equal(c.score, 4.0);

  assert.match(proc.stderr, /↻.*Alpha/);
  assert.match(proc.stderr, /↻.*Beta/);
  assert.match(proc.stderr, /✓.*Gamma/);
  assert.match(proc.stderr, /2 re-scored, 1 scored/);

  assert.equal(fs.existsSync(path.join(tsvDir, '001-alpha.tsv')), false);
  assert.equal(fs.existsSync(path.join(tsvDir, '002-beta.tsv')), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/score/score-rescore.test.mjs`
Expected: FAIL — `--re-score` is unknown in batch flow; counts/progress format missing.

- [ ] **Step 3: Add `fetchOfferBody` stub behind env var**

In `src/score/index.mjs`, at the top of `fetchOfferBody`, short-circuit when the stub env var is set:

```javascript
async function fetchOfferBody(url) {
  if (process.env.CLAUDE_APPLY_STUB_FETCH) {
    return {
      finalUrl: url,
      status: 200,
      body: `Stub JD for ${url}. Senior Engineer role.`,
      scrapedTitle: 'Stub Title',
      scrapedCompany: '',
      scrapedLocation: '',
      ldJsonBlocks: [],
      ogLocation: '',
      cssLocation: '',
    };
  }
  const { chromium } = await import('playwright');
  // ... rest unchanged
```

- [ ] **Step 4: Implement the batch re-score logic**

In `src/score/index.mjs`, find the `if (flags.batch)` block in `main()`. Replace the `pending = allOffers.filter(...)` and id allocation section with re-score-aware code.

Near the start of the `if (flags.batch)` block:

```javascript
  if (flags.batch) {
    const pipelinePath = path.join(DATA_DIR, 'pipeline.md');
    const evalPath = path.join(DATA_DIR, 'evaluations.jsonl');

    const allOffers = getAllPipelineOffers(pipelinePath);
    const scored = getScoredUrls(evalPath);

    const pending = flags.reScore ? allOffers : allOffers.filter((o) => !scored.has(o.url));

    if (pending.length === 0) {
      console.error(
        flags.reScore
          ? '[batch] Nothing in pipeline.md to re-score.'
          : '[batch] Nothing to score — all offers already evaluated.'
      );
      return;
    }

    requireConfig(path.join(CONFIG_DIR, 'cv.md'));
    const { profile, cvMarkdown } = await loadProfile(CONFIG_DIR);

    let nextAvailId = parseInt(nextId(evalPath), 10);
    const writeLock = pLimit(1);
    const limit = pLimit(flags.parallel);
    const startTime = Date.now();

    let completed = 0;
    let countScored = 0;
    let countRescored = 0;
    let countFiltered = 0;
    let countKeptClosed = 0;
    let countError = 0;
    let countApply = 0;
    let countSkip = 0;

    console.error(
      `[batch] ${flags.reScore ? 'Re-scoring' : 'Scoring'} ${pending.length} offers (${flags.parallel} parallel workers)...`
    );
```

Then, inside the `tasks = pending.map(...)` loop, replace the existing closure with a version that branches on re-score vs new:

```javascript
    const tasks = pending.map((offer) => {
      return limit(async () => {
        try {
          const existing = flags.reScore ? findEvaluationByUrl(evalPath, offer.url) : null;
          const isRescore = !!existing;
          const fetched = await fetchOfferBody(offer.url);
          const extracted = extractLocation({
            ldJsonBlocks: fetched.ldJsonBlocks,
            ogLocation: fetched.ogLocation,
            cssLocation: fetched.cssLocation,
            bodyText: fetched.body,
          });
          const pipelineLoc = trimLoc(offer.location);
          const fullOffer = {
            ...offer,
            finalUrl: fetched.finalUrl,
            status: fetched.status,
            body: fetched.body,
            location: pipelineLoc || extracted.location,
            metadata_source: 'pipeline',
          };

          const liveness = detectClosedPage(fullOffer);
          if (liveness.closed) {
            if (isRescore) {
              completed++;
              countKeptClosed++;
              console.error(
                `[batch]  [${completed}/${pending.length}] ⊘ ${offer.company} — ${offer.title}`.padEnd(
                  60
                ) + ` kept (closed: ${liveness.reason})`
              );
              return null;
            }
            const date = new Date().toISOString().slice(0, 10);
            await writeLock(() =>
              appendFilteredOut(path.join(DATA_DIR, 'filtered-out.tsv'), {
                date,
                url: offer.url,
                company: offer.company || 'unknown',
                title: offer.title || '',
                reason: `liveness: ${liveness.reason}`,
              })
            );
            completed++;
            countFiltered++;
            console.error(formatProgress(completed, pending.length, offer, { skipped: true, reason: liveness.reason }));
            return null;
          }

          const { system, user } = buildPrompt({ cvMarkdown, offer: fullOffer, jdMaxTokens: 1500 });
          const raw = await callClaudeAsync(system, user);
          const scoredResult = parseScoreJson(raw);
          const verdict = computeVerdict(
            scoredResult.score,
            profile?.auto_apply_min_score ?? DEFAULT_AUTO_APPLY_MIN_SCORE
          );

          const date = new Date().toISOString().slice(0, 10);
          const tsvDir = path.join(DATA_DIR, 'tracker-additions');

          let id;
          await writeLock(() => {
            if (isRescore) {
              id = existing.id;
            } else {
              id = String(nextAvailId++).padStart(3, '0');
            }
          });

          const record = {
            id,
            date,
            company: fullOffer.company || 'unknown',
            role: fullOffer.title || 'unknown',
            url: fullOffer.url || '',
            location: fullOffer.location ?? null,
            metadata_source: 'pipeline',
            score: scoredResult.score,
            verdict,
            reason: scoredResult.reason,
            status: 'Evaluated',
          };

          await writeLock(() => {
            if (isRescore) {
              updateJsonlEntry(evalPath, (e) => e.url === record.url, record);
              removeTrackerTsvById(tsvDir, id);
            } else {
              appendJsonl(evalPath, record);
            }
            writeTrackerTsv(tsvDir, {
              num: id,
              date,
              company: record.company,
              role: record.role,
              score: scoredResult.score,
              notes: scoredResult.reason,
            });
          });

          completed++;
          if (isRescore) countRescored++;
          else countScored++;
          if (verdict === 'apply') countApply++;
          else countSkip++;
          const marker = isRescore ? '↻' : '✓';
          const label = `${offer.company} — ${offer.title}`;
          console.error(
            `[batch]  [${completed}/${pending.length}] ${marker} ${label.padEnd(45)} ${scoredResult.score} ${verdict}`
          );
          console.log(JSON.stringify(record));
          return record;
        } catch (err) {
          completed++;
          countError++;
          console.error(formatProgress(completed, pending.length, offer, { error: err.message }));
          return null;
        }
      });
    });

    await Promise.allSettled(tasks);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.error(
      `[batch] Done: ${countRescored} re-scored, ${countScored} scored, ${countFiltered} filtered, ${countKeptClosed} kept (closed), ${countError} error (${pending.length} total)`
    );
    console.error(`[batch] Results: ${countApply} apply, ${countSkip} skip`);
    console.error(`[batch] Time: ${elapsed}s (${flags.parallel} parallel workers)`);
    return;
  }
```

Keep `formatProgress` unchanged for error/filtered cases. The new `↻` / `✓` / `⊘` lines are inlined above because they need to distinguish the mode.

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/score/score-rescore.test.mjs`
Expected: all re-score tests PASS.

- [ ] **Step 6: Run the full test suite to verify no regressions**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/score/index.mjs tests/score/score-rescore.test.mjs
git commit -m "feat(score): --batch --re-score updates existing entries in place (#76)"
```

---

## Task 8: Update `/score` slash-command docs

**Files:**
- Modify: `.claude/commands/score.md`

- [ ] **Step 1: Add `--re-score` to the Flags list**

Edit `.claude/commands/score.md`, find the "## Flags" section. After the `--json-input` bullet, add:

```markdown
- `--re-score` — re-evaluate an offer already present in `data/evaluations.jsonl`. Preserves the existing `id`; refreshes `score`, `reason`, `date`, `verdict`, `company`, `role`, `location`. Compatible with single URL, `--from-pipeline`, and `--batch`. `--id` is ignored when `--re-score` is used.
```

- [ ] **Step 2: Add a "Re-scoring existing evaluations" section**

After the "## Batch mode" section in `.claude/commands/score.md`, append:

````markdown
## Re-scoring existing evaluations

Use `--re-score` after updating `config/cv.md`, changing the scoring prompt, or noticing a stale score. It re-fetches the page and rewrites the matching entry in `data/evaluations.jsonl` in place.

```bash
# Single URL (must already be in evaluations.jsonl)
node src/score/index.mjs <url> --re-score

# Preferred: pull metadata from pipeline.md
node src/score/index.mjs <url> --from-pipeline --re-score

# Batch: re-score every offer in pipeline.md.
# Already-scored offers are overwritten; offers not yet scored are scored for the first time.
node src/score/index.mjs --batch --re-score
```

Behaviour:
- The `id` of the existing entry is preserved so report links do not break.
- The old `data/tracker-additions/<id>-*.tsv` files are deleted before a new TSV is written.
- If the page is now closed/broken during a re-score, the existing entry is **kept** (not overwritten, not moved to `filtered-out.tsv`). A warning is logged.
- Single-URL re-score exits 2 if the URL is absent from `evaluations.jsonl`.
````

- [ ] **Step 3: Commit**

```bash
git add .claude/commands/score.md
git commit -m "docs(score): document --re-score flag (#76)"
```

---

## Task 9: Final verification + push

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all PASS.

- [ ] **Step 2: Run Prettier + PII check**

Run: `npm run lint && npm run check:pii`
Expected: both succeed.

- [ ] **Step 3: Verify git log is clean and conventional**

Run: `git log --oneline main..HEAD`
Expected: 7–8 commits, all `feat(...)` or `docs(...)` with `(#76)` suffix.

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin worktree-issue-76-rescore
gh pr create --title "feat(score): add --re-score flag to update existing evaluations (#76)" --body "$(cat <<'EOF'
## Summary
- Add `--re-score` flag to `src/score/index.mjs` for single URL and `--batch` modes
- In-place updates of `evaluations.jsonl` via new atomic `updateJsonlEntry` helper
- Refresh `tracker-additions/<id>-*.tsv` (glob-delete then rewrite) when slug changes
- Preserve existing `id`; ignore `--id` with a warning when re-scoring
- Keep existing entry intact when the page has become closed during a re-score
- Batch mode interleaves re-scores and initial scores based on presence in `evaluations.jsonl`

Closes #76.

## Test plan
- [ ] `npm test` passes
- [ ] `node --test tests/lib/jsonl-writer.test.mjs tests/lib/tsv-writer.test.mjs tests/score/score-rescore.test.mjs` passes
- [ ] Manual: single URL re-score with stubbed claude (STUB_SCORE env) updates the line
- [ ] Manual: `--batch --re-score` mix of scored and unscored offers works

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
