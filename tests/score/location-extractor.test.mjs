import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLocation } from '../../src/score/location-extractor.mjs';

// ---------- ld+json ----------
test('extractLocation: ld+json jobLocation.address.addressLocality', () => {
  const ldJsonRaw = JSON.stringify({
    '@type': 'JobPosting',
    jobLocation: { address: { addressLocality: 'Paris' } },
  });
  const r = extractLocation({ ldJsonRaw, ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: 'Paris', source: 'jsonld' });
});
