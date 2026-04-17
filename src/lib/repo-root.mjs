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
    // fallthrough to .git walk
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
