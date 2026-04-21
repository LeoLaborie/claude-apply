import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateProfile, REQUIRED_FIELDS } from '../../src/lib/candidate-profile.schema.mjs';

test('candidate-profile.example.yml parses and passes validation', async () => {
  const yaml = await import('js-yaml');
  const raw = readFileSync(
    new URL('../fixtures/candidate-profile.example.yml', import.meta.url),
    'utf8'
  );
  const profile = yaml.load(raw);
  const { ok, errors } = validateProfile(profile);
  assert.equal(ok, true, `errors: ${JSON.stringify(errors)}`);
});

test('validateProfile flags missing required fields', () => {
  const { ok, errors } = validateProfile({ first_name: 'Alice' });
  assert.equal(ok, false);
  for (const field of REQUIRED_FIELDS) {
    if (field === 'first_name') continue;
    assert.ok(
      errors.some((e) => e.includes(field)),
      `expected error for ${field}`
    );
  }
});

test('validateProfile accepts optional EEO fields as null', () => {
  const minimal = {
    first_name: 'Alice',
    last_name: 'Martin',
    email: 'alice.martin@example.com',
    phone: '+33600000000',
    linkedin_url: 'https://linkedin.com/in/alice-martin',
    github_url: 'https://github.com/alice-martin',
    city: 'Paris',
    country: 'France',
    school: 'Example Engineering School',
    degree: 'Master of Engineering',
    graduation_year: 2026,
    work_authorization: 'EU citizen',
    requires_sponsorship: false,
    availability_start: '2026-09-01',
    internship_duration_months: 6,
    cv_path: 'candidate-cv.pdf',
    auto_apply_min_score: 8,
    gender: null,
    ethnicity: null,
    veteran_status: null,
    disability_status: null,
  };
  const { ok } = validateProfile(minimal);
  assert.equal(ok, true);
});

test('validateProfile accepts blacklist_companies and min_start_date as optional', () => {
  const base = {
    first_name: 'Alice',
    last_name: 'Martin',
    email: 'alice.martin@example.com',
    phone: '+33600000000',
    linkedin_url: 'https://linkedin.com/in/alice-martin',
    github_url: 'https://github.com/alice-martin',
    city: 'Paris',
    country: 'France',
    school: 'Example Engineering School',
    degree: 'Master of Engineering',
    graduation_year: 2026,
    work_authorization: 'EU citizen',
    requires_sponsorship: false,
    availability_start: '2026-09-01',
    internship_duration_months: 6,
    cv_path: 'candidate-cv.pdf',
    auto_apply_min_score: 8,
    blacklist_companies: ['Evil Corp', 'Other Co'],
    min_start_date: '2026-08-24',
  };
  const { ok, errors } = validateProfile(base);
  assert.equal(ok, true, `errors: ${JSON.stringify(errors)}`);
});

test('validateProfile rejects non-array blacklist_companies', () => {
  const { ok, errors } = validateProfile({
    first_name: 'Alice',
    last_name: 'Martin',
    email: 'alice@example.com',
    phone: '+33600000000',
    linkedin_url: 'https://linkedin.com/in/a',
    github_url: 'https://github.com/a',
    city: 'Paris',
    country: 'France',
    school: 'S',
    degree: 'D',
    graduation_year: 2026,
    work_authorization: 'EU',
    requires_sponsorship: false,
    availability_start: '2026-09-01',
    internship_duration_months: 6,
    cv_path: 'a.pdf',
    auto_apply_min_score: 8,
    blacklist_companies: 'not an array',
  });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('blacklist_companies')));
});

test('validateProfile rejects badly-formatted min_start_date', () => {
  const { ok, errors } = validateProfile({
    first_name: 'Alice',
    last_name: 'Martin',
    email: 'alice@example.com',
    phone: '+33600000000',
    linkedin_url: 'https://linkedin.com/in/a',
    github_url: 'https://github.com/a',
    city: 'Paris',
    country: 'France',
    school: 'S',
    degree: 'D',
    graduation_year: 2026,
    work_authorization: 'EU',
    requires_sponsorship: false,
    availability_start: '2026-09-01',
    internship_duration_months: 6,
    cv_path: 'a.pdf',
    auto_apply_min_score: 8,
    min_start_date: '24 August 2026',
  });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('min_start_date')));
});

test('validateProfile accepts profile with cv_path only', () => {
  const { ok, errors } = validateProfile({
    first_name: 'Alice',
    last_name: 'Martin',
    email: 'alice@example.com',
    phone: '+33600000000',
    linkedin_url: 'https://linkedin.com/in/a',
    github_url: 'https://github.com/a',
    city: 'Paris',
    country: 'France',
    school: 'S',
    degree: 'D',
    graduation_year: 2026,
    work_authorization: 'EU',
    requires_sponsorship: false,
    availability_start: '2026-09-01',
    internship_duration_months: 6,
    cv_path: 'cv.pdf',
    auto_apply_min_score: 8,
  });
  assert.equal(ok, true, `errors: ${JSON.stringify(errors)}`);
});

test('validateProfile requires internship_duration_months when job_type is internship', () => {
  const { ok, errors } = validateProfile({
    first_name: 'Alice',
    last_name: 'Martin',
    email: 'alice@example.com',
    phone: '+33600000000',
    linkedin_url: 'https://linkedin.com/in/a',
    github_url: 'https://github.com/a',
    city: 'Paris',
    country: 'France',
    school: 'S',
    degree: 'D',
    graduation_year: 2026,
    work_authorization: 'EU',
    requires_sponsorship: false,
    availability_start: '2026-09-01',
    cv_path: 'cv.pdf',
    auto_apply_min_score: 8,
    job_type: 'internship',
  });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('internship_duration_months')));
});

test('validateProfile does not require internship_duration_months when job_type is mid-level', () => {
  const { ok, errors } = validateProfile({
    first_name: 'Alice',
    last_name: 'Martin',
    email: 'alice@example.com',
    phone: '+33600000000',
    linkedin_url: 'https://linkedin.com/in/a',
    github_url: 'https://github.com/a',
    city: 'Paris',
    country: 'France',
    school: 'S',
    degree: 'D',
    graduation_year: 2026,
    work_authorization: 'EU',
    requires_sponsorship: false,
    availability_start: '2026-09-01',
    cv_path: 'cv.pdf',
    auto_apply_min_score: 8,
    job_type: 'mid-level',
  });
  assert.equal(ok, true, `errors: ${JSON.stringify(errors)}`);
});

test('validateProfile tolerates internship_duration_months on a senior profile', () => {
  const { ok, errors } = validateProfile({
    first_name: 'Alice',
    last_name: 'Martin',
    email: 'alice@example.com',
    phone: '+33600000000',
    linkedin_url: 'https://linkedin.com/in/a',
    github_url: 'https://github.com/a',
    city: 'Paris',
    country: 'France',
    school: 'S',
    degree: 'D',
    graduation_year: 2026,
    work_authorization: 'EU',
    requires_sponsorship: false,
    availability_start: '2026-09-01',
    cv_path: 'cv.pdf',
    auto_apply_min_score: 8,
    job_type: 'senior',
    internship_duration_months: 6,
  });
  assert.equal(ok, true, `errors: ${JSON.stringify(errors)}`);
});

test('validateProfile rejects profile without cv_path', () => {
  const { ok, errors } = validateProfile({
    first_name: 'Alice',
    last_name: 'Martin',
    email: 'alice@example.com',
    phone: '+33600000000',
    linkedin_url: 'https://linkedin.com/in/a',
    github_url: 'https://github.com/a',
    city: 'Paris',
    country: 'France',
    school: 'S',
    degree: 'D',
    graduation_year: 2026,
    work_authorization: 'EU',
    requires_sponsorship: false,
    availability_start: '2026-09-01',
    internship_duration_months: 6,
    auto_apply_min_score: 8,
  });
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('cv_path')));
});
