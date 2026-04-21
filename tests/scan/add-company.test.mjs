import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import os from 'node:os';
import { AddCompanyError, appendCompany } from '../../src/scan/add-company.mjs';

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
