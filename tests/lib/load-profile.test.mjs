import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadProfile,
  ProfileMissingError,
  ProfileInvalidError,
} from '../../src/lib/load-profile.mjs';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'load-profile-'));
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
cv_fr_path: a.pdf
cv_en_path: b.pdf
auto_apply_min_score: 8
`;

test('loadProfile — happy path returns profile + cvMarkdown', async () => {
  const dir = makeTmpDir();
  try {
    fs.writeFileSync(path.join(dir, 'candidate-profile.yml'), VALID_YAML);
    fs.writeFileSync(path.join(dir, 'cv.md'), '# CV\nStuff');
    const { profile, cvMarkdown } = await loadProfile(dir);
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
    const { profile, cvMarkdown } = await loadProfile(dir);
    assert.equal(profile.first_name, 'Alice');
    assert.equal(cvMarkdown, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadProfile — throws ProfileMissingError when yml missing', async () => {
  const dir = makeTmpDir();
  try {
    await assert.rejects(
      () => loadProfile(dir),
      (err) => {
        assert.ok(err instanceof ProfileMissingError);
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
