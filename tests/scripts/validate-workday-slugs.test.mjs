import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorkdayUrl } from '../../scripts/validate-workday-slugs.mjs';

test('buildWorkdayUrl — builds canonical URL', () => {
  const url = buildWorkdayUrl({ tenant: 'airbus', pod: 'wd3', slug: 'Airbus_Careers' });
  assert.equal(url, 'https://airbus.wd3.myworkdayjobs.com/Airbus_Careers');
});

test('buildWorkdayUrl — preserves slug casing', () => {
  const url = buildWorkdayUrl({ tenant: 'sanofi', pod: 'wd3', slug: 'SanofiCareers' });
  assert.equal(url, 'https://sanofi.wd3.myworkdayjobs.com/SanofiCareers');
});

test('buildWorkdayUrl — tenant with hyphen', () => {
  const url = buildWorkdayUrl({ tenant: 'alliance-wd', pod: 'wd3', slug: 'renault' });
  assert.equal(url, 'https://alliance-wd.wd3.myworkdayjobs.com/renault');
});

test('buildWorkdayUrl — different pod number', () => {
  const url = buildWorkdayUrl({ tenant: 't', pod: 'wd5', slug: 's' });
  assert.equal(url, 'https://t.wd5.myworkdayjobs.com/s');
});

test('buildWorkdayUrl — missing tenant throws', () => {
  assert.throws(() => buildWorkdayUrl({ pod: 'wd3', slug: 's' }), /tenant/);
});

test('buildWorkdayUrl — missing pod throws', () => {
  assert.throws(() => buildWorkdayUrl({ tenant: 't', slug: 's' }), /pod/);
});

test('buildWorkdayUrl — missing slug throws', () => {
  assert.throws(() => buildWorkdayUrl({ tenant: 't', pod: 'wd3' }), /slug/);
});
