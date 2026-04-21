import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import os from 'node:os';
import { AddCompanyError, appendCompany, findByCareersUrl, toggleEnabled } from '../../src/scan/add-company.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '..', 'fixtures', 'add-company');

test('AddCompanyError — exposes code and message', () => {
  const err = new AddCompanyError('SHAPE_INVALID', 'tracked_companies is not a sequence');
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'AddCompanyError');
  assert.equal(err.code, 'SHAPE_INVALID');
  assert.equal(err.message, 'tracked_companies is not a sequence');
});

test('AddCompanyError — accepts details object', () => {
  const err = new AddCompanyError('POST_PARSE_FAILED', 'reparse failed', { errors: ['x'] });
  assert.deepEqual(err.details, { errors: ['x'] });
});

function copyFixture(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'add-company-'));
  const dst = path.join(dir, 'portals.yml');
  fs.copyFileSync(path.join(FIXTURES, name), dst);
  return { dir, path: dst };
}

test('appendCompany — appends a new entry and returns index + total', () => {
  const { path: p } = copyFixture('portals.rich-comments.yml');
  const result = appendCompany(p, {
    name: 'Hugging Face',
    careersUrl: 'https://apply.workable.com/huggingface',
  });
  assert.equal(result.total, 4);
  assert.equal(result.entryIndex, 3);
  assert.deepEqual(result.entry, {
    name: 'Hugging Face',
    careers_url: 'https://apply.workable.com/huggingface',
    enabled: true,
  });
});

test('appendCompany — preserves header comment and inter-entry block comment', () => {
  const { path: p } = copyFixture('portals.rich-comments.yml');
  appendCompany(p, {
    name: 'Hugging Face',
    careersUrl: 'https://apply.workable.com/huggingface',
  });
  const out = fs.readFileSync(p, 'utf8');
  assert.ok(out.includes('# Companies to scan for open positions.'));
  assert.ok(out.includes('# Block comment between entries'));
  assert.ok(out.includes('# Domain is implicit in company name — skip required_any filter'));
});

test('appendCompany — the new entry has name, careers_url, enabled in that order', () => {
  const { path: p } = copyFixture('portals.rich-comments.yml');
  appendCompany(p, {
    name: 'Hugging Face',
    careersUrl: 'https://apply.workable.com/huggingface',
  });
  const out = fs.readFileSync(p, 'utf8');
  const doc = parseDocument(out);
  const list = doc.get('tracked_companies', true);
  const last = list.items[list.items.length - 1];
  assert.equal(last.get('name'), 'Hugging Face');
  assert.equal(last.get('careers_url'), 'https://apply.workable.com/huggingface');
  assert.equal(last.get('enabled'), true);
});

test('appendCompany — throws SHAPE_INVALID when tracked_companies is missing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'add-company-'));
  const p = path.join(dir, 'portals.yml');
  fs.writeFileSync(p, 'title_filter: {}\n');
  assert.throws(
    () => appendCompany(p, { name: 'x', careersUrl: 'https://jobs.lever.co/x' }),
    (err) => err.code === 'SHAPE_INVALID'
  );
});

test('yaml parseDocument — round-trip preserves the rich-comments fixture byte-for-byte', () => {
  const raw = fs.readFileSync(path.join(FIXTURES, 'portals.rich-comments.yml'), 'utf8');
  const doc = parseDocument(raw);
  assert.equal(doc.errors.length, 0);
  assert.equal(String(doc), raw);
});

test('findByCareersUrl — returns {index, node} when URL matches', () => {
  const raw = fs.readFileSync(path.join(FIXTURES, 'portals.rich-comments.yml'), 'utf8');
  const doc = parseDocument(raw);
  const match = findByCareersUrl(doc, 'https://jobs.lever.co/Anthropic');
  assert.equal(match.index, 1);
  assert.equal(match.node.get('name'), 'Anthropic');
});

test('findByCareersUrl — case-strict on URL', () => {
  const raw = fs.readFileSync(path.join(FIXTURES, 'portals.rich-comments.yml'), 'utf8');
  const doc = parseDocument(raw);
  assert.equal(findByCareersUrl(doc, 'https://jobs.lever.co/anthropic'), null);
});

test('findByCareersUrl — returns null when no match', () => {
  const raw = fs.readFileSync(path.join(FIXTURES, 'portals.rich-comments.yml'), 'utf8');
  const doc = parseDocument(raw);
  assert.equal(findByCareersUrl(doc, 'https://jobs.lever.co/zzz'), null);
});

test('toggleEnabled — flips enabled: false to true on matching entry', () => {
  const { path: p } = copyFixture('portals.disabled-entry.yml');
  const raw = fs.readFileSync(p, 'utf8');
  const doc = parseDocument(raw);
  const result = toggleEnabled(doc, 'https://jobs.lever.co/oldco');
  assert.equal(result.status, 'toggled');
  assert.equal(result.name, 'OldCo');
  fs.writeFileSync(p, String(doc));
  const out = fs.readFileSync(p, 'utf8');
  const reparsed = parseDocument(out);
  const list = reparsed.get('tracked_companies', true);
  assert.equal(list.items[1].get('enabled'), true);
  assert.equal(list.items[1].get('skip_required_any'), true);
  assert.deepEqual(list.items[1].get('target_locations').toJSON(), ['Paris', 'Remote']);
  assert.ok(out.includes('# Inline reason — must survive toggle.'));
});

test('toggleEnabled — returns already-enabled when entry is already true', () => {
  const { path: p } = copyFixture('portals.disabled-entry.yml');
  const doc = parseDocument(fs.readFileSync(p, 'utf8'));
  const result = toggleEnabled(doc, 'https://jobs.lever.co/mistral');
  assert.equal(result.status, 'already-enabled');
  assert.equal(result.name, 'Mistral AI');
});

test('toggleEnabled — returns null when careers_url is not found', () => {
  const { path: p } = copyFixture('portals.disabled-entry.yml');
  const doc = parseDocument(fs.readFileSync(p, 'utf8'));
  assert.equal(toggleEnabled(doc, 'https://nope'), null);
});
