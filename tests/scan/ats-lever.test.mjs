import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMockFetch } from '../helpers.mjs';
import { fetchLever } from '../../src/scan/ats/lever.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'fixtures', 'lever-mistral.json');

let restore;
afterEach(() => { if (restore) restore(); });

test('fetchLever — mappe correctement une fixture réelle', async () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  restore = installMockFetch({
    'https://api.lever.co/v0/postings/mistral?mode=json': fixture,
  });

  const offers = await fetchLever('mistral', 'Mistral AI');

  assert.ok(Array.isArray(offers), 'retourne un array');
  assert.equal(offers.length, fixture.length, 'même nombre que la fixture');

  if (offers.length > 0) {
    const o = offers[0];
    assert.equal(typeof o.url, 'string');
    assert.ok(o.url.startsWith('https://jobs.lever.co/mistral/'));
    assert.equal(typeof o.title, 'string');
    assert.ok(o.title.length > 0);
    assert.equal(o.company, 'Mistral AI');
    assert.equal(typeof o.location, 'string');
    assert.equal(typeof o.body, 'string');
    assert.equal(o.platform, 'lever');
  }
});

test('fetchLever — array vide si API retourne []', async () => {
  restore = installMockFetch({
    'https://api.lever.co/v0/postings/empty-co?mode=json': [],
  });
  const offers = await fetchLever('empty-co', 'EmptyCo');
  assert.deepEqual(offers, []);
});
