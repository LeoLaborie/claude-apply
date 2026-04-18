import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLocation } from '../../src/score/location-extractor.mjs';

// ---------- ld+json ----------
test('extractLocation: ld+json jobLocation.address.addressLocality', () => {
  const ldJsonBlocks = [
    JSON.stringify({
      '@type': 'JobPosting',
      jobLocation: { address: { addressLocality: 'Paris' } },
    }),
  ];
  const r = extractLocation({ ldJsonBlocks, ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: 'Paris', source: 'jsonld' });
});

test('extractLocation: ld+json array jobLocation picks first', () => {
  const ldJsonBlocks = [
    JSON.stringify({
      '@type': 'JobPosting',
      jobLocation: [
        { address: { addressLocality: 'Lyon' } },
        { address: { addressLocality: 'Nantes' } },
      ],
    }),
  ];
  const r = extractLocation({ ldJsonBlocks, ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: 'Lyon', source: 'jsonld' });
});

test('extractLocation: ld+json falls back to addressRegion', () => {
  const ldJsonBlocks = [
    JSON.stringify({
      '@type': 'JobPosting',
      jobLocation: { address: { addressRegion: 'Île-de-France' } },
    }),
  ];
  const r = extractLocation({ ldJsonBlocks, ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: 'Île-de-France', source: 'jsonld' });
});

test('extractLocation: malformed ld+json block is skipped', () => {
  const ldJsonBlocks = [
    'not-json',
    JSON.stringify({
      '@type': 'JobPosting',
      jobLocation: { address: { addressLocality: 'Berlin' } },
    }),
  ];
  const r = extractLocation({ ldJsonBlocks, ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: 'Berlin', source: 'jsonld' });
});

test('extractLocation: ld+json non-JobPosting @type is skipped', () => {
  const ldJsonBlocks = [
    JSON.stringify({
      '@type': 'Organization',
      jobLocation: { address: { addressLocality: 'ShouldNotAppear' } },
    }),
  ];
  const r = extractLocation({ ldJsonBlocks, ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: null, source: null });
});

test('extractLocation: ld+json @type array containing JobPosting matches', () => {
  const ldJsonBlocks = [
    JSON.stringify({
      '@type': ['JobPosting', 'Thing'],
      jobLocation: { address: { addressLocality: 'Madrid' } },
    }),
  ];
  const r = extractLocation({ ldJsonBlocks, ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: 'Madrid', source: 'jsonld' });
});

test('extractLocation: ld+json @type array without JobPosting is skipped', () => {
  const ldJsonBlocks = [
    JSON.stringify({
      '@type': ['Thing', 'Organization'],
      jobLocation: { address: { addressLocality: 'ShouldNotAppear' } },
    }),
  ];
  const r = extractLocation({ ldJsonBlocks, ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: null, source: null });
});

test('extractLocation: ld+json @graph wrapper is unwrapped', () => {
  const ldJsonBlocks = [
    JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Organization', name: 'Acme' },
        {
          '@type': 'JobPosting',
          jobLocation: { address: { addressLocality: 'London' } },
        },
      ],
    }),
  ];
  const r = extractLocation({ ldJsonBlocks, ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: 'London', source: 'jsonld' });
});

test('extractLocation: ld+json top-level array of nodes is supported', () => {
  const ldJsonBlocks = [
    JSON.stringify([
      { '@type': 'Organization', name: 'Acme' },
      {
        '@type': 'JobPosting',
        jobLocation: { address: { addressLocality: 'Rome' } },
      },
    ]),
  ];
  const r = extractLocation({ ldJsonBlocks, ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: 'Rome', source: 'jsonld' });
});

test('extractLocation: ld+json empty / missing blocks returns null at that strategy', () => {
  const r1 = extractLocation({
    ldJsonBlocks: [],
    ogLocation: '',
    cssLocation: '',
    bodyText: '',
  });
  assert.deepEqual(r1, { location: null, source: null });

  const r2 = extractLocation({ ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r2, { location: null, source: null });
});

// ---------- meta / og ----------
test('extractLocation: og:location when ld+json absent', () => {
  const r = extractLocation({
    ldJsonBlocks: [],
    ogLocation: 'Paris',
    cssLocation: '',
    bodyText: '',
  });
  assert.deepEqual(r, { location: 'Paris', source: 'meta' });
});

test('extractLocation: malformed ld+json + valid ogLocation falls through', () => {
  const r = extractLocation({
    ldJsonBlocks: ['not-json'],
    ogLocation: 'Lyon',
    cssLocation: '',
    bodyText: '',
  });
  assert.deepEqual(r, { location: 'Lyon', source: 'meta' });
});

// ---------- dom ----------
test('extractLocation: cssLocation when higher strategies empty', () => {
  const r = extractLocation({
    ldJsonBlocks: [],
    ogLocation: '',
    cssLocation: 'Berlin',
    bodyText: '',
  });
  assert.deepEqual(r, { location: 'Berlin', source: 'dom' });
});

test('extractLocation: cssLocation whitespace-only is treated as empty', () => {
  const r = extractLocation({
    ldJsonBlocks: [],
    ogLocation: '',
    cssLocation: '   \n ',
    bodyText: '',
  });
  assert.deepEqual(r, { location: null, source: null });
});

// ---------- regex on body ----------
test('extractLocation: regex Location: Paris', () => {
  const r = extractLocation({
    ldJsonBlocks: [],
    ogLocation: '',
    cssLocation: '',
    bodyText: 'Some intro\nLocation: Paris\nMore body',
  });
  assert.deepEqual(r, { location: 'Paris', source: 'regex' });
});

test('extractLocation: regex Lieu : Lyon (French)', () => {
  const r = extractLocation({
    ldJsonBlocks: [],
    ogLocation: '',
    cssLocation: '',
    bodyText: 'Détails\nLieu : Lyon\nFin',
  });
  assert.deepEqual(r, { location: 'Lyon', source: 'regex' });
});

test('extractLocation: regex emoji 📍 Berlin', () => {
  const r = extractLocation({
    ldJsonBlocks: [],
    ogLocation: '',
    cssLocation: '',
    bodyText: '📍 Berlin\n',
  });
  assert.deepEqual(r, { location: 'Berlin', source: 'regex' });
});

test('extractLocation: no signals returns null', () => {
  const r = extractLocation({ ldJsonBlocks: [], ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: null, source: null });
});
