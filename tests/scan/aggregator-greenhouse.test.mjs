import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMockFetch } from '../helpers.mjs';
import { fetchAggregator } from '../../src/scan/aggregators/greenhouse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixA = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'aggregators', 'greenhouse-board-a.json'),
    'utf8'
  )
);
const fixB = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'aggregators', 'greenhouse-board-b.json'),
    'utf8'
  )
);

const BOARDS = [
  { slug: 'board-a', company: 'Board A Inc' },
  { slug: 'board-b', company: 'Board B Co' },
];

const URL_A = 'https://boards-api.greenhouse.io/v1/boards/board-a/jobs?content=true';
const URL_B = 'https://boards-api.greenhouse.io/v1/boards/board-b/jobs?content=true';

let restore;
afterEach(() => {
  if (restore) restore();
});

test('fetchAggregator — agrège plusieurs boards Greenhouse en Offer[]', async () => {
  restore = installMockFetch({ [URL_A]: fixA, [URL_B]: fixB });

  const { offers, warnings } = await fetchAggregator({ boards: BOARDS });

  assert.equal(warnings.length, 0);
  assert.equal(offers.length, fixA.jobs.length + fixB.jobs.length);

  const titles = offers.map((o) => o.title).sort();
  assert.ok(titles.includes('Stage Data Science'));
  assert.ok(titles.includes('Software Engineering Intern'));

  for (const o of offers) {
    assert.equal(typeof o.url, 'string');
    assert.equal(typeof o.title, 'string');
    assert.equal(typeof o.company, 'string');
    assert.equal(typeof o.location, 'string');
    assert.equal(typeof o.body, 'string');
    assert.equal(o.platform, 'greenhouse');
    assert.equal(o.source, 'aggregator:greenhouse');
  }

  const fromBoardA = offers.filter((o) => o.company === 'Board A Inc');
  assert.equal(fromBoardA.length, fixA.jobs.length);
});

test('fetchAggregator — filtre par mots-clés (whole word, case-insensitive sur le titre)', async () => {
  restore = installMockFetch({ [URL_A]: fixA, [URL_B]: fixB });

  const { offers } = await fetchAggregator({
    boards: BOARDS,
    keywords: ['Intern', 'Stage'],
  });

  assert.ok(offers.length >= 2);
  for (const o of offers) {
    assert.ok(/\b(Intern|Stage)\b/i.test(o.title), `title rejected: ${o.title}`);
  }
  assert.ok(!offers.some((o) => o.title === 'Marketing Manager'));
  assert.ok(!offers.some((o) => o.title === 'Senior Backend Engineer'));
});

test('fetchAggregator — filtre par locations (substring, case-insensitive)', async () => {
  restore = installMockFetch({ [URL_A]: fixA, [URL_B]: fixB });

  const { offers } = await fetchAggregator({
    boards: BOARDS,
    locations: ['France'],
  });

  assert.ok(offers.length > 0);
  for (const o of offers) {
    assert.ok(/france/i.test(o.location), `location rejected: ${o.location}`);
  }
  assert.ok(!offers.some((o) => /London/i.test(o.location)));
});

test('fetchAggregator — limit tronque la liste agrégée', async () => {
  restore = installMockFetch({ [URL_A]: fixA, [URL_B]: fixB });

  const { offers } = await fetchAggregator({ boards: BOARDS, limit: 2 });
  assert.equal(offers.length, 2);
});

test('fetchAggregator — une erreur sur un board ne casse pas la moisson, warnings collectés', async () => {
  restore = installMockFetch({
    [URL_A]: fixA,
    [URL_B]: { status: 503, body: { error: 'unavailable' } },
  });

  const { offers, warnings } = await fetchAggregator({ boards: BOARDS });

  assert.equal(offers.length, fixA.jobs.length);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].slug, 'board-b');
  assert.ok(/HTTP 503/.test(warnings[0].error));
});

test('fetchAggregator — boards par défaut chargés depuis known-greenhouse-boards.json', async () => {
  const mod = await import('../../src/scan/aggregators/known-greenhouse-boards.json', {
    with: { type: 'json' },
  });
  const known = mod.default;
  assert.ok(Array.isArray(known));
  assert.ok(known.length >= 5, 'expected at least 5 known boards');
  for (const b of known) {
    assert.equal(typeof b.slug, 'string');
    assert.equal(typeof b.company, 'string');
    assert.ok(b.slug.length > 0);
    assert.ok(b.company.length > 0);
  }
});
