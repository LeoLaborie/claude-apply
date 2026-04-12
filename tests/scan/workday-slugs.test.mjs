import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSlugRegistry, lookupWorkdaySlug } from '../../src/scan/ats/workday-slugs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'fixtures', 'known-workday-slugs.json');
const registry = loadSlugRegistry(fixturePath);

test('loadSlugRegistry — returns parsed object from valid JSON file', () => {
  const registry = loadSlugRegistry(fixturePath);
  assert.equal(typeof registry, 'object');
  assert.ok(registry.sanofi);
  assert.equal(registry.sanofi.tenant, 'sanofi');
  assert.equal(registry.sanofi.pod, 'wd3');
  assert.equal(registry.sanofi.slug, 'SanofiCareers');
});

test('loadSlugRegistry — throws on non-existent file', () => {
  assert.throws(
    () => loadSlugRegistry('/tmp/does-not-exist-workday-slugs.json'),
    /ENOENT|no such file/i,
  );
});

test('loadSlugRegistry — throws on invalid JSON', async () => {
  const tmpPath = path.join(__dirname, '..', 'fixtures', '_tmp_bad.json');
  fs.writeFileSync(tmpPath, '{ not valid json !!!');
  try {
    assert.throws(() => loadSlugRegistry(tmpPath), /JSON|Unexpected/i);
  } finally {
    fs.unlinkSync(tmpPath);
  }
});

test('lookupWorkdaySlug — exact match returns entry', () => {
  const result = lookupWorkdaySlug(registry, 'sanofi');
  assert.deepEqual(result, { tenant: 'sanofi', pod: 'wd3', slug: 'SanofiCareers' });
});

test('lookupWorkdaySlug — normalizes case', () => {
  const result = lookupWorkdaySlug(registry, 'Michelin');
  assert.deepEqual(result, { tenant: 'michelinhr', pod: 'wd3', slug: 'Michelin' });
});

test('lookupWorkdaySlug — normalizes spaces', () => {
  const result = lookupWorkdaySlug(registry, '  Sanofi  ');
  assert.deepEqual(result, { tenant: 'sanofi', pod: 'wd3', slug: 'SanofiCareers' });
});

test('lookupWorkdaySlug — returns null for unknown company', () => {
  const result = lookupWorkdaySlug(registry, 'UnknownCorp');
  assert.equal(result, null);
});

test('seed fixture — every entry has tenant, pod, slug as non-empty strings', () => {
  for (const [key, entry] of Object.entries(registry)) {
    assert.equal(typeof entry.tenant, 'string', `${key}.tenant should be a string`);
    assert.ok(entry.tenant.length > 0, `${key}.tenant should be non-empty`);
    assert.equal(typeof entry.pod, 'string', `${key}.pod should be a string`);
    assert.ok(entry.pod.length > 0, `${key}.pod should be non-empty`);
    assert.equal(typeof entry.slug, 'string', `${key}.slug should be a string`);
    assert.ok(entry.slug.length > 0, `${key}.slug should be non-empty`);
  }
});

test('seed fixture — has at least 5 entries', () => {
  assert.ok(Object.keys(registry).length >= 5);
});
