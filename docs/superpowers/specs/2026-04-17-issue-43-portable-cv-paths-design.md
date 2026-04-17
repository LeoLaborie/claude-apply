# Portable CV paths in `candidate-profile.yml` (issue #43)

**Date**: 2026-04-17
**Issue**: [#43](https://github.com/LeoLaborie/claude-apply/issues/43)
**Status**: Design approved

## Problem

`/apply-onboard:profile` writes absolute paths into `config/candidate-profile.yml`:

```yaml
cv_fr_path: /home/leo/Documents/claude-apply/config/cv.fr.pdf
cv_en_path: /home/leo/Documents/claude-apply/config/cv.en.pdf
```

Any user who syncs `config/` across machines (dotfiles repo, Syncthing, manual backup) or switches OS gets a silent breakage at the next `/apply`: the file is not found, the run stops mid-flow or submits without a CV.

**Severity**: Medium — silent failure, only hits users who move machines. But the gap widens as adoption grows.

## Goal

Make `config/candidate-profile.yml` portable. A profile that points to `config/cv.fr.pdf` must work on any machine that checked out the repo, regardless of the absolute path where the repo lives.

## Non-goals

- Auto-migration of existing profiles. Re-running `/apply-onboard:profile` regenerates the YAML in the new format (the command is already idempotent).
- Runtime warnings when users keep absolute paths. Absolute paths remain fully supported.
- Filesystem validation in `loadProfile`. Existence / readability checks stay in `upload-file.mjs`.
- Environment-variable expansion (`$HOME`, `$VAR`) in paths. `~/` covers the common case; absolute covers the rest.
- Refactoring `upload-file.mjs`, `field-classifier.mjs`, `cover-letter.mjs`. They already receive absolute paths post-fix.
- Auto-regeneration of the template. `templates/candidate-profile.example.yml` stays hand-edited.

## Design

### Invariant

After `loadProfile()` returns, every file-path field on the profile object is either:
- `null` (optional field, no path set), or
- an **absolute** path, ready to be passed to `upload-file.mjs` or any other consumer.

The YAML on disk stays in its portable form (relative or `~/`-prefixed). Absolute is accepted for backwards compatibility.

### Scope of affected fields

Five path fields on the profile schema:

- `cv_fr_path` (required)
- `cv_en_path` (required)
- `transcript_path` (optional)
- `portfolio_path` (optional)
- `other_document_path` (optional)

### Components

**New — `src/lib/repo-root.mjs`** (~15 lines)

```js
export class RepoRootNotFoundError extends Error { /* … */ }

export function findRepoRoot(startDir = process.cwd()) {
  // 1. Try `git rev-parse --show-toplevel` synchronously.
  // 2. Fallback: walk parent dirs looking for `.git` (file or dir).
  // 3. Symlink-resolve via fs.realpathSync.
  // 4. Throw RepoRootNotFoundError if neither step finds a root.
}
```

Pure function, no side effects. Unit-testable with temp dirs.

**Modified — `src/lib/load-profile.mjs`** (+~15 lines)

Signature becomes `loadProfile(configDir, { repoRoot } = {})`. Tests and callers that want explicit control pass `repoRoot`; production code omits it and lets `findRepoRoot(configDir)` auto-detect.

After `validateProfile(profile)` returns `ok: true`:

```js
const root = repoRoot ?? findRepoRoot(configDir);
const resolvedProfile = resolveProfilePaths(profile, root);
return { profile: resolvedProfile, cvMarkdown };
```

The existing callers (`src/apply/...`, `src/score/...`) continue to call `loadProfile(configDir)` unchanged — no downstream churn.

Local helper:

```js
const PATH_FIELDS = [
  'cv_fr_path',
  'cv_en_path',
  'transcript_path',
  'portfolio_path',
  'other_document_path',
];

function resolveProfilePaths(profile, repoRoot) {
  const out = { ...profile };
  for (const key of PATH_FIELDS) {
    out[key] = resolveOnePath(profile[key], repoRoot);
  }
  return out;
}

function resolveOnePath(p, repoRoot) {
  if (p == null) return p;
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  if (path.isAbsolute(p)) return p;
  return path.resolve(repoRoot, p);
}
```

**Unchanged** — `src/apply/upload-file.mjs`, `src/apply/field-classifier.mjs`, `src/apply/cover-letter.mjs`. They receive absolute paths and already work correctly with them.

### Resolution rules (per path, in order)

1. `null` / `undefined` → unchanged.
2. Starts with `~/` → expand via `os.homedir()`.
3. `path.isAbsolute(p)` → return as-is.
4. Otherwise (relative) → `path.resolve(repoRoot, p)`.

### Documentation updates

**`.claude/commands/apply-onboard/profile.md`**

- §2: *"copy the source PDF to `config/cv.<lang>.pdf`. Use the **repo-relative path** `config/cv.<lang>.pdf` as `cv_fr_path` or `cv_en_path` later."*
- §5: drop mentions of "absolute path" for the 5 path fields. Say "repo-relative path (or absolute — both work, but relative is portable)".

**`templates/candidate-profile.example.yml`**

- Section header at line 60: `# --- CV paths (repo-relative or absolute) ---`
- Lines 61-62:

  ```yaml
  cv_fr_path: config/cv.fr.pdf
  cv_en_path: config/cv.en.pdf
  ```

- Lines 64-67: same treatment for `transcript_path`, `portfolio_path`, `other_document_path` (keep `null` defaults, comment clarifies the accepted forms).

**`docs/playbooks/apply-workday.md`** (line 114)

Keep the reference to `profile.cv_fr_path` / `profile.cv_en_path` but align the phrasing: the path you receive from `loadProfile` is already absolute, no client-side resolution needed.

### Error handling

| Condition                          | Behaviour                                                                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `findRepoRoot` cannot locate root  | Throw `RepoRootNotFoundError`. `loadProfile` lets it propagate. Slash commands surface: *"Cannot locate repo root — run from inside the repo."*  |
| Resolved path does not exist       | Not caught here. `upload-file.mjs` raises `FILE_NOT_FOUND` with the full resolved path (existing behaviour, zero regression).                    |
| Absolute path outside the repo     | Passthrough. Works on that machine; not portable (user's choice).                                                                                |
| YAML has absolute path inside repo | Passthrough. Still works; user gets portability back by re-running `/apply-onboard:profile`.                                                     |

Error class follows the existing typed-error pattern (`UploadError`, `ProfileMissingError`, `ProfileInvalidError`).

## Tests

**New — `tests/lib/repo-root.test.mjs`** (~6 cases)

- Finds the root when cwd is the root.
- Finds the root from a deep subdirectory.
- `.git`-walk fallback succeeds when `git` binary is absent (stub `_execSync`).
- Throws `RepoRootNotFoundError` when neither git nor `.git` marker exists.
- Resolves through symlinks via `fs.realpathSync`.
- Accepts a `startDir` argument (not just `process.cwd()`).

Sandbox: `fs.mkdtempSync(os.tmpdir(), 'repo-root-')` with a fake `.git/` directory.

**Modified — `tests/lib/load-profile.test.mjs`** (+~5 cases)

- Resolves a relative `cv_fr_path` to absolute against repo root.
- Passes an absolute `cv_fr_path` through unchanged.
- Expands `~/cv.pdf` to `$HOME/cv.pdf`.
- `null` on an optional path stays `null`.
- Parametrized over all 5 path fields — same behaviour per field.

**Existing fixtures and tests**

`tests/fixtures/candidate-profile.example.yml` already uses relative paths (`candidate-cv-fr.pdf`). They will now resolve against the `repoRoot` the test passes explicitly.

`tests/lib/load-profile.test.mjs` writes fixtures into a `makeTmpDir()` under `/tmp`. Those tmpdirs are not inside any git repository, so `findRepoRoot` would throw. Tests pass `{ repoRoot: dir }` explicitly in the happy-path and new resolution cases. The `ProfileMissingError` and `ProfileInvalidError` tests never reach path resolution (they throw earlier), so they remain untouched.

`tests/apply/candidate-profile.test.mjs` uses profile objects built in memory, not through `loadProfile`. Unaffected.

**No production consumer changes signature**, since `repoRoot` is an optional arg.

## Rollout

1. Ship this PR (`fix/issue-43-cv-paths-portable` → `main`).
2. PR description documents the behaviour change: new profiles are relative; old profiles keep working.
3. No migration tooling. Existing users who want portability re-run `/apply-onboard:profile`.

## Risks and mitigations

| Risk                                                              | Mitigation                                                                                                                        |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `git rev-parse` slow on huge repos / WSL                          | Synchronous call is typically <10 ms. Fallback `.git`-walk is pure fs, even faster. Negligible cost at `/apply` startup.          |
| User runs `/score` from outside the repo                          | `findRepoRoot(configDir)` starts from `configDir` (passed by the caller), which points *into* the repo. Works.                    |
| Profile loaded outside a git repo (tests under `/tmp`, Docker without `.git`) | The optional `repoRoot` arg on `loadProfile` lets the caller supply it explicitly. Real CI runs inside a checkout, so `findRepoRoot` works by default. |
| Somebody pastes an old absolute path manually                     | Passthrough — still works. No surprise.                                                                                           |

## Summary

One new 15-line file (`repo-root.mjs`), ~15 lines added to `load-profile.mjs`, three documentation files updated, two test files. YAML on disk becomes portable; every downstream consumer sees the same absolute paths it saw before.
