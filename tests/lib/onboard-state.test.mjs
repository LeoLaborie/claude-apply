import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  readOnboardState,
  writeOnboardState,
  hashPortalsList,
  markPortalsApproved,
  assertPortalsApproved,
  clearPortalsApproval,
  PortalsNotApprovedError,
  PortalsApprovalLockedError,
} from '../../src/lib/onboard-state.mjs';

function tmpStatePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboard-state-'));
  return path.join(dir, '.onboard-state.json');
}

const LIST_A = [
  { name: 'Mistral AI', careers_url: 'https://jobs.lever.co/mistral', enabled: true },
  { name: 'Anthropic', careers_url: 'https://jobs.lever.co/Anthropic', enabled: true },
];

test('readOnboardState returns {} when file is missing', () => {
  const p = tmpStatePath();
  assert.deepEqual(readOnboardState(p), {});
});

test('writeOnboardState merges with existing state and preserves keys', () => {
  const p = tmpStatePath();
  writeOnboardState(p, { job_type: 'internship', target_role: 'ML' });
  writeOnboardState(p, { locations: ['Paris'] });
  assert.deepEqual(readOnboardState(p), {
    job_type: 'internship',
    target_role: 'ML',
    locations: ['Paris'],
  });
});

test('writeOnboardState leaves no .tmp file on success', () => {
  const p = tmpStatePath();
  writeOnboardState(p, { job_type: 'internship' });
  assert.equal(fs.existsSync(p + '.tmp'), false);
});

test('hashPortalsList is stable across reordering by name', () => {
  const reordered = [LIST_A[1], LIST_A[0]];
  assert.equal(hashPortalsList(LIST_A), hashPortalsList(reordered));
});

test('hashPortalsList ignores the enabled field', () => {
  const withoutEnabled = LIST_A.map(({ name, careers_url }) => ({ name, careers_url }));
  const flipped = LIST_A.map((c) => ({ ...c, enabled: false }));
  assert.equal(hashPortalsList(LIST_A), hashPortalsList(withoutEnabled));
  assert.equal(hashPortalsList(LIST_A), hashPortalsList(flipped));
});

test('hashPortalsList trims whitespace in name and careers_url', () => {
  const padded = [
    { name: '  Mistral AI  ', careers_url: ' https://jobs.lever.co/mistral ' },
    { name: 'Anthropic', careers_url: 'https://jobs.lever.co/Anthropic' },
  ];
  assert.equal(hashPortalsList(LIST_A), hashPortalsList(padded));
});

test('hashPortalsList changes when a company is added', () => {
  const extended = [
    ...LIST_A,
    { name: 'Hugging Face', careers_url: 'https://apply.workable.com/huggingface' },
  ];
  assert.notEqual(hashPortalsList(LIST_A), hashPortalsList(extended));
});

test('markPortalsApproved writes ISO timestamp and hash, preserving prior state', () => {
  const p = tmpStatePath();
  writeOnboardState(p, { job_type: 'internship' });
  markPortalsApproved(p, LIST_A);
  const state = readOnboardState(p);
  assert.equal(state.job_type, 'internship');
  assert.equal(state.portals_approved_hash, hashPortalsList(LIST_A));
  assert.match(state.portals_approved_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
});

test('assertPortalsApproved returns normally when the list matches', () => {
  const p = tmpStatePath();
  markPortalsApproved(p, LIST_A);
  assert.doesNotThrow(() => assertPortalsApproved(p, LIST_A));
});

test('assertPortalsApproved throws missing when state file is absent', () => {
  const p = tmpStatePath();
  try {
    assertPortalsApproved(p, LIST_A);
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err instanceof PortalsNotApprovedError);
    assert.equal(err.reason, 'missing');
  }
});

test('assertPortalsApproved throws missing when hash key absent', () => {
  const p = tmpStatePath();
  writeOnboardState(p, { job_type: 'internship' });
  try {
    assertPortalsApproved(p, LIST_A);
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err instanceof PortalsNotApprovedError);
    assert.equal(err.reason, 'missing');
  }
});

test('assertPortalsApproved throws hash_mismatch when list has been mutated', () => {
  const p = tmpStatePath();
  markPortalsApproved(p, LIST_A);
  const mutated = [...LIST_A, { name: 'Evil Corp', careers_url: 'https://jobs.lever.co/evil' }];
  try {
    assertPortalsApproved(p, mutated);
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err instanceof PortalsNotApprovedError);
    assert.equal(err.reason, 'hash_mismatch');
  }
});

test('markPortalsApproved is idempotent when called twice with the same list', () => {
  const p = tmpStatePath();
  markPortalsApproved(p, LIST_A);
  assert.doesNotThrow(() => markPortalsApproved(p, LIST_A));
  assert.equal(readOnboardState(p).portals_approved_hash, hashPortalsList(LIST_A));
});

test('markPortalsApproved refuses to overwrite a different approved hash', () => {
  const p = tmpStatePath();
  markPortalsApproved(p, LIST_A);
  const mutated = [...LIST_A, { name: 'Evil Corp', careers_url: 'https://jobs.lever.co/evil' }];
  try {
    markPortalsApproved(p, mutated);
    assert.fail('expected throw');
  } catch (err) {
    assert.ok(err instanceof PortalsApprovalLockedError);
  }
  assert.equal(readOnboardState(p).portals_approved_hash, hashPortalsList(LIST_A));
});

test('clearPortalsApproval lets a new list be approved and preserves prior state', () => {
  const p = tmpStatePath();
  writeOnboardState(p, { job_type: 'internship' });
  markPortalsApproved(p, LIST_A);
  clearPortalsApproval(p);
  const cleared = readOnboardState(p);
  assert.equal(cleared.portals_approved_hash, undefined);
  assert.equal(cleared.portals_approved_at, undefined);
  assert.equal(cleared.job_type, 'internship');
  const mutated = [...LIST_A, { name: 'Cohere', careers_url: 'https://jobs.lever.co/cohere' }];
  assert.doesNotThrow(() => markPortalsApproved(p, mutated));
  assert.equal(readOnboardState(p).portals_approved_hash, hashPortalsList(mutated));
});
