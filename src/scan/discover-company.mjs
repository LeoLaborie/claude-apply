// Smart-discovery for an ATS slug given only a company name.
// Tries platform-specific slug variations against the JSON APIs and
// returns the first hit. Optionally caches successful resolutions in
// data/known-ats-slugs.json so subsequent runs are instant.
//
// CLI: node src/scan/discover-company.mjs "<CompanyName>" [--cache-path <path>] [--workday-registry <path>]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySlug as verifyLever } from './ats/lever.mjs';
import { verifySlug as verifyGreenhouse } from './ats/greenhouse.mjs';
import { verifySlug as verifyAshby } from './ats/ashby.mjs';
import { verifySlug as verifyWorkable } from './ats/workable.mjs';
import { loadSlugRegistry, lookupWorkdaySlug } from './ats/workday-slugs.mjs';

const VERIFIERS = {
  lever: verifyLever,
  greenhouse: verifyGreenhouse,
  ashby: verifyAshby,
  workable: verifyWorkable,
};

const CAREERS_URL = {
  lever: (slug) => `https://jobs.lever.co/${slug}`,
  greenhouse: (slug) => `https://boards.greenhouse.io/${slug}`,
  ashby: (slug) => `https://jobs.ashbyhq.com/${slug}`,
  workable: (slug) => `https://apply.workable.com/${slug}`,
};

export function slugCandidates(name, platform) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return [];
  const lower = trimmed.toLowerCase();
  const noSpace = lower.replace(/\s+/g, '');
  const hyphen = lower.replace(/\s+/g, '-');
  const alnum = noSpace.replace(/[^a-z0-9]/g, '');
  const base = new Set([lower, noSpace, hyphen, alnum].filter(Boolean));

  const extras = new Set();
  for (const b of base) {
    extras.add(`${b}-`);
    if (platform === 'lever') {
      extras.add(`${b}-ai`);
      extras.add(`${b}ai`);
    } else if (platform === 'greenhouse') {
      extras.add(`${b}hq`);
      extras.add(`${b}labs`);
      extras.add(`${b}-labs`);
    } else if (platform === 'ashby') {
      extras.add(`${b}-ai`);
      extras.add(`${b}ai`);
      extras.add(`${b}-labs`);
      extras.add(`${b}labs`);
      extras.add(`${b}hq`);
    } else if (platform === 'workable') {
      extras.add(`${b}-careers`);
      extras.add(`${b}hq`);
      extras.add(`${b}-hq`);
    }
  }
  return [...base, ...extras].filter((s) => !s.includes(' '));
}

export function loadKnownSlugs(cachePath) {
  if (!cachePath || !fs.existsSync(cachePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return {};
  }
}

export function saveKnownSlug(cachePath, key, entry) {
  if (!cachePath) return;
  const current = loadKnownSlugs(cachePath);
  current[key] = entry;
  fs.mkdirSync(cachePath.replace(/\/[^/]+$/, ''), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(current, null, 2) + '\n');
}

function cacheKey(name) {
  return String(name).trim().toLowerCase();
}

export async function discoverCompany(name, options = {}) {
  const {
    cachePath = null,
    workdayRegistryPath = null,
    delayMs = 100,
    platforms = ['lever', 'greenhouse', 'ashby', 'workable'],
    verifiers = VERIFIERS,
  } = options;

  const key = cacheKey(name);
  if (!key) return { ok: false, reason: 'empty name' };

  const cache = loadKnownSlugs(cachePath);
  if (cache[key]) {
    return { ok: true, cached: true, ...cache[key] };
  }

  const tried = [];
  for (const platform of platforms) {
    const verify = verifiers[platform];
    if (!verify) continue;
    for (const slug of slugCandidates(name, platform)) {
      tried.push({ platform, slug });
      const r = await verify(slug);
      if (r.ok && (r.count ?? 0) > 0) {
        const entry = {
          platform,
          slug,
          careersUrl: CAREERS_URL[platform](slug),
          count: r.count,
        };
        saveKnownSlug(cachePath, key, entry);
        return { ok: true, cached: false, ...entry };
      }
      if (delayMs > 0) await new Promise((res) => setTimeout(res, delayMs));
    }
  }

  if (workdayRegistryPath && fs.existsSync(workdayRegistryPath)) {
    try {
      const reg = loadSlugRegistry(workdayRegistryPath);
      const w = lookupWorkdaySlug(reg, name);
      if (w) {
        const careersUrl = `https://${w.tenant}.${w.pod}.myworkdayjobs.com/${w.slug}`;
        const entry = { platform: 'workday', slug: w.slug, careersUrl, count: null };
        saveKnownSlug(cachePath, key, entry);
        return { ok: true, cached: false, ...entry };
      }
    } catch {
      // ignore registry errors
    }
  }

  return { ok: false, reason: 'no slug matched', tried };
}

export async function main({
  argv = process.argv,
  verifiers,
  _write = (s) => process.stdout.write(s),
} = {}) {
  const args = argv.slice(2).filter((a) => !a.startsWith('--'));
  const flags = argv.slice(2).filter((a) => a.startsWith('--'));

  const name = args[0];
  if (!name) {
    process.stderr.write(
      'Usage: node src/scan/discover-company.mjs "<CompanyName>" [--cache-path <path>] [--workday-registry <path>]\n'
    );
    return 1;
  }

  const flag = (key) => {
    const idx = flags.indexOf(key);
    return idx >= 0 ? argv[argv.indexOf(key) + 1] : null;
  };

  const cachePath = flag('--cache-path');
  const workdayRegistryPath = flag('--workday-registry');
  const delayMs = Number(process.env.DISCOVER_DELAY_MS ?? 100);

  const __repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const resolvedCache = cachePath ? path.resolve(__repoRoot, cachePath) : null;
  const resolvedRegistry = workdayRegistryPath
    ? path.resolve(__repoRoot, workdayRegistryPath)
    : null;

  const result = await discoverCompany(name, {
    cachePath: resolvedCache,
    workdayRegistryPath: resolvedRegistry,
    delayMs,
    verifiers,
  });

  _write(JSON.stringify(result) + '\n');
  return 0;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main()
    .then(process.exit)
    .catch((err) => {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    });
}
