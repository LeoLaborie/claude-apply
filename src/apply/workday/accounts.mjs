import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import yaml from 'js-yaml';

export function generateEmail(profileEmail, tenant) {
  const atIdx = profileEmail.indexOf('@');
  if (atIdx === -1) throw new Error('generateEmail: missing @ in email');
  let local = profileEmail.slice(0, atIdx);
  const domain = profileEmail.slice(atIdx);
  const plusIdx = local.indexOf('+');
  if (plusIdx !== -1) local = local.slice(0, plusIdx);
  return `${local}+${tenant}${domain}`;
}

export function generatePassword() {
  return randomBytes(24).toString('base64url');
}

export function readAccounts(filePath) {
  if (!existsSync(filePath)) return [];
  const doc = yaml.load(readFileSync(filePath, 'utf8'));
  return doc?.accounts ?? [];
}

export function findAccount(accounts, tenant) {
  return accounts.find((a) => a.tenant === tenant);
}

function atomicWriteAccounts(filePath, accounts) {
  mkdirSync(dirname(filePath), { recursive: true });
  const doc = yaml.dump({ accounts }, { lineWidth: -1 });
  const tmp = filePath + '.tmp';
  writeFileSync(tmp, doc);
  renameSync(tmp, filePath);
}

export function writeAccount(filePath, { tenant, email, password }) {
  const existing = readAccounts(filePath);
  if (existing.some((a) => a.tenant === tenant)) {
    throw new Error(`writeAccount: tenant '${tenant}' already exists`);
  }
  existing.push({
    tenant,
    email,
    password,
    created_at: new Date().toISOString(),
    email_verified: false,
  });
  atomicWriteAccounts(filePath, existing);
}

export function markVerified(filePath, tenant) {
  const accounts = readAccounts(filePath);
  const account = findAccount(accounts, tenant);
  if (!account) throw new Error(`markVerified: tenant '${tenant}' not found`);
  account.email_verified = true;
  atomicWriteAccounts(filePath, accounts);
}
