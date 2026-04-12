import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateEmail,
  generatePassword,
  readAccounts,
  findAccount,
  writeAccount,
  markVerified,
} from '../../src/apply/workday/accounts.mjs';

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

test('readAccounts — returns [] when file does not exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wdacct-'));
  try {
    const result = readAccounts(join(dir, 'nope.yml'));
    assert.deepEqual(result, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('readAccounts — parses valid YAML', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wdacct-'));
  const file = join(dir, 'accounts.yml');
  try {
    writeFileSync(
      file,
      `accounts:
  - tenant: totalenergies
    email: leo+totalenergies@gmail.com
    password: "abc123"
    created_at: 2026-04-12T10:00:00Z
    email_verified: true
`
    );
    const result = readAccounts(file);
    assert.equal(result.length, 1);
    assert.equal(result[0].tenant, 'totalenergies');
    assert.equal(result[0].email, 'leo+totalenergies@gmail.com');
    assert.equal(result[0].email_verified, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('findAccount — returns matching account', () => {
  const accounts = [
    { tenant: 'totalenergies', email: 'a@b.com' },
    { tenant: 'sanofi', email: 'c@d.com' },
  ];
  const found = findAccount(accounts, 'sanofi');
  assert.equal(found.email, 'c@d.com');
});

test('findAccount — returns undefined when not found', () => {
  const accounts = [{ tenant: 'totalenergies', email: 'a@b.com' }];
  assert.equal(findAccount(accounts, 'missing'), undefined);
});

test('writeAccount — creates file with one account when file absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wdacct-'));
  const file = join(dir, 'accounts.yml');
  try {
    writeAccount(file, {
      tenant: 'totalenergies',
      email: 'leo+totalenergies@gmail.com',
      password: 'secret123',
    });
    const accounts = readAccounts(file);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].tenant, 'totalenergies');
    assert.equal(accounts[0].email_verified, false);
    assert.ok(accounts[0].created_at);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeAccount — appends without overwriting existing accounts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wdacct-'));
  const file = join(dir, 'accounts.yml');
  try {
    writeAccount(file, { tenant: 'totalenergies', email: 'a@b.com', password: 'pw1' });
    writeAccount(file, { tenant: 'sanofi', email: 'c@d.com', password: 'pw2' });
    const accounts = readAccounts(file);
    assert.equal(accounts.length, 2);
    assert.equal(accounts[0].tenant, 'totalenergies');
    assert.equal(accounts[1].tenant, 'sanofi');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeAccount — no .tmp file remains after write', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wdacct-'));
  const file = join(dir, 'accounts.yml');
  try {
    writeAccount(file, { tenant: 'test', email: 'x@y.com', password: 'pw' });
    assert.equal(existsSync(file + '.tmp'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('markVerified — sets email_verified to true', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wdacct-'));
  const file = join(dir, 'accounts.yml');
  try {
    writeAccount(file, { tenant: 'totalenergies', email: 'a@b.com', password: 'pw' });
    markVerified(file, 'totalenergies');
    const accounts = readAccounts(file);
    assert.equal(accounts[0].email_verified, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('markVerified — leaves other accounts unchanged', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wdacct-'));
  const file = join(dir, 'accounts.yml');
  try {
    writeAccount(file, { tenant: 'totalenergies', email: 'a@b.com', password: 'pw1' });
    writeAccount(file, { tenant: 'sanofi', email: 'c@d.com', password: 'pw2' });
    markVerified(file, 'totalenergies');
    const accounts = readAccounts(file);
    assert.equal(accounts[0].email_verified, true);
    assert.equal(accounts[1].email_verified, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('markVerified — throws when tenant not found', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wdacct-'));
  const file = join(dir, 'accounts.yml');
  try {
    writeAccount(file, { tenant: 'totalenergies', email: 'a@b.com', password: 'pw' });
    assert.throws(() => markVerified(file, 'missing'), /not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
