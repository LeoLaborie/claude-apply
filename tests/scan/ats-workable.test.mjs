import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMockFetch } from '../helpers.mjs';
import { fetchWorkable, verifySlug } from '../../src/scan/ats/workable.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'fixtures', 'workable-huggingface.json');

let restore;
afterEach(() => {
  if (restore) restore();
  restore = null;
});

test('fetchWorkable — maps fixture to Offer[] with platform=workable and body=""', async () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  restore = installMockFetch({
    'https://apply.workable.com/api/v1/widget/accounts/huggingface': fixture,
  });

  const offers = await fetchWorkable('huggingface', 'Hugging Face');

  assert.ok(Array.isArray(offers));
  assert.equal(offers.length, fixture.jobs.length);
  for (const o of offers) {
    assert.equal(typeof o.url, 'string');
    assert.ok(o.url.length > 0);
    assert.equal(typeof o.title, 'string');
    assert.equal(o.company, 'Hugging Face');
    assert.equal(typeof o.location, 'string');
    assert.equal(o.body, '');
    assert.equal(o.platform, 'workable');
  }
});
