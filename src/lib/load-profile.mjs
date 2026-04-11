import fs from 'node:fs';
import path from 'node:path';
import { validateProfile } from './candidate-profile.schema.mjs';

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

export async function loadProfile(configDir) {
  const profilePath = path.join(configDir, 'candidate-profile.yml');
  if (!fs.existsSync(profilePath)) {
    throw new ProfileMissingError(
      `config/candidate-profile.yml not found in ${configDir} — run /onboard`
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

  const cvPath = path.join(configDir, 'cv.md');
  const cvMarkdown = fs.existsSync(cvPath) ? fs.readFileSync(cvPath, 'utf8') : null;

  return { profile, cvMarkdown };
}
