import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkdayUrl } from '../../scripts/seed-workday-slugs.mjs';

test('parseWorkdayUrl — plain URL without locale segment', () => {
  const result = parseWorkdayUrl('https://airbus.wd3.myworkdayjobs.com/Airbus_Careers');
  assert.deepEqual(result, { tenant: 'airbus', pod: 'wd3', slug: 'Airbus_Careers' });
});

test('parseWorkdayUrl — URL with locale segment (en-US)', () => {
  const result = parseWorkdayUrl('https://sanofi.wd3.myworkdayjobs.com/en-US/SanofiCareers');
  assert.deepEqual(result, { tenant: 'sanofi', pod: 'wd3', slug: 'SanofiCareers' });
});

test('parseWorkdayUrl — URL with locale segment (fr-FR)', () => {
  const result = parseWorkdayUrl('https://michelinhr.wd3.myworkdayjobs.com/fr-FR/Michelin');
  assert.deepEqual(result, { tenant: 'michelinhr', pod: 'wd3', slug: 'Michelin' });
});

test('parseWorkdayUrl — different pod number', () => {
  const result = parseWorkdayUrl('https://tenant.wd5.myworkdayjobs.com/board');
  assert.deepEqual(result, { tenant: 'tenant', pod: 'wd5', slug: 'board' });
});

test('parseWorkdayUrl — tenant with hyphen', () => {
  const result = parseWorkdayUrl('https://alliance-wd.wd3.myworkdayjobs.com/renault-group-careers');
  assert.deepEqual(result, { tenant: 'alliance-wd', pod: 'wd3', slug: 'renault-group-careers' });
});

test('parseWorkdayUrl — http (not https) accepted', () => {
  const result = parseWorkdayUrl('http://ag.wd3.myworkdayjobs.com/Airbus');
  assert.deepEqual(result, { tenant: 'ag', pod: 'wd3', slug: 'Airbus' });
});

test('parseWorkdayUrl — non-Workday URL returns null', () => {
  assert.equal(parseWorkdayUrl('https://jobs.lever.co/mistral'), null);
});

test('parseWorkdayUrl — malformed URL returns null', () => {
  assert.equal(parseWorkdayUrl('not a url'), null);
});

test('parseWorkdayUrl — URL missing slug returns null', () => {
  assert.equal(parseWorkdayUrl('https://airbus.wd3.myworkdayjobs.com/'), null);
});

test('parseWorkdayUrl — empty string returns null', () => {
  assert.equal(parseWorkdayUrl(''), null);
});

test('parseWorkdayUrl — null input returns null', () => {
  assert.equal(parseWorkdayUrl(null), null);
});
