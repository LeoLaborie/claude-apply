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

test('fetchWorkable — prefixes "Remote — " when telecommuting=true', async () => {
  restore = installMockFetch({
    'https://apply.workable.com/api/v1/widget/accounts/acme': {
      name: 'Acme',
      description: '',
      jobs: [
        {
          title: 'Staff Engineer',
          shortcode: 'ABC123',
          url: 'https://apply.workable.com/j/ABC123',
          shortlink: 'https://apply.workable.com/j/ABC123',
          telecommuting: true,
          city: 'Paris',
          country: 'France',
        },
      ],
    },
  });

  const offers = await fetchWorkable('acme', 'Acme');
  assert.equal(offers.length, 1);
  assert.equal(offers[0].location, 'Remote — Paris, France');
});

test('fetchWorkable — location is "Remote" alone when telecommuting=true and no city/country', async () => {
  restore = installMockFetch({
    'https://apply.workable.com/api/v1/widget/accounts/acme': {
      name: 'Acme',
      description: '',
      jobs: [
        {
          title: 'Anywhere Engineer',
          shortcode: 'XYZ',
          url: 'https://apply.workable.com/j/XYZ',
          telecommuting: true,
          city: '',
          country: '',
        },
      ],
    },
  });

  const offers = await fetchWorkable('acme', 'Acme');
  assert.equal(offers[0].location, 'Remote');
});

test('verifySlug — returns count on success', async () => {
  restore = installMockFetch({
    'https://apply.workable.com/api/v1/widget/accounts/acme': {
      name: 'Acme',
      description: '',
      jobs: [{ title: 'a' }, { title: 'b' }, { title: 'c' }],
    },
  });
  const r = await verifySlug('acme');
  assert.equal(r.ok, true);
  assert.equal(r.count, 3);
});

test('verifySlug — returns ok:false with status on 404', async () => {
  restore = installMockFetch({
    'https://apply.workable.com/api/v1/widget/accounts/nope': { status: 404, body: {} },
  });
  const r = await verifySlug('nope');
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.match(r.reason, /HTTP 404/);
});

test('fetchWorkable — throws on non-2xx', async () => {
  restore = installMockFetch({
    'https://apply.workable.com/api/v1/widget/accounts/nope': { status: 500, body: {} },
  });
  await assert.rejects(() => fetchWorkable('nope', 'Nope'), /Workable API nope: HTTP 500/);
});
