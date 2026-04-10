import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateProfile, REQUIRED_FIELDS } from '../../src/apply/candidate-profile.schema.mjs';

test('candidate-profile.example.yml parses and passes validation', async () => {
  const { parse } = await import('yaml');
  const raw = readFileSync(new URL('../fixtures/candidate-profile.example.yml', import.meta.url), 'utf8');
  const profile = parse(raw);
  const { ok, errors } = validateProfile(profile);
  assert.equal(ok, true, `errors: ${JSON.stringify(errors)}`);
});

test('validateProfile flags missing required fields', () => {
  const { ok, errors } = validateProfile({ first_name: 'Alice' });
  assert.equal(ok, false);
  for (const field of REQUIRED_FIELDS) {
    if (field === 'first_name') continue;
    assert.ok(errors.some(e => e.includes(field)), `expected error for ${field}`);
  }
});

test('validateProfile accepts optional EEO fields as null', () => {
  const minimal = {
    first_name: 'Alice', last_name: 'Martin',
    email: 'alice.martin@example.com', phone: '+33600000000',
    linkedin_url: 'https://linkedin.com/in/alice-martin',
    github_url: 'https://github.com/alice-martin',
    city: 'Paris', country: 'France',
    school: 'Example Engineering School', degree: 'Master of Engineering',
    graduation_year: 2026,
    work_authorization: 'EU citizen', requires_sponsorship: false,
    availability_start: '2026-09-01', internship_duration_months: 6,
    cv_fr_path: 'candidate-cv-fr.pdf', cv_en_path: 'candidate-cv-en.pdf',
    auto_apply_min_score: 8,
    gender: null, ethnicity: null, veteran_status: null, disability_status: null,
  };
  const { ok } = validateProfile(minimal);
  assert.equal(ok, true);
});
