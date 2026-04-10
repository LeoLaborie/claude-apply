import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installMockFetch } from '../helpers.mjs';
import { fetchGreenhouse, stripHtml } from '../../src/scan/ats/greenhouse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, '..', 'fixtures', 'greenhouse-anthropic.json');

let restore;
afterEach(() => {
  if (restore) restore();
});

test('stripHtml — enlève les tags et décode les entités courantes', () => {
  assert.equal(stripHtml('<p>Hello <b>world</b></p>'), 'Hello world');
  assert.equal(stripHtml('A &amp; B'), 'A & B');
  assert.equal(stripHtml('&lt;p&gt;code&lt;/p&gt;'), 'code');
  assert.equal(stripHtml('&#39;quoted&#39;'), "'quoted'");
  assert.equal(stripHtml('A &nbsp; B'), 'A   B');
  assert.equal(stripHtml(''), '');
  assert.equal(stripHtml(null), '');
});

test('fetchGreenhouse — mappe fixture, body via stripHtml', async () => {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  restore = installMockFetch({
    'https://boards-api.greenhouse.io/v1/boards/anthropic/jobs?content=true': fixture,
  });

  const offers = await fetchGreenhouse('anthropic', 'Anthropic');

  assert.ok(Array.isArray(offers));
  assert.equal(offers.length, fixture.jobs.length);

  if (offers.length > 0) {
    const o = offers[0];
    assert.equal(typeof o.url, 'string');
    assert.ok(o.url.includes('greenhouse.io') || o.url.includes('testco'));
    assert.equal(typeof o.title, 'string');
    assert.equal(o.company, 'Anthropic');
    assert.equal(typeof o.location, 'string');
    assert.equal(typeof o.body, 'string');
    // body should not contain HTML tags after stripHtml
    assert.equal(o.body.includes('<p>'), false);
    assert.equal(o.body.includes('<div'), false);
    assert.equal(o.platform, 'greenhouse');
  }
});
