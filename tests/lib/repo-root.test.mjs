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
  const linkParent = mkTmp('repo-root-link-');
  try {
    fs.mkdirSync(path.join(root, '.git'));
    const link = path.join(linkParent, 'link');
    fs.symlinkSync(root, link);
    assert.equal(findRepoRoot(link), fs.realpathSync(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(linkParent, { recursive: true, force: true });
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
