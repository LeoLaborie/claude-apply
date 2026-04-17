import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadProfile, ProfileInvalidError } from '../../src/lib/load-profile.mjs';
import { MissingConfigError } from '../../src/lib/config-loader.mjs';

function makeTmpDir(prefix = 'load-profile-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const VALID_YAML = `first_name: Alice
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
cv_path: a.pdf
auto_apply_min_score: 8
`;

test('loadProfile — happy path returns profile + cvMarkdown', async () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'candidate-profile.yml'), VALID_YAML);
    fs.writeFileSync(path.join(dir, 'cv.md'), '# CV\nStuff');
    const { profile, cvMarkdown } = await loadProfile(dir, { repoRoot: dir });
    assert.equal(profile.first_name, 'Alice');
    assert.equal(cvMarkdown, '# CV\nStuff');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadProfile — returns null cvMarkdown when cv.md missing', async () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'candidate-profile.yml'), VALID_YAML);
    const { profile, cvMarkdown } = await loadProfile(dir, { repoRoot: dir });
    assert.equal(profile.first_name, 'Alice');
    assert.equal(cvMarkdown, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadProfile — throws MissingConfigError when yml missing', async () => {
  const dir = makeTmpDir();
  try {
    await assert.rejects(
      () => loadProfile(dir),
      (err) => {
        assert.ok(err instanceof MissingConfigError);
        assert.equal(err.code, 'MISSING_CONFIG');
        assert.match(err.message, /candidate-profile\.yml/);
        assert.match(err.message, /\/apply-onboard/);
        return true;
      }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadProfile — throws ProfileInvalidError with errors[] when yml invalid', async () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'candidate-profile.yml'), 'first_name: Alice\n');
    await assert.rejects(
      () => loadProfile(dir),
      (err) => {
        assert.ok(err instanceof ProfileInvalidError);
        assert.ok(Array.isArray(err.errors));
        assert.ok(err.errors.length > 0);
        return true;
      }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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
cv_path: config/cv.pdf
transcript_path: ~/docs/transcript.pdf
portfolio_path: /abs/portfolio.pdf
auto_apply_min_score: 8
`;

test('loadProfile — resolves relative CV path against explicit repoRoot', async () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'candidate-profile.yml'), VALID_YAML_ALL_PATHS);
    const { profile } = await loadProfile(dir, { repoRoot: dir });
    assert.equal(profile.cv_path, path.join(dir, 'config/cv.pdf'));
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
    assert.equal(profile.cv_path, path.join(fs.realpathSync(repoDir), 'config/cv.pdf'));
  } finally {
    fs.rmSync(repoDir, { recursive: true, force: true });
  }
});
