import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeTrackerTsv, removeTrackerTsvById } from '../../src/lib/tsv-writer.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tsv-writer-'));

afterEach(() => {
  for (const f of fs.readdirSync(tmp)) fs.unlinkSync(path.join(tmp, f));
});

test('writeTrackerTsv — formats score as X.X/10', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tsv-writer-'));
  const filePath = writeTrackerTsv(dir, {
    num: 42,
    date: '2026-04-18',
    company: 'Acme',
    role: 'ML Intern',
    score: 8.4,
    notes: 'ok',
  });
  const line = fs.readFileSync(filePath, 'utf8');
  const cells = line.trimEnd().split('\t');
  assert.equal(cells[5], '8.4/10');
  assert.ok(!line.includes('8.4/5'));
});

test('removeTrackerTsvById — supprime les fichiers préfixés par <id>-', () => {
  fs.writeFileSync(path.join(tmp, '042-acme.tsv'), 'x\n');
  fs.writeFileSync(path.join(tmp, '042-other-slug.tsv'), 'x\n');
  fs.writeFileSync(path.join(tmp, '043-kept.tsv'), 'x\n');
  fs.writeFileSync(path.join(tmp, '042.tsv'), 'x\n');

  const removed = removeTrackerTsvById(tmp, '042');
  assert.equal(removed.length, 2);
  assert.ok(removed.includes('042-acme.tsv'));
  assert.ok(removed.includes('042-other-slug.tsv'));
  const remaining = fs.readdirSync(tmp).sort();
  assert.deepEqual(remaining, ['042.tsv', '043-kept.tsv']);
});

test('removeTrackerTsvById — dir manquant renvoie tableau vide', () => {
  const removed = removeTrackerTsvById(path.join(tmp, 'missing-dir'), '001');
  assert.deepEqual(removed, []);
});

test('removeTrackerTsvById — aucun fichier matchant renvoie tableau vide', () => {
  fs.writeFileSync(path.join(tmp, '010-keep.tsv'), 'x\n');
  const removed = removeTrackerTsvById(tmp, '042');
  assert.deepEqual(removed, []);
  assert.equal(fs.existsSync(path.join(tmp, '010-keep.tsv')), true);
});
