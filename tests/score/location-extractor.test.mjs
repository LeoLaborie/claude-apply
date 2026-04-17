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

test('extractLocation: ld+json array jobLocation picks first', () => {
  const ldJsonRaw = JSON.stringify({
    '@type': 'JobPosting',
    jobLocation: [
      { address: { addressLocality: 'Lyon' } },
      { address: { addressLocality: 'Nantes' } },
    ],
  });
  const r = extractLocation({ ldJsonRaw, ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: 'Lyon', source: 'jsonld' });
});

test('extractLocation: ld+json falls back to addressRegion', () => {
  const ldJsonRaw = JSON.stringify({
    '@type': 'JobPosting',
    jobLocation: { address: { addressRegion: 'Île-de-France' } },
  });
  const r = extractLocation({ ldJsonRaw, ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: 'Île-de-France', source: 'jsonld' });
});

test('extractLocation: malformed ld+json block is skipped', () => {
  const ldJsonRaw =
    'not-json\n---\n' +
    JSON.stringify({
      '@type': 'JobPosting',
      jobLocation: { address: { addressLocality: 'Berlin' } },
    });
  const r = extractLocation({ ldJsonRaw, ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: 'Berlin', source: 'jsonld' });
});

test('extractLocation: ld+json non-JobPosting @type is skipped', () => {
  const ldJsonRaw = JSON.stringify({
    '@type': 'Organization',
    jobLocation: { address: { addressLocality: 'ShouldNotAppear' } },
  });
  const r = extractLocation({ ldJsonRaw, ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: null, source: null });
});

// ---------- meta / og ----------
test('extractLocation: og:location when ld+json absent', () => {
  const r = extractLocation({
    ldJsonRaw: '',
    ogLocation: 'Paris',
    cssLocation: '',
    bodyText: '',
  });
  assert.deepEqual(r, { location: 'Paris', source: 'meta' });
});

test('extractLocation: malformed ld+json + valid ogLocation falls through', () => {
  const r = extractLocation({
    ldJsonRaw: 'not-json',
    ogLocation: 'Lyon',
    cssLocation: '',
    bodyText: '',
  });
  assert.deepEqual(r, { location: 'Lyon', source: 'meta' });
});

// ---------- dom ----------
test('extractLocation: cssLocation when higher strategies empty', () => {
  const r = extractLocation({
    ldJsonRaw: '',
    ogLocation: '',
    cssLocation: 'Berlin',
    bodyText: '',
  });
  assert.deepEqual(r, { location: 'Berlin', source: 'dom' });
});

test('extractLocation: cssLocation whitespace-only is treated as empty', () => {
  const r = extractLocation({
    ldJsonRaw: '',
    ogLocation: '',
    cssLocation: '   \n ',
    bodyText: '',
  });
  assert.deepEqual(r, { location: null, source: null });
});

// ---------- regex on body ----------
test('extractLocation: regex Location: Paris', () => {
  const r = extractLocation({
    ldJsonRaw: '',
    ogLocation: '',
    cssLocation: '',
    bodyText: 'Some intro\nLocation: Paris\nMore body',
  });
  assert.deepEqual(r, { location: 'Paris', source: 'regex' });
});

test('extractLocation: regex Lieu : Lyon (French)', () => {
  const r = extractLocation({
    ldJsonRaw: '',
    ogLocation: '',
    cssLocation: '',
    bodyText: 'Détails\nLieu : Lyon\nFin',
  });
  assert.deepEqual(r, { location: 'Lyon', source: 'regex' });
});

test('extractLocation: regex emoji 📍 Berlin', () => {
  const r = extractLocation({
    ldJsonRaw: '',
    ogLocation: '',
    cssLocation: '',
    bodyText: '📍 Berlin\n',
  });
  assert.deepEqual(r, { location: 'Berlin', source: 'regex' });
});

test('extractLocation: no signals returns null', () => {
  const r = extractLocation({ ldJsonRaw: '', ogLocation: '', cssLocation: '', bodyText: '' });
  assert.deepEqual(r, { location: null, source: null });
});
