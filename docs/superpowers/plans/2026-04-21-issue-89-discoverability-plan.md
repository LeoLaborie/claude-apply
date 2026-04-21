# Issue #89 — Slash-command discoverability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the tools (`/explain`, `/dashboard`, `--dry-run`, flags) the user needs after `/scan` and during onboarding, and add `--help` to every slash command.

**Architecture:** Four additive deliverables — (L1) enrich the `/scan` summary footer; (L2) intercept `--help` / `-h` at the top of each node CLI before any I/O, plus a documented `--help` convention in `.claude/commands/apply.md`; (L3) link `docs/scan-workflow.md#title-filter` from `/scan`; (L4) rewrite the onboarding summary (`apply-onboard/setup.md`) with a `title_filter` recap, a `--dry-run --json` calibration preview, and the full command list.

**Tech Stack:** Node 20 ESM (`.mjs`), `node:test`, `node:child_process.spawnSync` for CLI integration tests. Zero new dependencies.

**Spec reference:** `docs/superpowers/specs/2026-04-21-issue-89-discoverability-design.md`.

**Deviation from spec noted during planning:** the spec's `/score --help` template listed only `--re-score` as a flag. The real `parseScoreArgs()` accepts many more (`--json-input`, `--id`, `--company`/`--role`/`--location`, `--from-pipeline`, `--batch`, `--parallel`). A `--help` that hides real flags is actively misleading, so Task 2b lists all of them. No spec change requested; flag for reviewer attention.

---

## File map

**Modify:**
- `src/scan/index.mjs` — add `printScanHelp()`, intercept `--help`/`-h` at top of `main()`, append `Next steps` block to `formatSummary()` (suppressed under `--json`).
- `src/score/index.mjs` — add `printScoreHelp()`, intercept at top of `main()`.
- `src/scan/explain.mjs` — add `printExplainHelp()`, intercept at top of `main()`.
- `src/dashboard/build.mjs` — add `printDashboardHelp()`, intercept inside the `import.meta.url === …` CLI guard.
- `.claude/commands/scan.md` — remove the `## Next step` section; add the `docs/scan-workflow.md#title-filter` pointer line in `## Interpreting the output`.
- `.claude/commands/apply.md` — add the `--help` preamble block (skill-level, not CLI).
- `.claude/commands/apply-onboard/setup.md` — step 2 (print `setup.sh --help` once), insert step 5.5 (dry-run calibration), rewrite step 6 (summary).
- `tests/scan/scan.test.mjs` — two new tests on `formatSummary` (with/without `--json`).
- `docs/testing.md` — one line in the E2E checklist.

**Create:**
- `tests/scan/scan-help.test.mjs`
- `tests/score/score-help.test.mjs`
- `tests/scan/explain-help.test.mjs`
- `tests/dashboard/dashboard-help.test.mjs`

---

## Task 1 — L1: `/scan` footer `Next steps` block

**Files:**
- Modify: `src/scan/index.mjs:311-360` (`formatSummary`)
- Modify: `src/scan/index.mjs` (`main()` — pass a `format` flag through so `--json` suppresses the block)
- Test: `tests/scan/scan.test.mjs` (append two new `test(...)` blocks at the end)

- [ ] **Step 1.1 — Write failing tests in `tests/scan/scan.test.mjs`**

Append these two tests at the very end of the file (after the last existing `test(...)` block):

```js
test('formatSummary — emits Next steps block in default path', () => {
  const result = {
    scanned: 2,
    eligibleTotal: 2,
    raw: 10,
    perCompany: [
      { company: 'mistral', platform: 'lever', rawCount: 5, afterFilterCount: 1, newCount: 1 },
      { company: 'anthropic', platform: 'greenhouse', rawCount: 5, afterFilterCount: 0, newCount: 0 },
    ],
    filtered: {
      skipped_dup: 0,
      skipped_title: 4,
      skipped_blacklist: 0,
      skipped_location: 0,
      skipped_date: 0,
    },
    added: [{ company: 'mistral', title: 'ML Engineer Intern' }],
    historyWrites: 1,
    filteredWrites: 4,
    errors: [],
  };
  const out = formatSummary(result, false);
  assert.match(out, /Next steps :/);
  assert.match(out, /\/score <url>/);
  assert.match(out, /\/explain/);
  assert.match(out, /\/dashboard/);
  assert.match(out, /\/scan --help/);
});

test('formatSummary — Next steps block is present even when nothing was added', () => {
  const result = {
    scanned: 1,
    eligibleTotal: 1,
    raw: 2359,
    perCompany: [
      { company: 'big-co', platform: 'greenhouse', rawCount: 2359, afterFilterCount: 0, newCount: 0 },
    ],
    filtered: {
      skipped_dup: 0,
      skipped_title: 2359,
      skipped_blacklist: 0,
      skipped_location: 0,
      skipped_date: 0,
    },
    added: [],
    historyWrites: 0,
    filteredWrites: 2359,
    errors: [],
  };
  const out = formatSummary(result, false);
  assert.match(out, /Next steps :/);
  assert.match(out, /\/explain/);
});
```

- [ ] **Step 1.2 — Run the new tests; expect failure**

```bash
node --test --test-name-pattern="Next steps" tests/scan/scan.test.mjs
```

Expected: both tests FAIL — the assertions on `/Next steps :/`, `/explain`, `/dashboard`, `/scan --help` do not yet appear in `formatSummary` output.

- [ ] **Step 1.3 — Implement the `Next steps` block in `formatSummary()`**

Open `src/scan/index.mjs`. Locate the current `formatSummary` function ending at the `return lines.join('\n');` on line 359. Insert the new block **before** `return lines.join('\n');`:

```js
  lines.push('');
  lines.push('Next steps :');
  lines.push('  /score <url>        # évalue une offre via LLM (data/evaluations.jsonl)');
  lines.push('  /explain "<title>"  # trace pourquoi une offre passe/échoue le filtre');
  lines.push('  /dashboard          # régénère dashboard.html');
  lines.push('');
  lines.push('Plus de flags : /scan --help  (--dry-run, --only <slug>, --json)');
```

- [ ] **Step 1.4 — Run the two tests; expect pass**

```bash
node --test --test-name-pattern="Next steps" tests/scan/scan.test.mjs
```

Expected: both PASS.

- [ ] **Step 1.5 — Run the two existing `formatSummary` tests to verify no regression**

```bash
node --test --test-name-pattern="formatSummary" tests/scan/scan.test.mjs
```

Expected: all `formatSummary` tests PASS (the two original + the two new).

- [ ] **Step 1.6 — Add test that `--json` path does NOT include the block**

Append at the end of `tests/scan/scan.test.mjs`:

```js
test('scan CLI --json — stdout is parseable JSON and contains no Next steps block', () => {
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-json-'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-json-data-'));
  fs.writeFileSync(
    path.join(cfgDir, 'portals.yml'),
    'tracked_companies: []\ntitle_filter:\n  required_any: []\n  excluded_any: []\n',
  );
  fs.writeFileSync(
    path.join(cfgDir, 'candidate-profile.yml'),
    'target_locations: [Paris]\nblacklist: []\nmin_start_date: 2026-01-01\n',
  );

  try {
    const res = spawnSync(
      process.execPath,
      [path.resolve('src/scan/index.mjs'), '--dry-run', '--json'],
      {
        env: {
          ...process.env,
          CLAUDE_APPLY_CONFIG_DIR: cfgDir,
          CLAUDE_APPLY_DATA_DIR: dataDir,
        },
        encoding: 'utf8',
      },
    );
    assert.equal(res.status, 0, `stderr=${res.stderr}`);
    assert.doesNotMatch(res.stdout, /Next steps/);
    const parsed = JSON.parse(res.stdout);
    assert.ok(typeof parsed === 'object' && parsed !== null);
  } finally {
    fs.rmSync(cfgDir, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
```

If `spawnSync`, `fs`, `os`, `path` are not yet imported at the top of `tests/scan/scan.test.mjs`, add the imports. Check the first ~10 lines of the file; copy the style used by the existing `scan CLI — missing candidate-profile.yml` test at line 578, which already imports these.

- [ ] **Step 1.7 — Run the new test; expect pass**

```bash
node --test --test-name-pattern="Next steps block" tests/scan/scan.test.mjs
```

The current `formatSummary` call is unconditional in `main()`, but the `--json` branch emits JSON instead (see existing behavior around line 414 — search for `--json`). Verify: when the current behavior under `--json` is to bypass `formatSummary` and output only JSON, the test passes without any further change because `formatSummary` is never called. Otherwise, wire the suppression explicitly. To confirm, read `src/scan/index.mjs` around lines 400–420:

```bash
grep -n "asJson\|--json\|formatSummary" src/scan/index.mjs
```

If the `--json` path still calls `formatSummary`, wrap the Next-steps block with a guard: accept a third arg `{ includeNextSteps = true } = {}` in `formatSummary`, skip the block when false, and set the option to false in the `--json` branch in `main()`. Update the Step 1.3 code to honor the flag.

Expected after all fixes: the new test PASSES.

- [ ] **Step 1.8 — Remove the `## Next step` section in `.claude/commands/scan.md`**

Open `.claude/commands/scan.md` and delete the last section (lines 55–57):

```
## Next step

Once `data/pipeline.md` has new rows, run `/score <url>` on each to get an LLM evaluation.
```

No replacement — the CLI footer is now the single source of truth.

- [ ] **Step 1.9 — Commit**

```bash
git add src/scan/index.mjs tests/scan/scan.test.mjs .claude/commands/scan.md
git commit -m "feat(scan): surface /explain, /dashboard, and flag hints in summary footer"
```

---

## Task 2a — L2: `--help` for `/scan`

**Files:**
- Modify: `src/scan/index.mjs` (`printScanHelp()` + early intercept in `main()`)
- Create: `tests/scan/scan-help.test.mjs`

- [ ] **Step 2a.1 — Write failing test in `tests/scan/scan-help.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '..', '..', 'src', 'scan', 'index.mjs');

for (const flag of ['--help', '-h']) {
  test(`/scan ${flag} exits 0 and prints usage — works without config`, () => {
    // Deliberately point at empty dirs so config guard would fail if reached.
    const res = spawnSync(process.execPath, [SCRIPT, flag], {
      env: {
        ...process.env,
        CLAUDE_APPLY_CONFIG_DIR: '/nonexistent/cfg',
        CLAUDE_APPLY_DATA_DIR: '/nonexistent/data',
      },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, `stderr=${res.stderr} stdout=${res.stdout}`);
    assert.match(res.stdout, /^Usage: \/scan/m);
    assert.match(res.stdout, /--dry-run/);
    assert.match(res.stdout, /--only <slug>/);
    assert.match(res.stdout, /--json/);
    assert.match(res.stdout, /docs\/scan-workflow\.md/);
    assert.match(res.stdout, /See also:/);
  });
}
```

- [ ] **Step 2a.2 — Run the test; expect failure**

```bash
node --test tests/scan/scan-help.test.mjs
```

Expected: FAIL — `--help` is not intercepted; either the script attempts to `requireConfig` and exits with 2, or it proceeds to fail for another reason.

- [ ] **Step 2a.3 — Add `printScanHelp()` and the early intercept**

Open `src/scan/index.mjs`. Just above the `async function main() {` declaration (currently around line 362), add:

```js
function printScanHelp() {
  console.log(`Usage: /scan [--dry-run] [--only <slug>] [--json]

Scan enabled ATS portals and append new offers to data/pipeline.md.

Flags:
  --dry-run         Compute everything, write nothing.
  --only <slug>     Scan a single company by ATS slug (e.g. mistral).
  --json            Emit machine-readable output to stdout.
  --help, -h        Show this help and exit.

Files:
  reads:  config/portals.yml, config/candidate-profile.yml
  writes: data/pipeline.md, data/scan-history.tsv, data/filtered-out.tsv

See also: /explain, /dashboard
          docs/scan-workflow.md  (title_filter format, per-company overrides)`);
}
```

Inside `async function main()` as the **first two lines** of the body (before `const args = process.argv.slice(2);`):

```js
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printScanHelp();
    process.exit(0);
  }
```

If `const args = …` already exists on the first line of `main()`, merge: keep one declaration, add only the `if (...) { … }` right after it.

- [ ] **Step 2a.4 — Run the test; expect pass**

```bash
node --test tests/scan/scan-help.test.mjs
```

Expected: both `--help` and `-h` tests PASS.

- [ ] **Step 2a.5 — Commit**

```bash
git add src/scan/index.mjs tests/scan/scan-help.test.mjs
git commit -m "feat(scan): add --help / -h flag with Usage / Flags / Files / See also"
```

---

## Task 2b — L2: `--help` for `/score`

**Files:**
- Modify: `src/score/index.mjs` (`printScoreHelp()` + early intercept in `main()` at line 386)
- Create: `tests/score/score-help.test.mjs`

- [ ] **Step 2b.1 — Write failing test in `tests/score/score-help.test.mjs`**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '..', '..', 'src', 'score', 'index.mjs');

for (const flag of ['--help', '-h']) {
  test(`/score ${flag} exits 0 and prints usage — works without config`, () => {
    const res = spawnSync(process.execPath, [SCRIPT, flag], {
      env: {
        ...process.env,
        CLAUDE_APPLY_CONFIG_DIR: '/nonexistent/cfg',
        CLAUDE_APPLY_DATA_DIR: '/nonexistent/data',
      },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, `stderr=${res.stderr} stdout=${res.stdout}`);
    assert.match(res.stdout, /^Usage: \/score/m);
    assert.match(res.stdout, /--re-score/);
    assert.match(res.stdout, /--batch/);
    assert.match(res.stdout, /--from-pipeline/);
    assert.match(res.stdout, /docs\/score-workflow\.md/);
  });
}
```

- [ ] **Step 2b.2 — Run the test; expect failure**

```bash
node --test tests/score/score-help.test.mjs
```

Expected: FAIL — exit 2 (usage error from `parseScoreArgs`) or 3.

- [ ] **Step 2b.3 — Add `printScoreHelp()` and the early intercept**

Open `src/score/index.mjs`. Above `async function main()` (line 386), add:

```js
function printScoreHelp() {
  console.log(`Usage: /score <url> [options]
       /score --from-pipeline [--batch] [--parallel <n>]
       /score --json-input <path>

LLM-evaluate one or more offers against config/cv.md.

Flags:
  --re-score             Re-evaluate a URL already in evaluations.jsonl
                         (preserves the existing id).
  --batch                Score multiple offers from data/pipeline.md.
  --parallel <n>         With --batch, run <n> evaluations concurrently.
                         Implies --batch. Default: 5.
  --from-pipeline        Take the offer URL from data/pipeline.md.
  --json-input <path>    Read a pre-built offer JSON instead of fetching.
  --id <id>              Override the generated id for this entry.
  --company <name>       With --role and --location, override offer metadata
                         (all three required together).
  --role <title>         (see --company)
  --location <loc>       (see --company)
  --help, -h             Show this help and exit.

Files:
  reads:  config/cv.md, config/candidate-profile.yml
  writes: data/evaluations.jsonl  (one JSON line per invocation)

See also: /explain, /dashboard
          docs/score-workflow.md`);
}
```

Inside `main()`, as the **first lines** of the body (before the `const CONFIG_DIR = …` lines):

```js
  if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
    printScoreHelp();
    process.exit(0);
  }
```

- [ ] **Step 2b.4 — Run the test; expect pass**

```bash
node --test tests/score/score-help.test.mjs
```

Expected: both tests PASS.

- [ ] **Step 2b.5 — Commit**

```bash
git add src/score/index.mjs tests/score/score-help.test.mjs
git commit -m "feat(score): add --help / -h flag listing all supported options"
```

---

## Task 2c — L2: `--help` for `/explain`

**Files:**
- Modify: `src/scan/explain.mjs` (`printExplainHelp()` + early intercept in `main()` at line 107)
- Create: `tests/scan/explain-help.test.mjs`

- [ ] **Step 2c.1 — Write failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '..', '..', 'src', 'scan', 'explain.mjs');

for (const flag of ['--help', '-h']) {
  test(`/explain ${flag} exits 0 and prints usage — works without config`, () => {
    const res = spawnSync(process.execPath, [SCRIPT, flag], {
      env: {
        ...process.env,
        CLAUDE_APPLY_CONFIG_DIR: '/nonexistent/cfg',
      },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, `stderr=${res.stderr} stdout=${res.stdout}`);
    assert.match(res.stdout, /^Usage: \/explain/m);
    assert.match(res.stdout, /--company <name>/);
    assert.match(res.stdout, /--location <loc>/);
    assert.match(res.stdout, /Exit codes/);
    assert.match(res.stdout, /title-filter/);
  });
}
```

- [ ] **Step 2c.2 — Run the test; expect failure**

```bash
node --test tests/scan/explain-help.test.mjs
```

Expected: FAIL — currently exit 2 because `parseArgs` treats `--help` as a missing-title usage error.

- [ ] **Step 2c.3 — Add `printExplainHelp()` and the early intercept**

Open `src/scan/explain.mjs`. Just above `function main()` (line 107), add:

```js
function printExplainHelp() {
  console.log(`Usage: /explain "<title>" [--company <name>] [--location <loc>]

Trace which prefilter rule accepts or rejects a given title.

Flags:
  --company <name>    Apply blacklist check against this company.
  --location <loc>    Apply location check against this string.
  --help, -h          Show this help and exit.

Files:
  reads:  config/portals.yml, config/candidate-profile.yml
  writes: (nothing)

Exit codes: 0 = ACCEPTED, 1 = REJECTED, 2 = usage error.

See also: /scan
          docs/scan-workflow.md#title-filter`);
}
```

Inside `main()` (line 107), as the **first lines**:

```js
function main() {
  if (process.argv.slice(2).some((a) => a === '--help' || a === '-h')) {
    printExplainHelp();
    process.exit(0);
  }
  const parsed = parseArgs(process.argv);
  // ... existing body unchanged
```

- [ ] **Step 2c.4 — Run the test; expect pass**

```bash
node --test tests/scan/explain-help.test.mjs
```

Expected: both tests PASS.

- [ ] **Step 2c.5 — Commit**

```bash
git add src/scan/explain.mjs tests/scan/explain-help.test.mjs
git commit -m "feat(explain): add --help / -h flag"
```

---

## Task 2d — L2: `--help` for `/dashboard`

**Files:**
- Modify: `src/dashboard/build.mjs` (`printDashboardHelp()` + early intercept inside the CLI guard at line 321)
- Create: `tests/dashboard/dashboard-help.test.mjs`

- [ ] **Step 2d.1 — Write failing test**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '..', '..', 'src', 'dashboard', 'build.mjs');

for (const flag of ['--help', '-h']) {
  test(`/dashboard ${flag} exits 0 and prints usage — works without data`, () => {
    const res = spawnSync(process.execPath, [SCRIPT, flag], {
      env: {
        ...process.env,
        CLAUDE_APPLY_DATA_DIR: '/nonexistent/data',
        CLAUDE_APPLY_REPORTS_DIR: '/nonexistent/reports',
      },
      encoding: 'utf8',
    });
    assert.equal(res.status, 0, `stderr=${res.stderr} stdout=${res.stdout}`);
    assert.match(res.stdout, /^Usage: \/dashboard/m);
    assert.match(res.stdout, /dashboard\.html/);
    assert.match(res.stdout, /See also:/);
  });
}
```

- [ ] **Step 2d.2 — Run the test; expect failure**

```bash
node --test tests/dashboard/dashboard-help.test.mjs
```

Expected: FAIL — the script tries to read `data/` and crashes.

- [ ] **Step 2d.3 — Add `printDashboardHelp()` and the intercept inside the CLI guard**

Open `src/dashboard/build.mjs`. Just above the `// CLI guard — run directly as a script` comment (line 320), add:

```js
function printDashboardHelp() {
  console.log(`Usage: /dashboard

Regenerate dashboard.html from data/ and reports/.

Flags:
  --help, -h    Show this help and exit.

Files:
  reads:  data/pipeline.md, data/evaluations.jsonl, data/applications.md,
          data/apply-log.jsonl, reports/
  writes: dashboard.html  (at repo root)

See also: /scan, /score`);
}
```

Replace the current `if (import.meta.url === ...) { ... }` guard body so the help intercept runs **before** any `buildDashboard` call. Modified guard:

```js
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printDashboardHelp();
    process.exit(0);
  }
  const dataDir = process.env.CLAUDE_APPLY_DATA_DIR || './data';
  const reportsDir = process.env.CLAUDE_APPLY_REPORTS_DIR || './reports';
  await buildDashboard({
    applicationsPath: `${dataDir}/applications.md`,
    reportsDir,
    evaluationsPath: `${dataDir}/evaluations.jsonl`,
    filteredOutPath: `${dataDir}/filtered-out.tsv`,
    outputPath: './dashboard.html',
    // ... preserve any existing properties unchanged
  });
}
```

Preserve any other fields already passed to `buildDashboard` (re-read lines 321–340 before editing).

- [ ] **Step 2d.4 — Run the test; expect pass**

```bash
node --test tests/dashboard/dashboard-help.test.mjs
```

Expected: both tests PASS.

- [ ] **Step 2d.5 — Commit**

```bash
git add src/dashboard/build.mjs tests/dashboard/dashboard-help.test.mjs
git commit -m "feat(dashboard): add --help / -h flag"
```

---

## Task 2e — L2: `--help` preamble for `/apply` (skill, not CLI)

**Files:**
- Modify: `.claude/commands/apply.md`

- [ ] **Step 2e.1 — Read the current `apply.md` to find the right insertion point**

```bash
head -20 .claude/commands/apply.md
```

Note the frontmatter block (`---` … `---`) and the first `#` heading. The preamble must be inserted **between** them.

- [ ] **Step 2e.2 — Insert the `--help` preamble**

Immediately after the closing `---` of the frontmatter and before the first heading, insert the following block (plain markdown, no extra frontmatter):

```markdown
## `--help` / `-h`

**Si `$ARGUMENTS` commence par `--help` ou `-h`, imprime uniquement le bloc ci-dessous et arrête-toi. N'ouvre pas Chrome, ne lis aucun fichier de `config/` ou `data/`.**

```
Usage: /apply <url>

Open the URL in Chrome (CDP on port 9222), classify the form,
fill from config/candidate-profile.yml, upload the CV, submit,
and update data/applications.md + data/apply-log.jsonl.

Stops and asks the user on: captcha, login wall,
unknown required field.

Prerequisites:
  - chrome-apply alias launched (CDP port 9222 up)
  - claude-in-chrome extension installed with host permissions

Files:
  reads:  config/candidate-profile.yml, config/cv.<lang>.pdf
  writes: data/applications.md, data/apply-log.jsonl

See also: /scan, /score, /dashboard
          docs/apply-workflow.md, docs/cdp-setup.md
```
```

Note the double-backtick nesting: the outer code fence in the spec is just for presentation. In `apply.md`, use triple-backticks around the `Usage:` block, and prose above it.

- [ ] **Step 2e.3 — Manual verification**

Not unit-testable (skill, not CLI). In a fresh Claude Code session, type `/apply --help`. Confirm that the block is printed and no browser tool is invoked. Record the result in the commit body if anything is off.

- [ ] **Step 2e.4 — Commit**

```bash
git add .claude/commands/apply.md
git commit -m "docs(apply): document --help / -h skill preamble for /apply"
```

---

## Task 3 — L3: link `title_filter` docs from `scan.md`

**Files:**
- Modify: `.claude/commands/scan.md` (append one line in `## Interpreting the output`)

- [ ] **Step 3.1 — Add the pointer line**

Open `.claude/commands/scan.md`. In the `## Interpreting the output` section, after the paragraph ending with `Group B (custom career pages) companies are skipped silently.` (currently line 53), append one blank line and one pointer line:

```markdown

Pour comprendre en détail comment `title_filter` rejette une offre, voir [`docs/scan-workflow.md#title-filter`](../../docs/scan-workflow.md#title-filter) ou lance `/explain "<titre>"`.
```

Verify the relative path `../../docs/scan-workflow.md` is correct from `.claude/commands/scan.md`:

```bash
ls -la .claude/commands/scan.md docs/scan-workflow.md
```

Both must exist at those paths.

- [ ] **Step 3.2 — Commit**

```bash
git add .claude/commands/scan.md
git commit -m "docs(scan): link title_filter reference from /scan command page"
```

---

## Task 4a — L4: print `setup.sh --help` once in onboarding step 2

**Files:**
- Modify: `.claude/commands/apply-onboard/setup.md` (step 2)

- [ ] **Step 4a.1 — Locate step 2**

The current step 2 is around lines 23–34 of `.claude/commands/apply-onboard/setup.md`. It reads:

```markdown
## 2. Run `scripts/setup.sh`

Run one of:

    bash scripts/setup.sh --yes --clone-chrome-profile       # if user said yes
    bash scripts/setup.sh --yes --no-clone-chrome-profile    # if user said no

This will: install npm deps if missing (`npm ci` / `npm install`), create the CDP Chrome profile (empty or cloned), append the `chrome-apply` alias to the user's shell rc (with a timestamped backup), and copy any missing templates into `config/` (harmless — `cv.md`, `candidate-profile.yml`, and `portals.yml` already exist from the earlier phases and are skipped).

If the user is in an unusual shell setup, add `--no-rc` and print the alias to them manually. Run `bash scripts/setup.sh --help` for all flags.
```

- [ ] **Step 4a.2 — Rewrite step 2 to instruct Claude to print `--help` first**

Replace the whole step 2 block with:

```markdown
## 2. Run `scripts/setup.sh`

**First, print the script's usage once** so the user discovers flags like `--no-clone-chrome-profile` and `--no-rc`:

    bash scripts/setup.sh --help

Print the captured output verbatim, prefaced by one short line:

> "Voici les flags supportés par le script (affichés une fois pour que tu saches ce qui est disponible) — je vais maintenant lancer le setup avec les flags correspondant à ton choix clone-chrome-profile."

Then run one of:

    bash scripts/setup.sh --yes --clone-chrome-profile       # if user said yes
    bash scripts/setup.sh --yes --no-clone-chrome-profile    # if user said no

This will: install npm deps if missing (`npm ci` / `npm install`), create the CDP Chrome profile (empty or cloned), append the `chrome-apply` alias to the user's shell rc (with a timestamped backup), and copy any missing templates into `config/` (harmless — `cv.md`, `candidate-profile.yml`, and `portals.yml` already exist from the earlier phases and are skipped).

If the user is in an unusual shell setup, add `--no-rc` and print the alias to them manually.
```

(Use four-space indentation for the fenced commands, as shown, to match the existing style.)

- [ ] **Step 4a.3 — Commit**

```bash
git add .claude/commands/apply-onboard/setup.md
git commit -m "docs(onboard): print setup.sh --help once in step 2 for flag discoverability"
```

---

## Task 4b — L4: new step 5.5 (dry-run calibration)

**Files:**
- Modify: `.claude/commands/apply-onboard/setup.md` (insert new step between current steps 5 and 6)

- [ ] **Step 4b.1 — Insert the new step**

In `.claude/commands/apply-onboard/setup.md`, immediately after the current step 5 block (which ends at the line `**Wait for the user to confirm permissions are granted** before continuing.`) and before `## 6. Final summary`, insert:

````markdown
## 5.5. Calibration dry-run (best-effort)

Before printing the final summary, run a `/scan --dry-run --json` to give the user a realistic preview of what their first real scan will yield. The extension is not required for this step.

```bash
node src/scan/index.mjs --dry-run --json
```

Parse the JSON to extract:

- `result.raw` — total raw offers across all companies
- `result.added.length` — number of offers that would survive all filters
- `result.perCompany.filter(c => c.newCount > 0)` — companies with at least one hit, sorted descending by `newCount`, top 3

Cache these three values (or a single "skipped" flag on failure) so step 6 can reference them.

**Failure mode (network error, ATS outage, any non-zero exit):** do **not** block onboarding. Set an internal "dry-run skipped" flag and let step 6 fall back to the "skipped" message. The user will still have a working install.
````

- [ ] **Step 4b.2 — Commit**

```bash
git add .claude/commands/apply-onboard/setup.md
git commit -m "docs(onboard): add step 5.5 dry-run calibration before final summary"
```

---

## Task 4c — L4: rewrite step 6 final summary

**Files:**
- Modify: `.claude/commands/apply-onboard/setup.md` (replace step 6 block)

- [ ] **Step 4c.1 — Replace step 6**

Open `.claude/commands/apply-onboard/setup.md`. Locate the `## 6. Final summary` section (currently lines 109–135). Replace the entire section with:

````markdown
## 6. Final summary

Read `config/portals.yml` once to extract `title_filter.required_any` and `title_filter.excluded_any`. Use the dry-run values cached in step 5.5 (or the "skipped" flag).

Print the following summary, substituting values where marked:

```
✅ Onboarding complete.

Files written:
  • config/cv.md
  • config/cv.<lang>.pdf
  • config/candidate-profile.yml
  • config/portals.yml  (<N> companies)

Your title_filter:
  required_any  : <comma-separated list from portals.yml, or "(none)">
  excluded_any  : <comma-separated list from portals.yml, or "(none)">
  (source: config/portals.yml — edit there to re-tune,
   or run /explain "<title>" to debug one title)

First scan preview (dry-run):
  <A> new offers after filter (from <R> raw).
  Top hits: <company1> (<n1>), <company2> (<n2>), <company3> (<n3>).
  → If 0 hits: your required_any is probably too strict.
    Run /explain "<one of your target titles>" to trace it,
    then edit config/portals.yml and re-run /scan.

Chrome launched in CDP mode (port 9222) with the
claude-in-chrome extension page open.

One last manual step:
  → Click "Add to Chrome" on the page that just opened,
    then confirm the install dialog.

Then you can run:
  /scan                # fetch new offers into data/pipeline.md
  /score <url>         # LLM-evaluate an offer
  /apply <url>         # automated form fill + submit
  /explain "<title>"   # debug why a title passes/fails the filter
  /dashboard           # regenerate dashboard.html

Tip: append --help to any command (e.g. /scan --help) to see its flags.
```

**Fallback when step 5.5 was skipped:** replace the "First scan preview" block with exactly:

```
First scan preview (dry-run):
  (skipped — network issue during dry-run; run /scan --dry-run when ready.)
```

**Fallback when `raw === 0` across all companies** (likely ATS outage or empty `portals.yml`): replace the block with:

```
First scan preview (dry-run):
  0 raw offers — likely an ATS outage or an empty portals.yml.
  Run /scan after the extension install to retry.
```

**Fallback when `title_filter` is absent from `portals.yml`:** print `(none — every title accepted)` for both `required_any` and `excluded_any`.

**Do not run `/scan` or `/apply` yourself** — the user still needs to install the extension manually. Your onboarding stops here.
````

- [ ] **Step 4c.2 — Commit**

```bash
git add .claude/commands/apply-onboard/setup.md
git commit -m "docs(onboard): rewrite step 6 summary with title_filter recap and dry-run preview"
```

---

## Task 5 — E2E checklist entry

**Files:**
- Modify: `docs/testing.md`

- [ ] **Step 5.1 — Add the checklist line**

Open `docs/testing.md`. Find the E2E section (likely headed `## E2E` or `## Manual testing`). Append one line:

```markdown
- `/apply-onboard` final summary shows the `Your title_filter` block and either a `First scan preview` (with raw + added counts) or the graceful "skipped" fallback when the dry-run fails.
```

If there is no E2E section, add the line at the end of the file under a new `## E2E onboarding` heading.

- [ ] **Step 5.2 — Commit**

```bash
git add docs/testing.md
git commit -m "docs(testing): add onboarding summary to E2E checklist"
```

---

## Task 6 — Full test suite + lint

- [ ] **Step 6.1 — Run the full suite**

```bash
npm test
```

Expected: all tests PASS. The five new test files (`scan-help`, `score-help`, `explain-help`, `dashboard-help`, plus the two appended `Next steps` tests in `scan.test.mjs`) contribute ~8 new passing tests. No existing test should regress.

- [ ] **Step 6.2 — Run lint and format**

```bash
npm run lint
npm run format
```

Expected: lint PASS, format no-op (or commit any whitespace corrections separately).

- [ ] **Step 6.3 — Run the PII gate locally**

```bash
npm run check:pii
```

Expected: PASS — none of the new content contains PII (all examples use placeholder titles like `"<title>"` and generic company names).

- [ ] **Step 6.4 — Commit formatting fixes if any**

```bash
git status
# If prettier reformatted anything:
git add -A
git commit -m "style: prettier"
```

---

## Task 7 — Manual smoke test

- [ ] **Step 7.1 — Smoke-test each `--help`**

```bash
node src/scan/index.mjs --help
node src/score/index.mjs --help
node src/scan/explain.mjs --help
node src/dashboard/build.mjs --help
```

For each: verify exit code 0 (`echo $?`) and that the `Usage:` / `Flags:` / `Files:` / `See also:` blocks appear.

- [ ] **Step 7.2 — Smoke-test the `/scan` footer**

```bash
node src/scan/index.mjs --dry-run
```

Verify the tail of the output contains the `Next steps :` block with `/score`, `/explain`, `/dashboard`, and the `Plus de flags : /scan --help` line.

- [ ] **Step 7.3 — Smoke-test `/scan --json`**

```bash
node src/scan/index.mjs --dry-run --json | tail -5
```

Verify the output ends with a JSON closing `}` and contains **no** `Next steps` text.

```bash
node src/scan/index.mjs --dry-run --json | python3 -m json.tool > /dev/null
```

Expected: exit 0 (parseable JSON).

- [ ] **Step 7.4 — Open a PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat(discoverability): surface /explain, /dashboard, flags, and --help (issue #89)" --body "$(cat <<'EOF'
## Summary

Addresses all seven discoverability gaps from issue #89 in one bundled PR:

- **L1** `/scan` summary footer now lists `/score`, `/explain`, `/dashboard` and the flag hint (items 1, 5). Removed the obsolete `## Next step` section in `scan.md`.
- **L2** `--help` / `-h` on every CLI entry point (`/scan`, `/score`, `/explain`, `/dashboard`) + documented preamble in `apply.md` (item 7). Works without config.
- **L3** Linked `docs/scan-workflow.md#title-filter` from `.claude/commands/scan.md` and from `/scan --help` See-also (item 3).
- **L4** Onboarding: step 2 prints `setup.sh --help` once (item 2); new step 5.5 runs `/scan --dry-run --json` for a calibration preview; step 6 summary now shows `Your title_filter`, a `First scan preview`, and the full command list including `/explain` and `/dashboard` (items 4, 6).

Spec: `docs/superpowers/specs/2026-04-21-issue-89-discoverability-design.md`.

## Test plan

- [x] Unit: `formatSummary` emits/skips the `Next steps` block as expected.
- [x] Unit: each of the 4 CLIs exits 0 on `--help` and `-h` with no config present.
- [x] Unit: `/scan --dry-run --json` stdout is parseable JSON without the `Next steps` text.
- [ ] Manual: `/apply --help` prints the skill preamble without opening Chrome.
- [ ] Manual: fresh `/apply-onboard` run shows the new summary with the dry-run preview.

Closes #89.
EOF
)"
```

Expected: PR URL returned. Print it to the user.

---

## Self-review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| L1 `formatSummary` Next steps block | Task 1 steps 1.1–1.9 |
| L1 suppression under `--json` | Task 1 steps 1.6–1.7 |
| L1 remove `## Next step` in `scan.md` | Task 1 step 1.8 |
| L2 `/scan --help` | Task 2a |
| L2 `/score --help` | Task 2b |
| L2 `/explain --help` | Task 2c |
| L2 `/dashboard --help` | Task 2d |
| L2 `/apply --help` preamble | Task 2e |
| L3 `scan.md` pointer line | Task 3 |
| L4 print `setup.sh --help` | Task 4a |
| L4 dry-run calibration step | Task 4b |
| L4 rewritten summary with fallbacks | Task 4c |
| E2E checklist addition | Task 5 |

All thirteen items mapped.

**Placeholder scan:** none. Every code/text block is complete. Fallback text is explicit. Commands are copy-pasteable.

**Type consistency:** `formatSummary(result, dryRun)` keeps its existing signature; the `--json` suppression is implemented via a conditional call site in `main()`, not a third argument, matching the current `export function formatSummary(result, dryRun)` line. If the implementation in step 1.7 discovers that `formatSummary` IS called under `--json`, the plan explicitly instructs adding an options argument — that is the one branch in the plan, and both variants are spelled out.

**One known deviation from the spec (flagged in the plan header):** `/score --help` lists all real flags (`--batch`, `--parallel`, `--from-pipeline`, `--json-input`, `--id`, `--company`/`--role`/`--location`) in addition to the `--re-score` called out by the spec. Rationale: a `--help` that hides existing flags is worse than no `--help`. No spec change needed; reviewer can challenge during PR review.
