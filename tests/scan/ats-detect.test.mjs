import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform, getSupportedHosts } from '../../src/scan/ats-detect.mjs';

test('detectPlatform — Lever URL → {lever, slug}', () => {
  assert.deepEqual(detectPlatform('https://jobs.lever.co/mistral'), {
    platform: 'lever',
    slug: 'mistral',
  });
  assert.deepEqual(detectPlatform('https://jobs.lever.co/blablacar/'), {
    platform: 'lever',
    slug: 'blablacar',
  });
});

test('detectPlatform — Greenhouse job-boards URL', () => {
  assert.deepEqual(detectPlatform('https://job-boards.greenhouse.io/anthropic'), {
    platform: 'greenhouse',
    slug: 'anthropic',
  });
  assert.deepEqual(detectPlatform('https://boards.greenhouse.io/stripe'), {
    platform: 'greenhouse',
    slug: 'stripe',
  });
});

test('detectPlatform — Ashby URL', () => {
  assert.deepEqual(detectPlatform('https://jobs.ashbyhq.com/photoroom'), {
    platform: 'ashby',
    slug: 'photoroom',
  });
});

test('detectPlatform — Workable URL (avec ou sans slash)', () => {
  assert.deepEqual(detectPlatform('https://apply.workable.com/huggingface/'), {
    platform: 'workable',
    slug: 'huggingface',
  });
  assert.deepEqual(detectPlatform('https://apply.workable.com/huggingface'), {
    platform: 'workable',
    slug: 'huggingface',
  });
});

test('detectPlatform — URL inconnue retourne null', () => {
  assert.equal(detectPlatform('https://careers.datadoghq.com'), null);
  assert.equal(detectPlatform('https://openai.com/careers'), null);
  assert.equal(detectPlatform(''), null);
});

test('detectPlatform — recognises Workday URL and returns full URL as slug', () => {
  const r = detectPlatform('https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers');
  assert.equal(r.platform, 'workday');
  assert.equal(r.slug, 'https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers');
});

test('detectPlatform — recognises Workday URL on pod wd5', () => {
  const r = detectPlatform('https://capgemini.wd5.myworkdayjobs.com/CapgeminiCareers');
  assert.equal(r.platform, 'workday');
});

test('getSupportedHosts — includes myworkdayjobs wildcard', () => {
  const hosts = getSupportedHosts();
  assert.ok(hosts.some((h) => h.includes('myworkdayjobs.com')));
});

test('detectPlatform — Workday URL avec préfixe locale (en-US, fr-FR) reste valide', () => {
  // Workday surfaces locale-prefixed URLs in the browser address bar.
  // The captured slug must contain the real site segment so that
  // parseWorkdayUrl downstream can resolve {tenant, pod, site} correctly.
  const enUS = detectPlatform(
    'https://totalenergies.wd3.myworkdayjobs.com/en-US/TotalEnergies_careers'
  );
  assert.equal(enUS.platform, 'workday');
  assert.ok(
    enUS.slug.includes('TotalEnergies_careers'),
    `expected slug to retain site segment, got: ${enUS.slug}`
  );

  const frFR = detectPlatform('https://capgemini.wd5.myworkdayjobs.com/fr-FR/CapgeminiCareers');
  assert.equal(frFR.platform, 'workday');
  assert.ok(
    frFR.slug.includes('CapgeminiCareers'),
    `expected slug to retain site segment, got: ${frFR.slug}`
  );
});
