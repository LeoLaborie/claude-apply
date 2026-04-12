import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSlugRegistry } from '../../src/scan/ats/workday-slugs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'fixtures', 'known-workday-slugs.json');

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
