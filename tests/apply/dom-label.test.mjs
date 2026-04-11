import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { extractLabel } from '../../src/apply/dom-label.mjs';

function loadFixture(rel) {
  const html = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  return new JSDOM(html);
}

test('extractLabel: Lever cards[uuid] radio picks up .application-question .text', () => {
  const dom = loadFixture('tests/fixtures/apply/lever-question.html');
  const input = dom.window.document.querySelector(
    'input[name="cards[abc-uuid][field0]"][value="Yes"]'
  );
  assert.equal(extractLabel(input), 'Are you currently in your final year of study?');
});

test('extractLabel: second Lever question is resolved independently', () => {
  const dom = loadFixture('tests/fixtures/apply/lever-question.html');
  const input = dom.window.document.querySelector(
    'input[name="cards[def-uuid][field0]"][value="No"]'
  );
  assert.equal(
    extractLabel(input),
    'Do you have authorization to work in the country of employment?'
  );
});

test('extractLabel: plain <label for> (Greenhouse-style)', () => {
  const dom = loadFixture('tests/fixtures/apply/greenhouse-form.html');
  const input = dom.window.document.querySelector('#first_name');
  assert.equal(extractLabel(input), 'First Name');
});

test('extractLabel: Ashby data-qa container', () => {
  const dom = loadFixture('tests/fixtures/apply/ashby-question.html');
  const input = dom.window.document.querySelector('#ashby-auth');
  assert.equal(extractLabel(input), 'What is your current work authorization status?');
});

test('extractLabel: orphan input returns empty string', () => {
  const dom = loadFixture('tests/fixtures/apply/lever-question.html');
  const input = dom.window.document.querySelector('#orphan');
  assert.equal(extractLabel(input), '');
});
