import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkLocation,
  checkStartDate,
  checkTitle,
  checkBlacklist,
  runPrefilter,
} from '../../src/lib/prefilter-rules.mjs';

// ---------- checkLocation ----------
test('checkLocation: pass si Paris mentionné', () => {
  assert.deepEqual(checkLocation({ body: 'Based in Paris office', title: 'ML Engineer' }), {
    pass: true,
  });
});

test('checkLocation: pass si remote France', () => {
  assert.deepEqual(checkLocation({ body: 'Remote from France accepted', title: 'Dev' }), {
    pass: true,
  });
});

test('checkLocation: reject si New York sans signal France', () => {
  const r = checkLocation({ body: 'Based in New York City, USA only', title: 'FDSE' });
  assert.equal(r.pass, false);
  assert.match(r.reason, /location/);
});

test('checkLocation: pass si NYC mais aussi Paris mentionné', () => {
  assert.deepEqual(checkLocation({ body: 'Offices in NYC and Paris', title: 'Dev' }), {
    pass: true,
  });
});

test('checkLocation: pass ambigu (aucun signal)', () => {
  assert.deepEqual(checkLocation({ body: 'Great team great tech', title: 'Dev' }), { pass: true });
});

// ---------- checkLocation with targetLocations ----------
const targets = ['France', 'Paris', 'Remote'];

test('checkLocation: pass "Paris, France" matches target "France"', () => {
  const r = checkLocation({ location: 'Paris, France', title: 'Dev', body: '' }, targets);
  assert.deepEqual(r, { pass: true });
});

test('checkLocation: reject "PRC, Shanghai" no target match', () => {
  const r = checkLocation({ location: 'PRC, Shanghai', title: 'Dev', body: '' }, targets);
  assert.equal(r.pass, false);
  assert.match(r.reason, /location/);
});

test('checkLocation: reject "Brazil - Sao Paulo"', () => {
  const r = checkLocation({ location: 'Brazil - Sao Paulo', title: 'Dev', body: '' }, targets);
  assert.equal(r.pass, false);
  assert.match(r.reason, /location/);
});

test('checkLocation: pass "Remote - France" geo segment matches', () => {
  const r = checkLocation({ location: 'Remote - France', title: 'Dev', body: '' }, targets);
  assert.deepEqual(r, { pass: true });
});

test('checkLocation: reject "Remote - US" geo segment no match', () => {
  const r = checkLocation({ location: 'Remote - US', title: 'Dev', body: '' }, targets);
  assert.equal(r.pass, false);
  assert.match(r.reason, /location/);
});

test('checkLocation: pass "Remote" alone (ambiguous, no geo qualifier)', () => {
  const r = checkLocation({ location: 'Remote', title: 'Dev', body: '' }, targets);
  assert.deepEqual(r, { pass: true });
});

test('checkLocation: reject "Taiwan-Hsinchu" hyphen separator', () => {
  const r = checkLocation({ location: 'Taiwan-Hsinchu', title: 'Dev', body: '' }, targets);
  assert.equal(r.pass, false);
  assert.match(r.reason, /location/);
});

test('checkLocation: pass "Paris, France / London, UK" one segment matches', () => {
  const r = checkLocation(
    { location: 'Paris, France / London, UK', title: 'Dev', body: '' },
    targets,
  );
  assert.deepEqual(r, { pass: true });
});

// ---------- checkLocation fallback (empty location) ----------
test('checkLocation: fallback pass body mentions Paris', () => {
  const r = checkLocation({ location: '', title: 'Dev', body: 'Based in Paris office' }, targets);
  assert.deepEqual(r, { pass: true });
});

test('checkLocation: fallback reject body mentions New York only', () => {
  const r = checkLocation(
    { location: '', title: 'FDSE', body: 'Based in New York City, USA only' },
    targets,
  );
  assert.equal(r.pass, false);
  assert.match(r.reason, /location/);
});

test('checkLocation: fallback pass no signal (ambiguous)', () => {
  const r = checkLocation({ location: '', title: 'Dev', body: 'Great team' }, targets);
  assert.deepEqual(r, { pass: true });
});

// ---------- checkStartDate ----------
test('checkStartDate: pass si septembre 2026', () => {
  assert.deepEqual(checkStartDate({ body: 'Starting September 2026' }, '2026-08-24'), {
    pass: true,
  });
});

test('checkStartDate: reject si mars 2026', () => {
  const r = checkStartDate({ body: 'Start date: March 2026' }, '2026-08-24');
  assert.equal(r.pass, false);
});

test('checkStartDate: pass si aucune date', () => {
  assert.deepEqual(checkStartDate({ body: 'Immediate start, duration 6 months' }, '2026-08-24'), {
    pass: true,
  });
});

test('checkStartDate: pass si "à partir de septembre 2026"', () => {
  assert.deepEqual(checkStartDate({ body: 'À partir de septembre 2026' }, '2026-08-24'), {
    pass: true,
  });
});

// ---------- checkTitle ----------
const wl = {
  positive: ['Intern', 'Stage', 'ML Engineer', 'Data Scientist', 'Reinforcement Learning'],
  negative: ['Senior', 'Staff', 'Sales', 'PhD'],
};

test('checkTitle: pass ML Engineer Intern', () => {
  assert.deepEqual(checkTitle({ title: 'ML Engineer Intern' }, wl), { pass: true });
});

test('checkTitle: reject Senior ML Engineer', () => {
  const r = checkTitle({ title: 'Senior ML Engineer' }, wl);
  assert.equal(r.pass, false);
  assert.match(r.reason, /negative/);
});

test('checkTitle: reject si aucun match positif', () => {
  const r = checkTitle({ title: 'Designer UX' }, wl);
  assert.equal(r.pass, false);
  assert.match(r.reason, /positive/);
});

test('checkTitle: reject Sales Intern malgré Intern', () => {
  const r = checkTitle({ title: 'Sales Intern' }, wl);
  assert.equal(r.pass, false);
  assert.match(r.reason, /negative/);
});

// ---------- checkBlacklist ----------
test('checkBlacklist: pass si entreprise non listée', () => {
  assert.deepEqual(checkBlacklist({ company: 'Mistral' }, ['acme', 'badcorp']), { pass: true });
});

test('checkBlacklist: reject case-insensitive', () => {
  const r = checkBlacklist({ company: 'ACME Inc' }, ['acme']);
  assert.equal(r.pass, false);
});

// ---------- runPrefilter (intégration) ----------
test('runPrefilter: court-circuit sur la première règle qui échoue', () => {
  const offer = { title: 'Senior Dev', body: 'Paris', company: 'Foo' };
  const config = { minStartDate: '2026-08-24', blacklist: [], whitelist: wl };
  const r = runPrefilter(offer, config);
  assert.equal(r.pass, false);
  assert.match(r.reason, /negative|title/);
});

test('runPrefilter: pass offre valide', () => {
  const offer = {
    title: 'ML Engineer Intern',
    body: 'Paris office, starting September 2026',
    company: 'Mistral',
  };
  const config = { minStartDate: '2026-08-24', blacklist: [], whitelist: wl };
  assert.deepEqual(runPrefilter(offer, config), { pass: true });
});
