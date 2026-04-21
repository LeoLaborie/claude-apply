import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, '..', 'fixtures', 'add-company');

test('yaml parseDocument — round-trip preserves the rich-comments fixture byte-for-byte', () => {
  const raw = fs.readFileSync(path.join(FIXTURES, 'portals.rich-comments.yml'), 'utf8');
  const doc = parseDocument(raw);
  assert.equal(doc.errors.length, 0);
  assert.equal(String(doc), raw);
});
