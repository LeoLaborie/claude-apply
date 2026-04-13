import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installMockFetch } from '../helpers.mjs';
import {
  discoverCompany,
  slugCandidates,
  loadKnownSlugs,
} from '../../src/scan/discover-company.mjs';

let restore;
let tmpDir;
afterEach(() => {
  if (restore) restore();
  restore = null;
  if (tmpDir && fs.existsSync(tmpDir)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  tmpDir = null;
});

function mkTmp() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'discover-'));
  return tmpDir;
}

test('slugCandidates — variations Lever incluent -ai et ai', () => {
  const cands = slugCandidates('Cohere', 'lever');
  assert.ok(cands.includes('cohere'));
  assert.ok(cands.includes('cohere-ai'));
  assert.ok(cands.includes('cohereai'));
});

test('slugCandidates — variations Greenhouse incluent hq et labs', () => {
  const cands = slugCandidates('scale', 'greenhouse');
  assert.ok(cands.includes('scale'));
  assert.ok(cands.includes('scalehq'));
  assert.ok(cands.includes('scalelabs'));
});

test('slugCandidates — multi-mots produit noSpace, hyphen et alnum', () => {
  const cands = slugCandidates('Scale AI', 'ashby');
  assert.ok(cands.includes('scaleai'));
  assert.ok(cands.includes('scale-ai'));
});

test('discoverCompany — bascule sur Greenhouse quand Lever échoue', async () => {
  restore = installMockFetch({
    'https://api.lever.co/v0/postings/doctolib?mode=json': { status: 404, body: {} },
    'https://api.lever.co/v0/postings/doctolib-ai?mode=json': { status: 404, body: {} },
    'https://api.lever.co/v0/postings/doctolibai?mode=json': { status: 404, body: {} },
    'https://boards-api.greenhouse.io/v1/boards/doctolib/jobs?content=true': {
      jobs: [{ id: 1 }, { id: 2 }],
    },
  });
  const r = await discoverCompany('doctolib', { delayMs: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.platform, 'greenhouse');
  assert.equal(r.slug, 'doctolib');
  assert.equal(r.careersUrl, 'https://boards.greenhouse.io/doctolib');
  assert.equal(r.count, 2);
});

test('discoverCompany — bascule sur Ashby quand Lever et Greenhouse échouent', async () => {
  restore = installMockFetch({
    'https://api.lever.co/v0/postings/cohere?mode=json': { status: 404, body: {} },
    'https://api.lever.co/v0/postings/cohere-ai?mode=json': { status: 404, body: {} },
    'https://api.lever.co/v0/postings/cohereai?mode=json': { status: 404, body: {} },
    'https://boards-api.greenhouse.io/v1/boards/cohere/jobs?content=true': {
      status: 404,
      body: {},
    },
    'https://boards-api.greenhouse.io/v1/boards/coherehq/jobs?content=true': {
      status: 404,
      body: {},
    },
    'https://boards-api.greenhouse.io/v1/boards/coherelabs/jobs?content=true': {
      status: 404,
      body: {},
    },
    'https://boards-api.greenhouse.io/v1/boards/cohere-labs/jobs?content=true': {
      status: 404,
      body: {},
    },
    'https://api.ashbyhq.com/posting-api/job-board/cohere?includeCompensation=false': {
      jobs: [{ id: 'a' }],
    },
  });
  const r = await discoverCompany('cohere', { delayMs: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.platform, 'ashby');
  assert.equal(r.careersUrl, 'https://jobs.ashbyhq.com/cohere');
});

test('discoverCompany — cache écrit puis relu sans fetch', async () => {
  const dir = mkTmp();
  const cachePath = path.join(dir, 'known-ats-slugs.json');
  restore = installMockFetch({
    'https://api.lever.co/v0/postings/mistral?mode=json': [{ id: '1' }],
  });
  const r1 = await discoverCompany('Mistral', { delayMs: 0, cachePath });
  assert.equal(r1.ok, true);
  assert.equal(r1.platform, 'lever');
  assert.equal(r1.cached, false);

  const cache = loadKnownSlugs(cachePath);
  assert.ok(cache.mistral);
  assert.equal(cache.mistral.platform, 'lever');

  // Second call: no fetch needed (mock would throw on unexpected URL).
  restore();
  restore = installMockFetch({});
  const r2 = await discoverCompany('Mistral', { delayMs: 0, cachePath });
  assert.equal(r2.ok, true);
  assert.equal(r2.cached, true);
  assert.equal(r2.platform, 'lever');
});

test('discoverCompany — aucune correspondance renvoie ok:false', async () => {
  restore = installMockFetch({
    'https://api.lever.co/v0/postings/ghost?mode=json': { status: 404, body: {} },
    'https://api.lever.co/v0/postings/ghost-ai?mode=json': { status: 404, body: {} },
    'https://api.lever.co/v0/postings/ghostai?mode=json': { status: 404, body: {} },
    'https://boards-api.greenhouse.io/v1/boards/ghost/jobs?content=true': {
      status: 404,
      body: {},
    },
    'https://boards-api.greenhouse.io/v1/boards/ghosthq/jobs?content=true': {
      status: 404,
      body: {},
    },
    'https://boards-api.greenhouse.io/v1/boards/ghostlabs/jobs?content=true': {
      status: 404,
      body: {},
    },
    'https://boards-api.greenhouse.io/v1/boards/ghost-labs/jobs?content=true': {
      status: 404,
      body: {},
    },
    'https://api.ashbyhq.com/posting-api/job-board/ghost?includeCompensation=false': {
      status: 404,
      body: {},
    },
    'https://api.ashbyhq.com/posting-api/job-board/ghost-ai?includeCompensation=false': {
      status: 404,
      body: {},
    },
    'https://api.ashbyhq.com/posting-api/job-board/ghostai?includeCompensation=false': {
      status: 404,
      body: {},
    },
    'https://api.ashbyhq.com/posting-api/job-board/ghost-labs?includeCompensation=false': {
      status: 404,
      body: {},
    },
    'https://api.ashbyhq.com/posting-api/job-board/ghostlabs?includeCompensation=false': {
      status: 404,
      body: {},
    },
    'https://api.ashbyhq.com/posting-api/job-board/ghosthq?includeCompensation=false': {
      status: 404,
      body: {},
    },
  });
  const r = await discoverCompany('ghost', { delayMs: 0 });
  assert.equal(r.ok, false);
  assert.ok(Array.isArray(r.tried));
  assert.ok(r.tried.length >= 9);
});
