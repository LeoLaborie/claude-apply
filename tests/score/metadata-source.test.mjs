import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScoreArgs } from '../../src/score/index.mjs';

test('parseScoreArgs — bare URL (scrape path)', () => {
  const f = parseScoreArgs(['https://jobs.example.com/a']);
  assert.equal(f.url, 'https://jobs.example.com/a');
  assert.equal(f.fromPipeline, false);
  assert.equal(f.company, null);
});

test('parseScoreArgs — all three metadata flags', () => {
  const f = parseScoreArgs([
    'https://jobs.example.com/a',
    '--company',
    'Acme Corp',
    '--role',
    'Software Engineer',
    '--location',
    'Paris',
  ]);
  assert.equal(f.company, 'Acme Corp');
  assert.equal(f.role, 'Software Engineer');
  assert.equal(f.location, 'Paris');
});

test('parseScoreArgs — --from-pipeline alone', () => {
  const f = parseScoreArgs(['https://jobs.example.com/a', '--from-pipeline']);
  assert.equal(f.fromPipeline, true);
  assert.equal(f.url, 'https://jobs.example.com/a');
});

test('parseScoreArgs — partial metadata flags throws', () => {
  assert.throws(
    () => parseScoreArgs(['https://jobs.example.com/a', '--company', 'Acme Corp']),
    /all-or-nothing/
  );
});

test('parseScoreArgs — --from-pipeline + --company throws', () => {
  assert.throws(
    () =>
      parseScoreArgs([
        'https://jobs.example.com/a',
        '--from-pipeline',
        '--company',
        'Acme Corp',
        '--role',
        'X',
        '--location',
        'Paris',
      ]),
    /mutually exclusive/
  );
});

test('parseScoreArgs — preserves --id and --json-input', () => {
  const f = parseScoreArgs([
    '--json-input',
    '/tmp/offer.json',
    '--id',
    '042',
  ]);
  assert.equal(f.jsonInput, '/tmp/offer.json');
  assert.equal(f.id, '042');
});
