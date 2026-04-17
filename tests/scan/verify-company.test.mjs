import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installMockFetch } from '../helpers.mjs';
import { verifyCompany, getSupportedHosts } from '../../src/scan/ats-detect.mjs';

let restore;
afterEach(() => {
  if (restore) restore();
});

test('verifyCompany — dispatche Lever via URL', async () => {
  restore = installMockFetch({
    'https://api.lever.co/v0/postings/mistral?mode=json': [{ id: '1' }],
  });
  const r = await verifyCompany('https://jobs.lever.co/mistral');
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
});

test('verifyCompany — dispatche Greenhouse via URL', async () => {
  restore = installMockFetch({
    'https://boards-api.greenhouse.io/v1/boards/anthropic/jobs?content=true': {
      jobs: [{ id: 1 }, { id: 2 }],
    },
  });
  const r = await verifyCompany('https://boards.greenhouse.io/anthropic');
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
});

test('verifyCompany — dispatche Ashby via URL', async () => {
  restore = installMockFetch({
    'https://api.ashbyhq.com/posting-api/job-board/hex?includeCompensation=false': {
      jobs: [{ id: 'a' }],
    },
  });
  const r = await verifyCompany('https://jobs.ashbyhq.com/hex');
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
});

test('verifyCompany — URL non reconnue renvoie ok:false', async () => {
  const r = await verifyCompany('https://careers.example.com/jobs');
  assert.equal(r.ok, false);
  assert.match(r.reason, /unknown platform/);
});

test('verifyCompany — plateforme sans verifySlug (workable) renvoie ok:false', async () => {
  const r = await verifyCompany('https://apply.workable.com/acme');
  assert.equal(r.ok, false);
  assert.match(r.reason, /not supported/i);
});

test('getSupportedHosts — retourne les 5 hôtes ATS avec fetcher vérifiable', () => {
  const hosts = getSupportedHosts();
  assert.deepEqual(hosts.sort(), [
    'https://*.myworkdayjobs.com/*',
    'https://boards.greenhouse.io/*',
    'https://job-boards.greenhouse.io/*',
    'https://jobs.ashbyhq.com/*',
    'https://jobs.lever.co/*',
  ]);
});

test('verifyCompany — dispatches Workday URL to workday.verifySlug', async () => {
  const restore = installMockFetch({
    'https://totalenergies.wd3.myworkdayjobs.com/wday/cxs/totalenergies/TotalEnergies_careers/jobs':
      { total: 5, jobPostings: [{ title: 'Test', externalPath: '/job/x' }] },
  });
  try {
    const r = await verifyCompany(
      'https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers'
    );
    assert.equal(r.ok, true);
    assert.equal(r.count, 1);
  } finally {
    restore();
  }
});

test('verifyCompany — count=0 on Ashby adds warning', async () => {
  restore = installMockFetch({
    'https://api.ashbyhq.com/posting-api/job-board/vercel?includeCompensation=false': {
      jobs: [],
    },
  });
  const r = await verifyCompany('https://jobs.ashbyhq.com/vercel');
  assert.equal(r.ok, true);
  assert.equal(r.count, 0);
  assert.match(r.warning, /board live but empty/i);
});

test('verifyCompany — count=0 on Lever adds warning', async () => {
  restore = installMockFetch({
    'https://api.lever.co/v0/postings/ghosttown?mode=json': [],
  });
  const r = await verifyCompany('https://jobs.lever.co/ghosttown');
  assert.equal(r.ok, true);
  assert.equal(r.count, 0);
  assert.match(r.warning, /board live but empty/i);
});

test('verifyCompany — count>0 does not add warning', async () => {
  restore = installMockFetch({
    'https://api.lever.co/v0/postings/mistral?mode=json': [{ id: '1' }],
  });
  const r = await verifyCompany('https://jobs.lever.co/mistral');
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.equal(r.warning, undefined);
});

test('verifyCompany — ok:false does not add warning', async () => {
  const r = await verifyCompany('https://careers.example.com/jobs');
  assert.equal(r.ok, false);
  assert.equal(r.warning, undefined);
});
