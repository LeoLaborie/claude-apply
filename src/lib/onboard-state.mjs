import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export class PortalsNotApprovedError extends Error {
  constructor(reason, statePath) {
    super(
      reason === 'missing'
        ? `portals.yml write blocked: no approval recorded in ${statePath}`
        : `portals.yml write blocked: list does not match the approved hash in ${statePath}`
    );
    this.name = 'PortalsNotApprovedError';
    this.reason = reason;
    this.statePath = statePath;
  }
}

export function readOnboardState(statePath) {
  if (!fs.existsSync(statePath)) return {};
  const raw = fs.readFileSync(statePath, 'utf8');
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

export function writeOnboardState(statePath, partial) {
  const current = readOnboardState(statePath);
  const next = { ...current, ...partial };
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmp = statePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, statePath);
}

export function hashPortalsList(list) {
  const normalized = list
    .map(({ name, careers_url }) => ({
      name: String(name).trim(),
      careers_url: String(careers_url).trim(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function markPortalsApproved(statePath, list) {
  writeOnboardState(statePath, {
    portals_approved_at: new Date().toISOString(),
    portals_approved_hash: hashPortalsList(list),
  });
}

export function assertPortalsApproved(statePath, list) {
  const state = readOnboardState(statePath);
  if (!state.portals_approved_hash) {
    throw new PortalsNotApprovedError('missing', statePath);
  }
  if (state.portals_approved_hash !== hashPortalsList(list)) {
    throw new PortalsNotApprovedError('hash_mismatch', statePath);
  }
}
