import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOfferLine, findOfferByUrl, parsePipelineMd } from '../../src/lib/pipeline-md.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '../fixtures', 'pipeline-for-find.md');

function loadFixture() {
  return parsePipelineMd(fs.readFileSync(fixturePath, 'utf8'));
}

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

test('findOfferByUrl — returns company, title, location when url matches', () => {
  const doc = loadFixture();
  const hit = findOfferByUrl(doc, 'https://jobs.lever.co/acme/111');
  assert.deepEqual(hit, {
    company: 'Acme Corp',
    title: 'Software Engineer',
    location: 'Paris',
  });
});

test('findOfferByUrl — picks up checked rows too', () => {
  const doc = loadFixture();
  const hit = findOfferByUrl(doc, 'https://jobs.lever.co/acme/222');
  assert.equal(hit.title, 'Data Scientist');
});

test('findOfferByUrl — matches despite trailing slash difference', () => {
  const doc = loadFixture();
  const hit = findOfferByUrl(doc, 'https://jobs.lever.co/acme/111/');
  assert.equal(hit?.company, 'Acme Corp');
});

test('findOfferByUrl — matches despite fragment', () => {
  const doc = loadFixture();
  const hit = findOfferByUrl(doc, 'https://jobs.lever.co/acme/111#apply');
  assert.equal(hit?.company, 'Acme Corp');
});

test('findOfferByUrl — matches despite host casing', () => {
  const doc = loadFixture();
  const hit = findOfferByUrl(doc, 'https://Jobs.Lever.Co/acme/111');
  assert.equal(hit?.company, 'Acme Corp');
});

test('findOfferByUrl — preserves query string (does not strip ?gh_jid=)', () => {
  const doc = loadFixture();
  const hit = findOfferByUrl(doc, 'https://boards.greenhouse.io/beta/jobs/333?gh_jid=333');
  assert.deepEqual(hit, {
    company: 'Beta Ltd',
    title: 'Backend Intern',
    location: 'Remote',
  });
});

test('findOfferByUrl — returns null when url is absent', () => {
  const doc = loadFixture();
  assert.equal(findOfferByUrl(doc, 'https://jobs.lever.co/acme/999'), null);
});

test('findOfferByUrl — returns null on empty doc', () => {
  assert.equal(findOfferByUrl({ header: '', sections: [] }, 'https://a.co/1'), null);
});
