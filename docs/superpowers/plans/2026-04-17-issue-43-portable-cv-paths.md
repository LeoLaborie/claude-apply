# Portable CV paths (issue #43) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `config/candidate-profile.yml` portable across machines by writing repo-relative paths and resolving them against the repo root inside `loadProfile`.

**Architecture:** A new `src/lib/repo-root.mjs` module locates the repo root via `git rev-parse --show-toplevel` with a `.git`-walk fallback. `loadProfile(configDir, { repoRoot } = {})` resolves the 5 path fields (`cv_fr_path`, `cv_en_path`, `transcript_path`, `portfolio_path`, `other_document_path`) to absolute paths post-validation. Absolute paths and `~/`-prefixed paths are accepted. Downstream consumers (`upload-file.mjs`, `field-classifier.mjs`) are unchanged.

**Tech Stack:** Node 20+, ESM, `node:test`, `node:fs`, `node:path`, `node:child_process`, `js-yaml`.

**Spec:** `docs/superpowers/specs/2026-04-17-issue-43-portable-cv-paths-design.md`

---

## Task 1 — New module `src/lib/repo-root.mjs`

**Files:**
- Create: `src/lib/repo-root.mjs`
- Test: `tests/lib/repo-root.test.mjs`

- [ ] **Step 1.1: Write the failing test file**

Create `tests/lib/repo-root.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findRepoRoot, RepoRootNotFoundError } from '../../src/lib/repo-root.mjs';

function mkTmp(prefix = 'repo-root-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('findRepoRoot — returns the repo root when given the root itself', () => {
  const root = mkTmp();
  try {
    fs.mkdirSync(path.join(root, '.git'));
    assert.equal(findRepoRoot(root), fs.realpathSync(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findRepoRoot — walks up from a deep subdirectory', () => {
  const root = mkTmp();
  try {
    fs.mkdirSync(path.join(root, '.git'));
    const deep = path.join(root, 'a', 'b', 'c');
    fs.mkdirSync(deep, { recursive: true });
    assert.equal(findRepoRoot(deep), fs.realpathSync(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findRepoRoot — supports .git as a file (worktree linked repos)', () => {
  const root = mkTmp();
  try {
    fs.writeFileSync(path.join(root, '.git'), 'gitdir: /elsewhere\n');
    assert.equal(findRepoRoot(root), fs.realpathSync(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findRepoRoot — resolves symlinks', () => {
  const root = mkTmp();
  try {
    fs.mkdirSync(path.join(root, '.git'));
    const linkParent = mkTmp('repo-root-link-');
    const link = path.join(linkParent, 'link');
    fs.symlinkSync(root, link);
    assert.equal(findRepoRoot(link), fs.realpathSync(root));
    fs.rmSync(linkParent, { recursive: true, force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findRepoRoot — throws RepoRootNotFoundError when no marker is found', () => {
  const root = mkTmp();
  try {
    assert.throws(() => findRepoRoot(root), RepoRootNotFoundError);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('findRepoRoot — defaults startDir to process.cwd()', () => {
  const result = findRepoRoot();
  assert.ok(result.length > 0);
  assert.ok(path.isAbsolute(result));
});
```

- [ ] **Step 1.2: Run test to verify it fails**

```bash
node --test tests/lib/repo-root.test.mjs 2>&1 | tail -20
```

Expected: all 6 tests fail with `Cannot find module '.../src/lib/repo-root.mjs'` or similar.

- [ ] **Step 1.3: Implement the module**

Create `src/lib/repo-root.mjs`:

```js
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export class RepoRootNotFoundError extends Error {
  constructor(startDir) {
    super(
      `Cannot locate repo root from ${startDir}. Run the command from inside the claude-apply repository.`
    );
    this.name = 'RepoRootNotFoundError';
    this.startDir = startDir;
  }
}

function tryGit(startDir) {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: startDir,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      timeout: 2000,
    }).trim();
    if (out && fs.existsSync(out)) return fs.realpathSync(out);
  } catch {
    // fallthrough
  }
  return null;
}

function walkForDotGit(startDir) {
  let dir = fs.realpathSync(startDir);
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function findRepoRoot(startDir = process.cwd()) {
  if (!fs.existsSync(startDir)) {
    throw new RepoRootNotFoundError(startDir);
  }
  const viaGit = tryGit(startDir);
  if (viaGit) return viaGit;
  const viaWalk = walkForDotGit(startDir);
  if (viaWalk) return viaWalk;
  throw new RepoRootNotFoundError(startDir);
}
```

- [ ] **Step 1.4: Run test to verify it passes**

```bash
node --test tests/lib/repo-root.test.mjs 2>&1 | tail -10
```

Expected: `# pass 6` / `# fail 0`.

- [ ] **Step 1.5: Run lint**

```bash
npm run lint
```

Expected: clean (Prettier passes).

- [ ] **Step 1.6: Commit**

```bash
git add src/lib/repo-root.mjs tests/lib/repo-root.test.mjs
git commit -m "feat(lib): findRepoRoot helper with git + .git-walk fallback

Used by loadProfile to resolve repo-relative paths in
candidate-profile.yml. Part of issue #43 (portable CV paths)."
```

---

## Task 2 — Resolve path fields in `loadProfile`

**Files:**
- Modify: `src/lib/load-profile.mjs`
- Modify: `tests/lib/load-profile.test.mjs`

- [ ] **Step 2.1: Add new failing tests**

Append to `tests/lib/load-profile.test.mjs`:

```js
const VALID_YAML_ALL_PATHS = `first_name: Alice
last_name: Martin
email: alice.martin@example.com
phone: '+33600000000'
linkedin_url: https://linkedin.com/in/alice
github_url: https://github.com/alice
city: Paris
country: France
school: Example School
degree: MEng
graduation_year: 2026
work_authorization: EU citizen
requires_sponsorship: false
availability_start: '2026-09-01'
internship_duration_months: 6
cv_fr_path: config/cv.fr.pdf
cv_en_path: config/cv.en.pdf
transcript_path: ~/docs/transcript.pdf
portfolio_path: /abs/portfolio.pdf
auto_apply_min_score: 8
`;

test('loadProfile — resolves relative CV paths against explicit repoRoot', async () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'candidate-profile.yml'), VALID_YAML_ALL_PATHS);
    const { profile } = await loadProfile(dir, { repoRoot: dir });
    assert.equal(profile.cv_fr_path, path.join(dir, 'config/cv.fr.pdf'));
    assert.equal(profile.cv_en_path, path.join(dir, 'config/cv.en.pdf'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadProfile — passes absolute paths through unchanged', async () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'candidate-profile.yml'), VALID_YAML_ALL_PATHS);
    const { profile } = await loadProfile(dir, { repoRoot: dir });
    assert.equal(profile.portfolio_path, '/abs/portfolio.pdf');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadProfile — expands ~/ against os.homedir()', async () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'candidate-profile.yml'), VALID_YAML_ALL_PATHS);
    const { profile } = await loadProfile(dir, { repoRoot: dir });
    assert.equal(profile.transcript_path, path.join(os.homedir(), 'docs/transcript.pdf'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadProfile — leaves null optional path as null', async () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'candidate-profile.yml'), VALID_YAML);
    const { profile } = await loadProfile(dir, { repoRoot: dir });
    assert.equal(profile.portfolio_path ?? null, null);
    assert.equal(profile.other_document_path ?? null, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadProfile — auto-detects repoRoot via findRepoRoot when not passed', async () => {
  const repoDir = makeTmpDir('load-profile-repo-');
  try {
    fs.mkdirSync(path.join(repoDir, '.git'));
    const configDir = path.join(repoDir, 'config');
    fs.mkdirSync(configDir);
    fs.writeFileSync(path.join(configDir, 'candidate-profile.yml'), VALID_YAML_ALL_PATHS);
    const { profile } = await loadProfile(configDir);
    assert.equal(profile.cv_fr_path, path.join(fs.realpathSync(repoDir), 'config/cv.fr.pdf'));
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});
```

Then fix the two existing tests that call `loadProfile(dir)` so they pass `{ repoRoot: dir }`:

```js
// in 'loadProfile — happy path returns profile + cvMarkdown':
const { profile, cvMarkdown } = await loadProfile(dir, { repoRoot: dir });

// in 'loadProfile — returns null cvMarkdown when cv.md missing':
const { profile, cvMarkdown } = await loadProfile(dir, { repoRoot: dir });
```

Leave the `ProfileMissingError` and `ProfileInvalidError` tests untouched — they throw before path resolution.

Also update `makeTmpDir` to accept a prefix:

```js
function makeTmpDir(prefix = 'load-profile-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
```

- [ ] **Step 2.2: Run the tests to see the new ones fail**

```bash
node --test tests/lib/load-profile.test.mjs 2>&1 | tail -15
```

Expected: 5 new tests fail (likely `profile.cv_fr_path === 'config/cv.fr.pdf'` instead of the resolved absolute path), existing 4 still pass.

- [ ] **Step 2.3: Update `src/lib/load-profile.mjs`**

Replace the whole file with:

```js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateProfile } from './candidate-profile.schema.mjs';
import { findRepoRoot } from './repo-root.mjs';

export class ProfileMissingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProfileMissingError';
  }
}

export class ProfileInvalidError extends Error {
  constructor(message, errors) {
    super(message);
    this.name = 'ProfileInvalidError';
    this.errors = errors;
  }
}

const PATH_FIELDS = [
  'cv_fr_path',
  'cv_en_path',
  'transcript_path',
  'portfolio_path',
  'other_document_path',
];

function resolveOnePath(p, repoRoot) {
  if (p == null) return p;
  if (typeof p !== 'string') return p;
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  if (path.isAbsolute(p)) return p;
  return path.resolve(repoRoot, p);
}

function resolveProfilePaths(profile, repoRoot) {
  const out = { ...profile };
  for (const key of PATH_FIELDS) {
    if (key in out) out[key] = resolveOnePath(out[key], repoRoot);
  }
  return out;
}

export async function loadProfile(configDir, { repoRoot } = {}) {
  const profilePath = path.join(configDir, 'candidate-profile.yml');
  if (!fs.existsSync(profilePath)) {
    throw new ProfileMissingError(
      `config/candidate-profile.yml not found in ${configDir} — run /apply-onboard`
    );
  }
  const yaml = await import('js-yaml');
  const profile = yaml.load(fs.readFileSync(profilePath, 'utf8'));
  const { ok, errors } = validateProfile(profile);
  if (!ok) {
    throw new ProfileInvalidError(
      `config/candidate-profile.yml is invalid: ${errors.join('; ')}`,
      errors
    );
  }

  const root = repoRoot ?? findRepoRoot(configDir);
  const resolvedProfile = resolveProfilePaths(profile, root);

  const cvPath = path.join(configDir, 'cv.md');
  const cvMarkdown = fs.existsSync(cvPath) ? fs.readFileSync(cvPath, 'utf8') : null;

  return { profile: resolvedProfile, cvMarkdown };
}
```

- [ ] **Step 2.4: Run load-profile tests — expect all green**

```bash
node --test tests/lib/load-profile.test.mjs 2>&1 | tail -10
```

Expected: `# pass 9` / `# fail 0` (4 original + 5 new).

- [ ] **Step 2.5: Run the full suite — no regressions**

```bash
npm test 2>&1 | tail -10
```

Expected: `# pass 421` (410 baseline + 6 added in Task 1 + 5 added in Task 2) `# fail 0`.

- [ ] **Step 2.6: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 2.7: Commit**

```bash
git add src/lib/load-profile.mjs tests/lib/load-profile.test.mjs
git commit -m "feat(lib): resolve candidate-profile path fields to absolute in loadProfile

Accepts repo-relative, absolute, or ~/-prefixed paths in the YAML and
normalises to absolute. New optional { repoRoot } arg lets tests and
out-of-repo callers supply the root explicitly. Closes the
loadProfile-side of issue #43."
```

---

## Task 3 — Update template and onboarding docs

**Files:**
- Modify: `templates/candidate-profile.example.yml`
- Modify: `.claude/commands/apply-onboard/profile.md`
- Modify: `docs/playbooks/apply-workday.md`

- [ ] **Step 3.1: Update the template**

Edit `templates/candidate-profile.example.yml` lines 60-67. Change:

```yaml
# --- CV paths (absolute) ---
cv_fr_path: /absolute/path/to/your/cv-fr.pdf
cv_en_path: /absolute/path/to/your/cv-en.pdf

# --- Optional document paths (absolute) ---
transcript_path: null # releve de notes / academic transcript
portfolio_path: null # portfolio / work samples
other_document_path: null # any additional document
```

to:

```yaml
# --- CV paths (repo-relative recommended; absolute or ~/... also accepted) ---
cv_fr_path: config/cv.fr.pdf
cv_en_path: config/cv.en.pdf

# --- Optional document paths (repo-relative, absolute, or ~/... all accepted) ---
transcript_path: null # releve de notes / academic transcript
portfolio_path: null # portfolio / work samples
other_document_path: null # any additional document
```

- [ ] **Step 3.2: Update `apply-onboard/profile.md`**

Edit `.claude/commands/apply-onboard/profile.md` §2 (around line 38). Replace:

```
Detect the language from the CV content (usually `fr` or `en`) and copy the source PDF to `config/cv.<lang>.pdf`. Use this absolute path as `cv_fr_path` or `cv_en_path` later.
```

with:

```
Detect the language from the CV content (usually `fr` or `en`) and copy the source PDF to `config/cv.<lang>.pdf`. Record this as a **repo-relative path** (e.g. `cv_fr_path: config/cv.fr.pdf`) so the profile stays portable between machines. Absolute and `~/`-prefixed paths are also accepted if the user already stores their CV elsewhere.
```

- [ ] **Step 3.3: Update `docs/playbooks/apply-workday.md`**

Edit line 114. Replace:

```
   - Resolve CV path: `profile.cv_fr_path` or `profile.cv_en_path` based on `detectLanguage({ title: role, description: jdText })` from `src/apply/language-detect.mjs`.
```

with:

```
   - Resolve CV path: read `profile.cv_fr_path` or `profile.cv_en_path` based on `detectLanguage({ title: role, description: jdText })` from `src/apply/language-detect.mjs`. `loadProfile` already returns absolute paths, so pass the value straight to `--file`.
```

- [ ] **Step 3.4: Run the full suite — still green**

```bash
npm test 2>&1 | tail -5
```

Expected: `# pass 421` / `# fail 0` (docs-only changes, no test delta).

- [ ] **Step 3.5: Run PII gate**

```bash
npm run check:pii
```

Expected: clean (no PII introduced).

- [ ] **Step 3.6: Commit**

```bash
git add templates/candidate-profile.example.yml .claude/commands/apply-onboard/profile.md docs/playbooks/apply-workday.md
git commit -m "docs(onboard): document repo-relative CV paths in template and onboarding

Makes portable CV paths the default in the example profile and in
apply-onboard:profile. References updated in the Workday playbook.
Part of issue #43."
```

---

## Task 4 — Mark PR ready and update description

**Files:**
- GitHub PR #58

- [ ] **Step 4.1: Push all commits**

```bash
git push
```

- [ ] **Step 4.2: Update PR description with outcome**

```bash
gh pr edit 58 --body "$(cat <<'EOF'
Closes #43.

## Problème

`/apply-onboard:profile` écrit des chemins absolus (`/home/leo/...`) dans `config/candidate-profile.yml`. Au moindre déplacement (dotfiles, Syncthing, Linux→macOS) l'upload CV échoue silencieusement à l'étape `/apply`.

## Correction

- Nouveau `src/lib/repo-root.mjs` — détection de la racine du repo via `git rev-parse` avec fallback `.git`-walk.
- `loadProfile(configDir, { repoRoot } = {})` résout les 5 champs chemin (`cv_fr_path`, `cv_en_path`, `transcript_path`, `portfolio_path`, `other_document_path`) en absolu après validation.
- Chemins relatifs → résolus contre la racine du repo. Chemins absolus → passthrough (rétro-compat). `~/…` → expand via `os.homedir()`.
- Template et docs onboarding mis à jour pour documenter le format portable.
- Consommateurs aval (`upload-file.mjs`, `field-classifier.mjs`, `cover-letter.mjs`) inchangés.

## Migration

Aucune automatique. Les profils existants avec chemins absolus continuent à marcher. Pour bénéficier de la portabilité, re-run `/apply-onboard:profile` (idempotent).

## Tests

- `tests/lib/repo-root.test.mjs` (nouveau, 6 cas)
- `tests/lib/load-profile.test.mjs` (+5 cas)
- Suite complète verte.

## Spec & plan

- `docs/superpowers/specs/2026-04-17-issue-43-portable-cv-paths-design.md`
- `docs/superpowers/plans/2026-04-17-issue-43-portable-cv-paths.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4.3: Mark PR ready for review**

```bash
gh pr ready 58
```

- [ ] **Step 4.4: Watch CI**

```bash
gh pr checks 58 --watch
```

Expected: lint, tests, and PII check all pass.

---

## Post-merge checklist

- [ ] CI green on the PR.
- [ ] Merge via squash (repo convention, see recent PRs #52–#55).
- [ ] Delete the branch via `gh pr merge 58 --squash --delete-branch` or the GitHub UI.
- [ ] Remove the worktree: `git worktree remove .worktrees/fix-issue-43` (run from the main repo).
