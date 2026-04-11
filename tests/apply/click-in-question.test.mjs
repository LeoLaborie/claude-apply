import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { clickInQuestion } from '../../src/apply/dom-label.mjs';

function loadLever() {
  const html = fs.readFileSync(
    path.join(process.cwd(), 'tests/fixtures/apply/lever-question.html'),
    'utf8'
  );
  return new JSDOM(html);
}

test('clickInQuestion: scoped to the matching question (not the first Yes/No on the page)', () => {
  const dom = loadLever();
  const doc = dom.window.document;
  assert.equal(doc.querySelector('#q1-no').checked, false);
  assert.equal(doc.querySelector('#q2-no').checked, false);

  const result = clickInQuestion('final year of study', 'No', doc.body);
  assert.equal(result.choice, 'No');
  assert.ok(result.question.toLowerCase().includes('final year'));

  assert.equal(doc.querySelector('#q1-no').checked, true);
  assert.equal(doc.querySelector('#q2-no').checked, false);
});

test('clickInQuestion: unknown question throws', () => {
  const dom = loadLever();
  assert.throws(
    () => clickInQuestion('nonexistent question text', 'No', dom.window.document.body),
    /question not found/
  );
});

test('clickInQuestion: unknown choice throws', () => {
  const dom = loadLever();
  assert.throws(
    () => clickInQuestion('final year of study', 'Maybe', dom.window.document.body),
    /choice "Maybe" not found/
  );
});

test('clickInQuestion: ambiguous substring matching multiple questions throws', () => {
  const dom = loadLever();
  assert.throws(
    () => clickInQuestion('you', 'No', dom.window.document.body),
    /ambiguous questionText/
  );
  assert.equal(dom.window.document.querySelector('#q1-no').checked, false);
  assert.equal(dom.window.document.querySelector('#q2-no').checked, false);
});

test('clickInQuestion: case-insensitive substring match on question text', () => {
  const dom = loadLever();
  const doc = dom.window.document;
  clickInQuestion('FINAL YEAR', 'Yes', doc.body);
  assert.equal(doc.querySelector('#q1-yes').checked, true);
});
