import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkdayUrl } from '../../src/scan/ats/workday.mjs';

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
