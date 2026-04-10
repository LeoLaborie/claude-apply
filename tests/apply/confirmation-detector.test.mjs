import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyConfirmation } from '../../src/apply/confirmation-detector.mjs';

test('detects english success text', () => {
  const r = classifyConfirmation({
    beforeUrl: 'https://jobs.lever.co/acme/abc',
    afterUrl:  'https://jobs.lever.co/acme/abc',
    pageText: 'Thank you for applying! We will be in touch soon.',
  });
  assert.equal(r.status, 'Applied');
});

test('detects french success text', () => {
  const r = classifyConfirmation({
    beforeUrl: 'https://example.com/job/x',
    afterUrl:  'https://example.com/job/x',
    pageText: 'Merci pour votre candidature. Nous reviendrons vers vous rapidement.',
  });
  assert.equal(r.status, 'Applied');
});

test('detects URL redirect to thank-you', () => {
  const r = classifyConfirmation({
    beforeUrl: 'https://boards.greenhouse.io/widgets-inc/jobs/123',
    afterUrl:  'https://boards.greenhouse.io/widgets-inc/jobs/123/confirmation',
    pageText: '',
  });
  assert.equal(r.status, 'Applied');
});

test('detects visible error', () => {
  const r = classifyConfirmation({
    beforeUrl: 'https://x/y',
    afterUrl:  'https://x/y',
    pageText: 'Please fix the errors below before submitting. Email is required.',
  });
  assert.equal(r.status, 'Failed');
});

test('returns unconfirmed when nothing matches', () => {
  const r = classifyConfirmation({
    beforeUrl: 'https://x/y',
    afterUrl:  'https://x/y',
    pageText: 'Lorem ipsum dolor sit amet.',
  });
  assert.equal(r.status, 'Submitted (unconfirmed)');
});

test('success text takes precedence over leftover error word', () => {
  const r = classifyConfirmation({
    beforeUrl: 'https://x/y',
    afterUrl:  'https://x/y/thank-you',
    pageText: 'Thank you for applying! If you notice any error, contact us.',
  });
  assert.equal(r.status, 'Applied');
});
