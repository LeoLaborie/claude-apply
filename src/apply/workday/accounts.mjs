import { randomBytes } from 'node:crypto';

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
