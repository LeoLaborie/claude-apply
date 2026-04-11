import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach } from 'node:test';
import { installMockFetch } from '../helpers.mjs';
import { parseWorkdayUrl, fetchWorkday } from '../../src/scan/ats/workday.mjs';

test('parseWorkdayUrl — extracts tenant, pod, site from valid URL', () => {
  const { tenant, pod, site } = parseWorkdayUrl(
    'https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers',
  );
  assert.equal(tenant, 'totalenergies');
  assert.equal(pod, 'wd3');
  assert.equal(site, 'TotalEnergies_careers');
});

test('parseWorkdayUrl — handles trailing slash', () => {
  const { tenant, pod, site } = parseWorkdayUrl(
    'https://sanofi.wd3.myworkdayjobs.com/SanofiCareers/',
  );
  assert.equal(tenant, 'sanofi');
  assert.equal(pod, 'wd3');
  assert.equal(site, 'SanofiCareers');
});

test('parseWorkdayUrl — handles pod wd5', () => {
  const { pod } = parseWorkdayUrl(
    'https://capgemini.wd5.myworkdayjobs.com/CapgeminiCareers',
  );
  assert.equal(pod, 'wd5');
});

test('parseWorkdayUrl — ignores query string and fragment', () => {
  const { tenant, pod, site } = parseWorkdayUrl(
    'https://schneider.wd3.myworkdayjobs.com/Global?foo=bar#section',
  );
  assert.equal(tenant, 'schneider');
  assert.equal(pod, 'wd3');
  assert.equal(site, 'Global');
});

test('parseWorkdayUrl — throws on non-Workday URL', () => {
  assert.throws(
    () => parseWorkdayUrl('https://jobs.lever.co/stripe'),
    /not a Workday URL/,
  );
});

test('parseWorkdayUrl — throws on Workday URL missing site', () => {
  assert.throws(
    () => parseWorkdayUrl('https://totalenergies.wd3.myworkdayjobs.com/'),
    /not a Workday URL/,
  );
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
    { pageSize: 50 }, // > total, so only one call
  );

  assert.equal(offers.length, 3);
  const o = offers[0];
  assert.equal(o.title, 'Data Engineer - Paris');
  assert.equal(
    o.url,
    'https://totalenergies.wd3.myworkdayjobs.com/en-US/TotalEnergies_careers/job/Paris/Data-Engineer---Paris_R12345',
  );
  assert.equal(o.company, 'TotalEnergies');
  assert.equal(o.location, 'Paris, France');
  assert.equal(o.platform, 'workday');
  assert.equal(typeof o.body, 'string');
});
