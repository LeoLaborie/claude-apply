import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTitle } from '../../src/lib/prefilter-rules.mjs';

test('checkTitle: "stage" matches "Stage Data Science"', () => {
  const wl = { positive: ['stage'], negative: [] };
  assert.deepEqual(checkTitle({ title: 'Stage Data Science' }, wl), { pass: true });
});

test('checkTitle: "stage" does NOT match "Backstage Portal"', () => {
  const wl = { positive: ['stage'], negative: [] };
  const r = checkTitle({ title: 'Backstage Portal' }, wl);
  assert.equal(r.pass, false);
  assert.match(r.reason, /no positive match/);
});

test('checkTitle: "intern" matches "Summer Intern 2026"', () => {
  const wl = { positive: ['intern'], negative: [] };
  assert.deepEqual(checkTitle({ title: 'Summer Intern 2026' }, wl), { pass: true });
});

test('checkTitle: "intern" does NOT match "Interns wanted" (plural — \\b on both sides)', () => {
  const wl = { positive: ['intern'], negative: [] };
  const r = checkTitle({ title: 'Interns wanted' }, wl);
  assert.equal(r.pass, false);
});

test('checkTitle: "intern" does NOT match "International Trade"', () => {
  const wl = { positive: ['intern'], negative: [] };
  const r = checkTitle({ title: 'International Trade' }, wl);
  assert.equal(r.pass, false);
  assert.match(r.reason, /no positive match/);
});

test('checkTitle: positive is case-insensitive', () => {
  const wl = { positive: ['STAGE'], negative: [] };
  assert.deepEqual(checkTitle({ title: 'stage data' }, wl), { pass: true });
});

test('checkTitle: negative match short-circuits positive', () => {
  const wl = { positive: ['intern'], negative: ['sales'] };
  const r = checkTitle({ title: 'Sales Intern' }, wl);
  assert.equal(r.pass, false);
  assert.match(r.reason, /negative match "sales"/);
});

test('checkTitle: negative "stage" does NOT match "Backstage"', () => {
  const wl = { positive: ['engineer'], negative: ['stage'] };
  assert.deepEqual(checkTitle({ title: 'Backstage Engineer' }, wl), { pass: true });
});

test('checkTitle: "/^stage\\b/i" matches "Stage Data" (anchored)', () => {
  const wl = { positive: ['/^stage\\b/i'], negative: [] };
  assert.deepEqual(checkTitle({ title: 'Stage Data' }, wl), { pass: true });
});

test('checkTitle: "/^stage\\b/i" does NOT match "Full Stage"', () => {
  const wl = { positive: ['/^stage\\b/i'], negative: [] };
  const r = checkTitle({ title: 'Full Stage' }, wl);
  assert.equal(r.pass, false);
});

test('checkTitle: regex escape hatch is case-insensitive even without /i flag', () => {
  const wl = { positive: ['/^stage\\b/'], negative: [] };
  assert.deepEqual(checkTitle({ title: 'STAGE DATA' }, wl), { pass: true });
});

test('checkTitle: empty positive list → reject', () => {
  const wl = { positive: [], negative: [] };
  const r = checkTitle({ title: 'Anything' }, wl);
  assert.equal(r.pass, false);
  assert.match(r.reason, /no positive match/);
});

test('checkTitle: required_any uses word-boundary (regression guard)', () => {
  const wl = { positive: ['engineer'], negative: [], required_any: ['intern'] };
  const r = checkTitle({ title: 'International Engineer' }, wl);
  assert.equal(r.pass, false);
  assert.match(r.reason, /required_any/);
});

test('checkTitle: required_any matches keyword in body (issue #40 regression)', () => {
  const wl = { positive: ['intern'], negative: [], required_any: ['machine learning'] };
  const offer = {
    title: 'Software Engineering Intern - Data Platform',
    body: 'You will work on our machine learning infrastructure team.',
  };
  assert.deepEqual(checkTitle(offer, wl), { pass: true });
});

test('checkTitle: required_any fails when keyword absent from both title and body', () => {
  const wl = { positive: ['intern'], negative: [], required_any: ['machine learning'] };
  const offer = {
    title: 'Marketing Intern',
    body: 'Help us plan social media campaigns and write blog posts.',
  };
  const r = checkTitle(offer, wl);
  assert.equal(r.pass, false);
  assert.match(r.reason, /missing required_any keyword/);
});

test('checkTitle: required_any still matches when keyword is only in title', () => {
  const wl = { positive: ['intern'], negative: [], required_any: ['ml'] };
  assert.deepEqual(checkTitle({ title: 'ML Intern', body: '' }, wl), { pass: true });
});

test('checkTitle: required_any fails cleanly on empty body (Workday case)', () => {
  const wl = { positive: ['intern'], negative: [], required_any: ['ml'] };
  const r = checkTitle({ title: 'Software Engineering Intern', body: '' }, wl);
  assert.equal(r.pass, false);
  assert.match(r.reason, /missing required_any keyword/);
});

test('checkTitle: required_any accepts regex escape hatch', () => {
  const wl = { positive: ['engineer'], negative: [], required_any: ['/^ml\\b/i'] };
  assert.deepEqual(checkTitle({ title: 'ML Engineer' }, wl), { pass: true });
});

test('checkTitle: invalid regex escape hatch rejects cleanly without crashing', () => {
  const wl = { positive: ['/[unclosed/'], negative: [] };
  const r = checkTitle({ title: 'Anything' }, wl);
  assert.equal(r.pass, false);
  assert.match(r.reason, /invalid title_filter term/);
  assert.match(r.reason, /\[unclosed/);
});

test('checkTitle: empty required_any array is a no-op (skip_required_any support)', () => {
  const wl = { positive: ['intern'], negative: [], required_any: [] };
  assert.deepEqual(checkTitle({ title: 'Research Intern' }, wl), { pass: true });
});
