// Tracks a fingerprint of the scan-filter configuration so that /scan can
// detect when the user changed title_filter / target_locations / min_start_date
// / blacklist / profile_languages and automatically re-evaluate offers that
// were previously rejected.
//
// Without this, rows appended to scan-history.tsv with a `skipped_*` status
// are deduped forever — a classic "I loosened my filter, why didn't rescan
// find anything?" bug.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Stable JSON — sort object keys recursively so two configs that differ only
// in key order hash to the same value.
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
}

export function hashFilterConfig(config) {
  const normalized = {
    whitelist: {
      positive: Array.isArray(config?.whitelist?.positive) ? [...config.whitelist.positive] : [],
      negative: Array.isArray(config?.whitelist?.negative) ? [...config.whitelist.negative] : [],
      required_any: Array.isArray(config?.whitelist?.required_any)
        ? [...config.whitelist.required_any]
        : [],
      required_any_in: Array.isArray(config?.whitelist?.required_any_in)
        ? [...config.whitelist.required_any_in]
        : [],
    },
    blacklist: Array.isArray(config?.blacklist) ? [...config.blacklist] : [],
    minStartDate: config?.minStartDate || '',
    targetLocations: Array.isArray(config?.targetLocations) ? [...config.targetLocations] : [],
    profileLanguages: Array.isArray(config?.profileLanguages)
      ? config.profileLanguages.map((l) => ({ code: l.code, level: l.level }))
      : [],
  };
  return crypto.createHash('sha256').update(stableStringify(normalized)).digest('hex').slice(0, 12);
}

export function loadFilterState(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const obj = JSON.parse(raw);
    if (typeof obj?.filter_hash !== 'string') return null;
    return obj;
  } catch {
    return null;
  }
}

export function saveFilterState(filePath, state) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload = {
    filter_hash: state.filter_hash,
    last_updated: state.last_updated || new Date().toISOString().slice(0, 10),
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

// Remove rows whose status starts with `skipped_` from the scan-history TSV.
// Returns {kept, purged} counts. Header and `added` / `error_fetch` rows are
// preserved — those are final decisions the user already saw.
export function purgeSkippedFromHistory(historyPath) {
  if (!fs.existsSync(historyPath)) return { kept: 0, purged: 0 };
  const raw = fs.readFileSync(historyPath, 'utf8');
  const lines = raw.split('\n');
  if (lines.length === 0) return { kept: 0, purged: 0 };

  const header = lines[0];
  const kept = [header];
  let purged = 0;
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const status = line.split('\t')[5] || '';
    if (status.startsWith('skipped_')) {
      purged++;
    } else {
      kept.push(line);
    }
  }
  fs.writeFileSync(historyPath, kept.join('\n') + '\n', 'utf8');
  return { kept: kept.length - 1, purged };
}
