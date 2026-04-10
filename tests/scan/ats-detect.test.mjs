import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform } from '../../src/scan/ats-detect.mjs';

test('detectPlatform — Lever URL → {lever, slug}', () => {
  assert.deepEqual(
    detectPlatform('https://jobs.lever.co/mistral'),
    { platform: 'lever', slug: 'mistral' }
  );
  assert.deepEqual(
    detectPlatform('https://jobs.lever.co/blablacar/'),
    { platform: 'lever', slug: 'blablacar' }
  );
});

test('detectPlatform — Greenhouse job-boards URL', () => {
  assert.deepEqual(
    detectPlatform('https://job-boards.greenhouse.io/anthropic'),
    { platform: 'greenhouse', slug: 'anthropic' }
  );
  assert.deepEqual(
    detectPlatform('https://boards.greenhouse.io/stripe'),
    { platform: 'greenhouse', slug: 'stripe' }
  );
});

test('detectPlatform — Ashby URL', () => {
  assert.deepEqual(
    detectPlatform('https://jobs.ashbyhq.com/photoroom'),
    { platform: 'ashby', slug: 'photoroom' }
  );
});

test('detectPlatform — Workable URL (avec ou sans slash)', () => {
  assert.deepEqual(
    detectPlatform('https://apply.workable.com/huggingface/'),
    { platform: 'workable', slug: 'huggingface' }
  );
  assert.deepEqual(
    detectPlatform('https://apply.workable.com/huggingface'),
    { platform: 'workable', slug: 'huggingface' }
  );
});

test('detectPlatform — URL inconnue retourne null', () => {
  assert.equal(detectPlatform('https://careers.datadoghq.com'), null);
  assert.equal(detectPlatform('https://openai.com/careers'), null);
  assert.equal(detectPlatform(''), null);
});
