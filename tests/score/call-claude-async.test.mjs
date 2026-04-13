import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callClaudeAsync } from '../../src/score/index.mjs';

test('callClaudeAsync — is exported and is a function', () => {
  assert.equal(typeof callClaudeAsync, 'function');
});
