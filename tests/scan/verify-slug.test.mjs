import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMockFetch } from '../helpers.mjs';
import { verifySlug as verifyLever } from '../../src/scan/ats/lever.mjs';
import { verifySlug as verifyGreenhouse } from '../../src/scan/ats/greenhouse.mjs';

let restore;
afterEach(() => {
  if (restore) restore();
});

test('verifySlug (lever) — slug valide avec postings', async () => {
  restore = installMockFetch({
    'https://api.lever.co/v0/postings/mistral?mode=json': [{ id: '1' }, { id: '2' }],
  });
  const r = await verifyLever('mistral');
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
});

test('verifySlug (lever) — slug valide avec 0 posting', async () => {
  restore = installMockFetch({
    'https://api.lever.co/v0/postings/empty-co?mode=json': [],
  });
  const r = await verifyLever('empty-co');
  assert.equal(r.ok, true);
  assert.equal(r.count, 0);
});

test('verifySlug (lever) — slug invalide renvoie ok:false + status', async () => {
  restore = installMockFetch({
    'https://api.lever.co/v0/postings/nope?mode=json': { status: 404, body: {} },
  });
  const r = await verifyLever('nope');
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.match(r.reason, /HTTP 404/);
});

test('verifySlug (greenhouse) — slug valide avec postings', async () => {
  restore = installMockFetch({
    'https://boards-api.greenhouse.io/v1/boards/anthropic/jobs?content=true': {
      jobs: [{ id: 1 }, { id: 2 }, { id: 3 }],
    },
  });
  const r = await verifyGreenhouse('anthropic');
  assert.equal(r.ok, true);
  assert.equal(r.count, 3);
});

test('verifySlug (greenhouse) — board vide', async () => {
  restore = installMockFetch({
    'https://boards-api.greenhouse.io/v1/boards/quiet-co/jobs?content=true': { jobs: [] },
  });
  const r = await verifyGreenhouse('quiet-co');
  assert.equal(r.ok, true);
  assert.equal(r.count, 0);
});

test('verifySlug (greenhouse) — slug invalide 404', async () => {
  restore = installMockFetch({
    'https://boards-api.greenhouse.io/v1/boards/nope/jobs?content=true': {
      status: 404,
      body: {},
    },
  });
  const r = await verifyGreenhouse('nope');
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
});
