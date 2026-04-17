import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requireConfig } from './config-loader.mjs';
import { validateProfile } from './candidate-profile.schema.mjs';
import { findRepoRoot } from './repo-root.mjs';

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
  requireConfig(profilePath);
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
