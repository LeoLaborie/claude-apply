import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractCompanyFromUrl } from '../../src/lib/extract-company.mjs';

test('Greenhouse job-boards → Doctolib', () => {
  assert.equal(
    extractCompanyFromUrl('https://job-boards.greenhouse.io/doctolib/jobs/7642865003'),
    'Doctolib'
  );
});

test('Greenhouse boards (alt) → Alan', () => {
  assert.equal(extractCompanyFromUrl('https://boards.greenhouse.io/alan/jobs/123'), 'Alan');
});

test('Lever → Stripe', () => {
  assert.equal(extractCompanyFromUrl('https://jobs.lever.co/stripe/abc-def-123'), 'Stripe');
});

test('Ashby avec tiret → Alan Health', () => {
  assert.equal(
    extractCompanyFromUrl('https://jobs.ashbyhq.com/alan-health/some-uuid'),
    'Alan Health'
  );
});

test('Workday avec locale → Stripe', () => {
  assert.equal(
    extractCompanyFromUrl('https://stripe.wd5.myworkdayjobs.com/en-US/External/job/123'),
    'Stripe'
  );
});

test('Workday sans locale → Stripe', () => {
  assert.equal(
    extractCompanyFromUrl('https://stripe.wd5.myworkdayjobs.com/External/job/123'),
    'Stripe'
  );
});

test('URL inconnue → null', () => {
  assert.equal(extractCompanyFromUrl('https://careers.company.com/jobs/123'), null);
});

test('URL malformée → null', () => {
  assert.equal(extractCompanyFromUrl('not-a-url'), null);
});

test('null → null', () => {
  assert.equal(extractCompanyFromUrl(null), null);
});

test('undefined → null', () => {
  assert.equal(extractCompanyFromUrl(undefined), null);
});

test('slug vide (double slash) → null', () => {
  assert.equal(extractCompanyFromUrl('https://jobs.lever.co//abc'), null);
});

test('slug avec underscore → Acme Corp', () => {
  assert.equal(extractCompanyFromUrl('https://jobs.lever.co/acme_corp/abc'), 'Acme Corp');
});
