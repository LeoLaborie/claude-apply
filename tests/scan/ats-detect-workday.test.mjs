import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorkdayFromRegistry, listWorkdayRegistry } from '../../src/scan/ats-detect.mjs';

test('resolveWorkdayFromRegistry — returns full URL for known tenant', () => {
  const url = resolveWorkdayFromRegistry('totalenergies');
  assert.equal(url, 'https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers');
});

test('resolveWorkdayFromRegistry — returns null for unknown tenant', () => {
  assert.equal(resolveWorkdayFromRegistry('inconnu'), null);
});

test('resolveWorkdayFromRegistry — is case-insensitive', () => {
  const url = resolveWorkdayFromRegistry('Sanofi');
  assert.equal(url, 'https://sanofi.wd3.myworkdayjobs.com/SanofiCareers');
});

test('listWorkdayRegistry — returns non-empty array', () => {
  const list = listWorkdayRegistry();
  assert.ok(Array.isArray(list));
  assert.ok(list.length > 0);
});

test('listWorkdayRegistry — each entry has required fields', () => {
  for (const entry of listWorkdayRegistry()) {
    assert.equal(typeof entry.tenant, 'string');
    assert.equal(typeof entry.pod, 'string');
    assert.equal(typeof entry.site, 'string');
    assert.equal(typeof entry.company, 'string');
  }
});
