import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
import { AddCompanyError } from '../../src/scan/add-company.mjs';

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

test('yaml parseDocument — round-trip preserves the rich-comments fixture byte-for-byte', () => {
  const raw = fs.readFileSync(path.join(FIXTURES, 'portals.rich-comments.yml'), 'utf8');
  const doc = parseDocument(raw);
  assert.equal(doc.errors.length, 0);
  assert.equal(String(doc), raw);
});
