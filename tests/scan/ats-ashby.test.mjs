import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMockFetch } from '../helpers.mjs';
import { fetchAshby } from '../../src/scan/ats/ashby.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'fixtures', 'ashby-photoroom.json');

let restore;
afterEach(() => { if (restore) restore(); });

test('fetchAshby — mappe fixture Photoroom', async () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  restore = installMockFetch({
    'https://api.ashbyhq.com/posting-api/job-board/photoroom?includeCompensation=false': fixture,
  });

  const offers = await fetchAshby('photoroom', 'Photoroom');

  assert.ok(Array.isArray(offers));
  const expectedCount = Array.isArray(fixture.jobs) ? fixture.jobs.length : 0;
  assert.equal(offers.length, expectedCount);

  if (offers.length > 0) {
    const o = offers[0];
    assert.equal(typeof o.url, 'string');
    assert.ok(o.url.length > 0);
    assert.equal(typeof o.title, 'string');
    assert.equal(o.company, 'Photoroom');
    assert.equal(typeof o.location, 'string');
    assert.equal(typeof o.body, 'string');
    assert.equal(o.platform, 'ashby');
  }
});
