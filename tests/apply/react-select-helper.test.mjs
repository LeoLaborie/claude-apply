import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  matchOptionText,
  ReactSelectError,
  REACT_SELECT_SNIPPET,
} from '../../src/apply/react-select-helper.mjs';

test('matchOptionText: exact trimmed match wins', () => {
  assert.equal(matchOptionText(['Non', 'Oui', 'NON'], 'Non'), 'Non');
});

test('matchOptionText: case-insensitive exact wins over startsWith', () => {
  assert.equal(matchOptionText(['Nonante', 'NON'], 'non'), 'NON');
});

test('matchOptionText: startsWith picks first prefix match', () => {
  assert.equal(
    matchOptionText(['France métropolitaine', 'Francophonie'], 'France'),
    'France métropolitaine'
  );
});

test('matchOptionText: returns null when no match', () => {
  assert.equal(matchOptionText(['Oui', 'Non'], 'Peut-être'), null);
});

test('matchOptionText: handles empty array', () => {
  assert.equal(matchOptionText([], 'Anything'), null);
});

test('matchOptionText: trims whitespace from options and target', () => {
  assert.equal(matchOptionText(['  Non  '], ' Non '), '  Non  ');
});

test('ReactSelectError: extends Error with code and optional found', () => {
  const err = new ReactSelectError('OPTION_NOT_FOUND', 'missing', {
    found: ['A', 'B'],
  });
  assert.ok(err instanceof Error);
  assert.ok(err instanceof ReactSelectError);
  assert.equal(err.code, 'OPTION_NOT_FOUND');
  assert.equal(err.message, 'missing');
  assert.deepEqual(err.found, ['A', 'B']);
});

test('ReactSelectError: found defaults to undefined', () => {
  const err = new ReactSelectError('CONTROL_NOT_FOUND', 'nope');
  assert.equal(err.found, undefined);
});

test('REACT_SELECT_SNIPPET: is a non-empty string', () => {
  assert.equal(typeof REACT_SELECT_SNIPPET, 'string');
  assert.ok(REACT_SELECT_SNIPPET.length > 200);
});

test('REACT_SELECT_SNIPPET: references all required selectors', () => {
  for (const sel of ['select__control', 'select__menu', 'select__option', 'select__single-value']) {
    assert.ok(REACT_SELECT_SNIPPET.includes(sel), `snippet missing selector ${sel}`);
  }
});

test('REACT_SELECT_SNIPPET: references all four error codes', () => {
  for (const code of [
    'CONTROL_NOT_FOUND',
    'MENU_NOT_OPENED',
    'OPTION_NOT_FOUND',
    'SELECTION_NOT_APPLIED',
  ]) {
    assert.ok(REACT_SELECT_SNIPPET.includes(code), `snippet missing code ${code}`);
  }
});

test('REACT_SELECT_SNIPPET: uses mousedown (not just click)', () => {
  assert.ok(REACT_SELECT_SNIPPET.includes('mousedown'));
});

test('REACT_SELECT_SNIPPET: exposes controlSelector and optionText bindings', () => {
  assert.ok(REACT_SELECT_SNIPPET.includes('controlSelector'));
  assert.ok(REACT_SELECT_SNIPPET.includes('optionText'));
});
