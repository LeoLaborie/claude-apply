import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'node:test';
import { installMockFetch } from '../helpers.mjs';
import { parseWorkdayUrl, fetchWorkday, verifySlug, lookupRegistry } from '../../src/scan/ats/workday.mjs';

test('parseWorkdayUrl — extracts tenant, pod, site from valid URL', () => {
  const { tenant, pod, site } = parseWorkdayUrl(
    'https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers'
  );
  assert.equal(tenant, 'totalenergies');
  assert.equal(pod, 'wd3');
  assert.equal(site, 'TotalEnergies_careers');
});

test('parseWorkdayUrl — handles trailing slash', () => {
  const { tenant, pod, site } = parseWorkdayUrl(
    'https://sanofi.wd3.myworkdayjobs.com/SanofiCareers/'
  );
  assert.equal(tenant, 'sanofi');
  assert.equal(pod, 'wd3');
  assert.equal(site, 'SanofiCareers');
});

test('parseWorkdayUrl — handles pod wd5', () => {
  const { pod } = parseWorkdayUrl('https://capgemini.wd5.myworkdayjobs.com/CapgeminiCareers');
  assert.equal(pod, 'wd5');
});

test('parseWorkdayUrl — ignores query string and fragment', () => {
  const { tenant, pod, site } = parseWorkdayUrl(
    'https://schneider.wd3.myworkdayjobs.com/Global?foo=bar#section'
  );
  assert.equal(tenant, 'schneider');
  assert.equal(pod, 'wd3');
  assert.equal(site, 'Global');
});

test('parseWorkdayUrl — throws on non-Workday URL', () => {
  assert.throws(() => parseWorkdayUrl('https://jobs.lever.co/stripe'), /not a Workday URL/);
});

test('parseWorkdayUrl — throws on Workday URL missing site', () => {
  assert.throws(
    () => parseWorkdayUrl('https://totalenergies.wd3.myworkdayjobs.com/'),
    /not a Workday URL/
  );
});

test('parseWorkdayUrl — strips en-US locale prefix from URL', () => {
  const { tenant, pod, site } = parseWorkdayUrl(
    'https://totalenergies.wd3.myworkdayjobs.com/en-US/TotalEnergies_careers'
  );
  assert.equal(tenant, 'totalenergies');
  assert.equal(pod, 'wd3');
  assert.equal(site, 'TotalEnergies_careers');
});

test('parseWorkdayUrl — strips fr-FR locale prefix', () => {
  const { site } = parseWorkdayUrl('https://sanofi.wd3.myworkdayjobs.com/fr-FR/SanofiCareers');
  assert.equal(site, 'SanofiCareers');
});

test('lookupRegistry — returns entry for known tenant', () => {
  const entry = lookupRegistry('sanofi');
  assert.deepEqual(entry, {
    tenant: 'sanofi',
    pod: 'wd3',
    site: 'SanofiCareers',
    company: 'Sanofi',
  });
});

test('lookupRegistry — returns null for unknown tenant', () => {
  assert.equal(lookupRegistry('unknown-corp'), null);
});

test('lookupRegistry — is case-insensitive on tenant', () => {
  const entry = lookupRegistry('Sanofi');
  assert.equal(entry.tenant, 'sanofi');
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fx1Path = path.join(__dirname, '..', 'fixtures', 'workday-totalenergies-page1.json');
const fx2Path = path.join(__dirname, '..', 'fixtures', 'workday-totalenergies-page2.json');

let restore;
afterEach(() => {
  if (restore) restore();
});

test('fetchWorkday — single page, maps postings to Offer contract', async () => {
  const fixture = JSON.parse(fs.readFileSync(fx1Path, 'utf8'));
  restore = installMockFetch({
    'https://totalenergies.wd3.myworkdayjobs.com/wday/cxs/totalenergies/TotalEnergies_careers/jobs':
      fixture,
  });

  const offers = await fetchWorkday(
    'https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers',
    'TotalEnergies',
    { pageSize: 50 } // > total, so only one call
  );

  assert.equal(offers.length, 3);
  const o = offers[0];
  assert.equal(o.title, 'Data Engineer - Paris');
  assert.equal(
    o.url,
    'https://totalenergies.wd3.myworkdayjobs.com/en-US/TotalEnergies_careers/job/Paris/Data-Engineer---Paris_R12345'
  );
  assert.equal(o.company, 'TotalEnergies');
  assert.equal(o.location, 'Paris, France');
  assert.equal(o.platform, 'workday');
  assert.equal(typeof o.body, 'string');
});

function installSequentialMockFetch(url, responses) {
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = async (reqUrl) => {
    const key = typeof reqUrl === 'string' ? reqUrl : reqUrl.toString();
    if (key !== url) throw new Error(`sequentialMock: unexpected URL ${key}`);
    if (i >= responses.length) throw new Error(`sequentialMock: exhausted (called ${i + 1} times)`);
    const body = responses[i++];
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  return () => {
    globalThis.fetch = original;
  };
}

test('fetchWorkday — paginates until a partial page is returned', async () => {
  const page1 = JSON.parse(fs.readFileSync(fx1Path, 'utf8'));
  const page2 = JSON.parse(fs.readFileSync(fx2Path, 'utf8'));
  restore = installSequentialMockFetch(
    'https://totalenergies.wd3.myworkdayjobs.com/wday/cxs/totalenergies/TotalEnergies_careers/jobs',
    [page1, page2]
  );

  const offers = await fetchWorkday(
    'https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers',
    'TotalEnergies',
    { pageSize: 3 } // page1 has 3 (full), page2 has 1 (partial → stop)
  );

  assert.equal(offers.length, 4);
  assert.equal(offers[0].title, 'Data Engineer - Paris');
  assert.equal(offers[3].title, 'Cloud Infrastructure Engineer');
});

test('fetchWorkday — stops on first empty page', async () => {
  restore = installSequentialMockFetch(
    'https://sanofi.wd3.myworkdayjobs.com/wday/cxs/sanofi/SanofiCareers/jobs',
    [{ total: 0, jobPostings: [] }]
  );

  const offers = await fetchWorkday(
    'https://sanofi.wd3.myworkdayjobs.com/SanofiCareers',
    'Sanofi',
    { pageSize: 20 }
  );

  assert.equal(offers.length, 0);
});

test('fetchWorkday — throws on HTTP error', async () => {
  restore = installMockFetch({
    'https://broken.wd3.myworkdayjobs.com/wday/cxs/broken/BrokenSite/jobs': {
      status: 500,
      body: { error: 'nope' },
    },
  });

  await assert.rejects(
    () =>
      fetchWorkday('https://broken.wd3.myworkdayjobs.com/BrokenSite', 'Broken', { pageSize: 20 }),
    /HTTP 500/
  );
});

test('verifySlug — returns ok with count on valid response', async () => {
  const page1 = JSON.parse(fs.readFileSync(fx1Path, 'utf8'));
  restore = installMockFetch({
    'https://totalenergies.wd3.myworkdayjobs.com/wday/cxs/totalenergies/TotalEnergies_careers/jobs':
      page1,
  });

  const r = await verifySlug('https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers');
  assert.equal(r.ok, true);
  assert.equal(r.count, 3);
});

test('verifySlug — returns ok with count 0 on empty response', async () => {
  restore = installMockFetch({
    'https://sanofi.wd3.myworkdayjobs.com/wday/cxs/sanofi/SanofiCareers/jobs': {
      total: 0,
      jobPostings: [],
    },
  });

  const r = await verifySlug('https://sanofi.wd3.myworkdayjobs.com/SanofiCareers');
  assert.equal(r.ok, true);
  assert.equal(r.count, 0);
});

test('verifySlug — returns ko on HTTP 404', async () => {
  restore = installMockFetch({
    'https://missing.wd3.myworkdayjobs.com/wday/cxs/missing/Nope/jobs': {
      status: 404,
      body: {},
    },
  });

  const r = await verifySlug('https://missing.wd3.myworkdayjobs.com/Nope');
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
  assert.match(r.reason, /HTTP 404/);
});

test('verifySlug — returns ko on non-Workday URL', async () => {
  const r = await verifySlug('https://jobs.lever.co/stripe');
  assert.equal(r.ok, false);
  assert.match(r.reason, /not a Workday URL/);
});
