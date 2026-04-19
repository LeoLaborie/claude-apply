import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { write } from '../../src/lib/portals-writer.mjs';

function copyFixture() {
  const src = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    '..',
    'fixtures',
    'portals',
    'with-comments.yml'
  );
  const dst = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'portals-')), 'portals.yml');
  fs.copyFileSync(src, dst);
  return dst;
}

test('write adds new positive keywords and preserves comments', () => {
  const file = copyFixture();
  write(file, { title_filter: { positive: ['Intern', 'Stage', 'Stagiaire'] } });
  const out = fs.readFileSync(file, 'utf8');
  assert.match(out, /# Companies to scan for open positions\./);
  assert.match(out, /# positive and negative terms match WHOLE WORDS\./);
  assert.match(out, /- Stagiaire/);
});

test('write updates required_any and preserves comments in other blocks', () => {
  const file = copyFixture();
  write(file, { title_filter: { required_any: ['ML', 'AI'] } });
  const after = fs.readFileSync(file, 'utf8');
  assert.ok(/required_any:/.test(after));
  assert.ok(/\bML\b/.test(after) && /\bAI\b/.test(after));
  assert.match(after, /# Companies to scan for open positions\./);
  assert.match(after, /# Optional exclusion keywords\./);
  assert.match(after, /# Domain filter layered on top\./);
});

test('write round-trips without losing comments when mutations is empty', () => {
  const file = copyFixture();
  write(file, {});
  const after = fs.readFileSync(file, 'utf8');
  assert.match(after, /# Companies to scan for open positions\./);
  assert.match(after, /# positive and negative terms match WHOLE WORDS\./);
  assert.match(after, /# Optional exclusion keywords\./);
  assert.match(after, /# Domain filter layered on top\./);
});

test('write throws when portals file missing', () => {
  assert.throws(() => write('/nonexistent/portals.yml', { title_filter: { positive: ['X'] } }));
});
