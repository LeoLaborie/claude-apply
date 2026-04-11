import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOfferLine } from '../../src/lib/pipeline-md.mjs';

test('parseOfferLine — parses a standard unchecked row', () => {
  const row = parseOfferLine('- [ ] https://jobs.example.com/a | Acme Corp | Software Engineer');
  assert.deepEqual(row, {
    url: 'https://jobs.example.com/a',
    company: 'Acme Corp',
    title: 'Software Engineer',
  });
});

test('parseOfferLine — parses a checked row', () => {
  const row = parseOfferLine('- [x] https://jobs.example.com/b | Beta Ltd | Intern');
  assert.deepEqual(row, {
    url: 'https://jobs.example.com/b',
    company: 'Beta Ltd',
    title: 'Intern',
  });
});

test('parseOfferLine — tolerates extra whitespace around separators', () => {
  const row = parseOfferLine('- [ ]   https://x.co/1   |   X Inc   |   Role Name  ');
  assert.equal(row.url, 'https://x.co/1');
  assert.equal(row.company, 'X Inc');
  assert.equal(row.title, 'Role Name');
});

test('parseOfferLine — returns null for non-checkbox lines', () => {
  assert.equal(parseOfferLine('<!-- comment -->'), null);
  assert.equal(parseOfferLine('just plain text'), null);
  assert.equal(parseOfferLine(''), null);
});

test('parseOfferLine — returns null when pipes are missing', () => {
  assert.equal(parseOfferLine('- [ ] https://a.co/1'), null);
  assert.equal(parseOfferLine('- [ ] https://a.co/1 | only-company'), null);
});
