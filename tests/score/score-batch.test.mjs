import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getScoredUrls, getAllPipelineOffers } from '../../src/score/index.mjs';

function mkTmp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'score-batch-'));
  fs.mkdirSync(path.join(d, 'data'), { recursive: true });
  return d;
}

test('getScoredUrls — returns Set of URLs from evaluations.jsonl', () => {
  const tmp = mkTmp();
  const evalPath = path.join(tmp, 'data', 'evaluations.jsonl');
  fs.writeFileSync(
    evalPath,
    [
      JSON.stringify({ id: '001', url: 'https://a.com/1' }),
      JSON.stringify({ id: '002', url: 'https://b.com/2' }),
    ].join('\n') + '\n'
  );
  const urls = getScoredUrls(evalPath);
  assert.ok(urls instanceof Set);
  assert.equal(urls.size, 2);
  assert.ok(urls.has('https://a.com/1'));
  assert.ok(urls.has('https://b.com/2'));
});

test('getScoredUrls — returns empty Set when file missing', () => {
  const urls = getScoredUrls('/tmp/nonexistent-evals.jsonl');
  assert.equal(urls.size, 0);
});

test('getAllPipelineOffers — extracts offers with location from sections', () => {
  const tmp = mkTmp();
  const pipePath = path.join(tmp, 'data', 'pipeline.md');
  fs.writeFileSync(
    pipePath,
    [
      '# Pipeline\n',
      '## Mistral AI (Paris, France)\n',
      '- [ ] https://jobs.lever.co/mistral/abc | Mistral AI | Research Intern\n',
      '- [ ] https://jobs.lever.co/mistral/def | Mistral AI | ML Engineer\n',
      '\n',
      '## Datadog (Paris)\n',
      '- [ ] https://careers.datadoghq.com/xyz | Datadog | SRE Intern\n',
    ].join('')
  );
  const offers = getAllPipelineOffers(pipePath);
  assert.equal(offers.length, 3);
  assert.deepEqual(offers[0], {
    url: 'https://jobs.lever.co/mistral/abc',
    company: 'Mistral AI',
    title: 'Research Intern',
    location: 'Paris, France',
  });
  assert.equal(offers[2].location, 'Paris');
});

test('getAllPipelineOffers — returns empty array when file missing', () => {
  const offers = getAllPipelineOffers('/tmp/nonexistent-pipeline.md');
  assert.deepEqual(offers, []);
});

test('batch dedup — filters out already-scored URLs', () => {
  const tmp = mkTmp();
  const pipePath = path.join(tmp, 'data', 'pipeline.md');
  const evalPath = path.join(tmp, 'data', 'evaluations.jsonl');

  fs.writeFileSync(
    pipePath,
    '# Pipeline\n\n## Acme (Paris)\n\n- [ ] https://a.com/1 | Acme | Role A\n- [ ] https://a.com/2 | Acme | Role B\n'
  );
  fs.writeFileSync(evalPath, JSON.stringify({ id: '001', url: 'https://a.com/1' }) + '\n');

  const scored = getScoredUrls(evalPath);
  const all = getAllPipelineOffers(pipePath);
  const pending = all.filter((o) => !scored.has(o.url));

  assert.equal(all.length, 2);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].url, 'https://a.com/2');
});

test('batch ID pre-allocation — sequential from last ID', () => {
  const tmp = mkTmp();
  const evalPath = path.join(tmp, 'data', 'evaluations.jsonl');
  fs.writeFileSync(evalPath, JSON.stringify({ id: '005', url: 'https://x.com/old' }) + '\n');

  const lines = fs.readFileSync(evalPath, 'utf8').trim().split('\n').filter(Boolean);
  let max = 0;
  for (const l of lines) {
    const n = parseInt(JSON.parse(l).id, 10);
    if (n > max) max = n;
  }
  const startId = max + 1;
  const ids = Array.from({ length: 3 }, (_, i) => String(startId + i).padStart(3, '0'));
  assert.deepEqual(ids, ['006', '007', '008']);
});
