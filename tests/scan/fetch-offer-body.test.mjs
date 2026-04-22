import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchOfferBody, _resetWarnings } from '../../src/scan/fetch-offer-body.mjs';

beforeEach(() => _resetWarnings());

test('fetchOfferBody: lever with body → returns body', async () => {
  const res = await fetchOfferBody({
    platform: 'lever',
    body: 'Join our team to build ML.',
    url: 'https://jobs.lever.co/mistral/abc',
  });
  assert.equal(res, 'Join our team to build ML.');
});

test('fetchOfferBody: greenhouse with body → returns body', async () => {
  const res = await fetchOfferBody({
    platform: 'greenhouse',
    body: 'We are hiring.',
    url: 'https://example.com',
  });
  assert.equal(res, 'We are hiring.');
});

test('fetchOfferBody: ashby with body → returns body', async () => {
  const res = await fetchOfferBody({
    platform: 'ashby',
    body: 'We build LLMs.',
    url: 'https://jobs.ashbyhq.com/foo/abc',
  });
  assert.equal(res, 'We build LLMs.');
});

test('fetchOfferBody: empty body → returns null', async () => {
  const res = await fetchOfferBody({
    platform: 'lever',
    body: '',
    url: 'https://jobs.lever.co/mistral/abc',
  });
  assert.equal(res, null);
});

test('fetchOfferBody: missing body field → returns null', async () => {
  const res = await fetchOfferBody({
    platform: 'greenhouse',
    url: 'https://example.com',
  });
  assert.equal(res, null);
});

test('fetchOfferBody: workday → returns null (limitation)', async () => {
  const res = await fetchOfferBody({
    platform: 'workday',
    body: '',
    url: 'https://foo.wd1.myworkdayjobs.com/en-US/site/job/abc',
  });
  assert.equal(res, null);
});

test('fetchOfferBody: unknown platform → returns null', async () => {
  const res = await fetchOfferBody({
    platform: 'custom',
    body: 'text',
    url: 'https://example.com',
  });
  assert.equal(res, null);
});
