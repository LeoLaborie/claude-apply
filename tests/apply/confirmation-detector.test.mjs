import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyConfirmation,
  classifyTabContext,
  suggestProbeUrls,
} from '../../src/apply/confirmation-detector.mjs';

test('detects english success text', () => {
  const r = classifyConfirmation({
    beforeUrl: 'https://jobs.lever.co/acme/abc',
    afterUrl: 'https://jobs.lever.co/acme/abc',
    pageText: 'Thank you for applying! We will be in touch soon.',
  });
  assert.equal(r.status, 'Applied');
});

test('detects french success text', () => {
  const r = classifyConfirmation({
    beforeUrl: 'https://example.com/job/x',
    afterUrl: 'https://example.com/job/x',
    pageText: 'Merci pour votre candidature. Nous reviendrons vers vous rapidement.',
  });
  assert.equal(r.status, 'Applied');
});

test('detects URL redirect to thank-you', () => {
  const r = classifyConfirmation({
    beforeUrl: 'https://boards.greenhouse.io/widgets-inc/jobs/123',
    afterUrl: 'https://boards.greenhouse.io/widgets-inc/jobs/123/confirmation',
    pageText: '',
  });
  assert.equal(r.status, 'Applied');
});

test('detects visible error', () => {
  const r = classifyConfirmation({
    beforeUrl: 'https://x/y',
    afterUrl: 'https://x/y',
    pageText: 'Please fix the errors below before submitting. Email is required.',
  });
  assert.equal(r.status, 'Failed');
});

test('returns unconfirmed when nothing matches', () => {
  const r = classifyConfirmation({
    beforeUrl: 'https://x/y',
    afterUrl: 'https://x/y',
    pageText: 'Lorem ipsum dolor sit amet.',
  });
  assert.equal(r.status, 'Submitted (unconfirmed)');
});

test('success text takes precedence over leftover error word', () => {
  const r = classifyConfirmation({
    beforeUrl: 'https://x/y',
    afterUrl: 'https://x/y/thank-you',
    pageText: 'Thank you for applying! If you notice any error, contact us.',
  });
  assert.equal(r.status, 'Applied');
});

// --- suggestProbeUrls ---

test('suggestProbeUrls returns 6 candidate URLs', () => {
  const urls = suggestProbeUrls('https://jobs.lever.co/acme/abc123');
  assert.equal(urls.length, 6);
  assert.ok(urls.includes('https://jobs.lever.co/acme/abc123/thanks'));
  assert.ok(urls.includes('https://jobs.lever.co/acme/abc123/thank-you'));
  assert.ok(urls.includes('https://jobs.lever.co/acme/abc123/confirmation'));
  assert.ok(urls.includes('https://jobs.lever.co/acme/abc123/submitted'));
  assert.ok(urls.includes('https://jobs.lever.co/acme/abc123/merci'));
  assert.ok(urls.includes('https://jobs.lever.co/acme/abc123/already-received'));
});

test('suggestProbeUrls strips trailing slash', () => {
  const urls = suggestProbeUrls('https://jobs.lever.co/acme/abc123/');
  assert.ok(urls[0].includes('abc123/thanks'));
  assert.ok(!urls[0].includes('abc123//thanks'));
});

test('suggestProbeUrls strips query string before suffixing', () => {
  const urls = suggestProbeUrls('https://jobs.lever.co/acme/abc123?source=linkedin');
  assert.ok(urls[0].includes('abc123/thanks'));
  assert.ok(!urls[0].includes('?source'));
});

test('suggestProbeUrls strips fragment before suffixing', () => {
  const urls = suggestProbeUrls('https://jobs.lever.co/acme/abc123#section');
  assert.ok(urls[0].includes('abc123/thanks'));
  assert.ok(!urls[0].includes('#'));
});

// --- classifyTabContext ---

test('classifyTabContext: title with "Thank you for applying" → Applied', () => {
  const r = classifyTabContext({
    url: 'https://jobs.lever.co/acme/abc123',
    title: 'Thank you for applying | Acme Corp',
  });
  assert.equal(r.status, 'Applied');
});

test('classifyTabContext: title with "Merci pour votre candidature" → Applied', () => {
  const r = classifyTabContext({
    url: 'https://example.com/job/x',
    title: 'Merci pour votre candidature - Example',
  });
  assert.equal(r.status, 'Applied');
});

test('classifyTabContext: URL matches /confirmation → Applied', () => {
  const r = classifyTabContext({
    url: 'https://boards.greenhouse.io/acme/jobs/123/confirmation',
    title: 'Acme Corp Careers',
  });
  assert.equal(r.status, 'Applied');
});

test('classifyTabContext: URL matches /already-received → Applied', () => {
  const r = classifyTabContext({
    url: 'https://jobs.lever.co/acme/abc123/already-received',
    title: 'Lever',
  });
  assert.equal(r.status, 'Applied');
});

test('classifyTabContext: generic title and unchanged URL → Submitted (unconfirmed)', () => {
  const r = classifyTabContext({
    url: 'https://jobs.lever.co/acme/abc123',
    title: 'Software Engineer - Acme Corp - Lever',
  });
  assert.equal(r.status, 'Submitted (unconfirmed)');
});

test('classifyTabContext: null title does not crash', () => {
  const r = classifyTabContext({
    url: 'https://jobs.lever.co/acme/abc123',
    title: null,
  });
  assert.equal(r.status, 'Submitted (unconfirmed)');
});
