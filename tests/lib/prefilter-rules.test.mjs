import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkLocation,
  checkStartDate,
  checkTitle,
  checkBlacklist,
  checkLanguages,
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
    targets
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
    targets
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

// ---------- checkTitle with body (required_any soft match) ----------
const wlReq = {
  positive: ['Research', 'Scientist', 'Intern'],
  negative: ['Senior'],
  required_any: ['AI', 'ML', 'Machine Learning'],
};

test('checkTitle: required_any misses title but matches body', () => {
  const offer = {
    title: 'Research Scientist Intern',
    body: 'You will work on Machine Learning research.',
  };
  const r = checkTitle(offer, wlReq, { body: offer.body });
  assert.deepEqual(r, { pass: true });
});

test('checkTitle: required_any misses both title and body → reject', () => {
  const offer = {
    title: 'Research Scientist Intern',
    body: 'You will work on distributed systems.',
  };
  const r = checkTitle(offer, wlReq, { body: offer.body });
  assert.equal(r.pass, false);
  assert.match(r.reason, /title.*required_any/);
});

test('checkTitle: body does NOT rescue negative match', () => {
  const offer = {
    title: 'Senior ML Researcher',
    body: 'ML, AI, Research, Intern',
  };
  const r = checkTitle(offer, wlReq, { body: offer.body });
  assert.equal(r.pass, false);
  assert.match(r.reason, /negative/);
});

test('checkTitle: body does NOT rescue missing positive match', () => {
  const offer = {
    title: 'Designer UX',
    body: 'We love Research and Science here.',
  };
  const r = checkTitle(offer, wlReq, { body: offer.body });
  assert.equal(r.pass, false);
  assert.match(r.reason, /no positive/);
});

test('checkTitle: no body arg behaves like before (title-only required_any)', () => {
  const offer = { title: 'Research Scientist Intern' };
  const r = checkTitle(offer, wlReq);
  assert.equal(r.pass, false);
  assert.match(r.reason, /required_any/);
});

// ---------- checkLanguages ----------
test('checkLanguages: pass when candidate has required language at C1', () => {
  const offer = { title: 'Data Scientist - Spanish speaker' };
  const profileLangs = [
    { code: 'fr', level: 'native' },
    { code: 'en', level: 'C1' },
    { code: 'es', level: 'C1' },
  ];
  assert.deepEqual(checkLanguages(offer, profileLangs), { pass: true });
});

test('checkLanguages: reject when candidate has language below B2', () => {
  const offer = { title: 'Data Scientist - Spanish speaker' };
  const profileLangs = [
    { code: 'en', level: 'C1' },
    { code: 'es', level: 'A2' },
  ];
  const r = checkLanguages(offer, profileLangs);
  assert.equal(r.pass, false);
  assert.match(r.reason, /language: requires es/);
  assert.match(r.reason, /A2/);
});

test('checkLanguages: reject when candidate lacks language entirely', () => {
  const offer = { title: 'Deutschsprachig Analyst' };
  const profileLangs = [{ code: 'en', level: 'C1' }];
  const r = checkLanguages(offer, profileLangs);
  assert.equal(r.pass, false);
  assert.match(r.reason, /language: requires de/);
  assert.match(r.reason, /none/);
});

test('checkLanguages: multi-language title needs ALL at B2+', () => {
  const offer = { title: 'Bilingual German/Spanish Analyst' };
  const profileLangs = [
    { code: 'en', level: 'C1' },
    { code: 'de', level: 'B2' },
  ];
  const r = checkLanguages(offer, profileLangs);
  assert.equal(r.pass, false);
  assert.match(r.reason, /es/);
});

test('checkLanguages: pass when no language marker in title', () => {
  const offer = { title: 'Machine Learning Engineer' };
  const profileLangs = [{ code: 'en', level: 'C1' }];
  assert.deepEqual(checkLanguages(offer, profileLangs), { pass: true });
});

test('checkLanguages: pass when profileLanguages undefined', () => {
  const offer = { title: 'Spanish speaker Sales' };
  assert.deepEqual(checkLanguages(offer, undefined), { pass: true });
});

test('checkLanguages: pass when profileLanguages empty array', () => {
  const offer = { title: 'Machine Learning Engineer' };
  assert.deepEqual(checkLanguages(offer, []), { pass: true });
});

test('checkLanguages: B2 candidate level passes threshold', () => {
  const offer = { title: 'Spanish speaker Analyst' };
  const profileLangs = [{ code: 'es', level: 'B2' }];
  assert.deepEqual(checkLanguages(offer, profileLangs), { pass: true });
});

// ---------- runPrefilter (intégration) ----------
test('runPrefilter: court-circuit sur la première règle qui échoue', () => {
  const offer = { title: 'Senior Dev', body: 'Paris', company: 'Foo', location: '' };
  const config = {
    minStartDate: '2026-08-24',
    blacklist: [],
    whitelist: wl,
    targetLocations: ['France', 'Paris', 'Remote'],
  };
  const r = runPrefilter(offer, config);
  assert.equal(r.pass, false);
  assert.match(r.reason, /negative|title/);
});

test('runPrefilter: pass offre valide', () => {
  const offer = {
    title: 'ML Engineer Intern',
    body: 'Paris office, starting September 2026',
    company: 'Mistral',
    location: 'Paris, France',
  };
  const config = {
    minStartDate: '2026-08-24',
    blacklist: [],
    whitelist: wl,
    targetLocations: ['France', 'Paris', 'Remote'],
  };
  assert.deepEqual(runPrefilter(offer, config), { pass: true });
});
