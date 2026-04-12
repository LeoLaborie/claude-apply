import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateEmail, generatePassword } from '../../src/apply/workday/accounts.mjs';

test('generateEmail — inserts +tenant before @', () => {
  assert.equal(generateEmail('leo@gmail.com', 'totalenergies'), 'leo+totalenergies@gmail.com');
});

test('generateEmail — replaces existing +tag', () => {
  assert.equal(generateEmail('leo+perso@gmail.com', 'sanofi'), 'leo+sanofi@gmail.com');
});

test('generateEmail — throws on missing @', () => {
  assert.throws(() => generateEmail('nope', 'tenant'), /missing @/);
});

test('generatePassword — returns 32-char base64url string', () => {
  const pw = generatePassword();
  assert.equal(pw.length, 32);
  assert.match(pw, /^[A-Za-z0-9_-]+$/);
});

test('generatePassword — returns unique values', () => {
  const a = generatePassword();
  const b = generatePassword();
  assert.notEqual(a, b);
});
