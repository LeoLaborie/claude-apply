#!/usr/bin/env node
// Portal scanner for Group A companies (API-friendly ATS: Lever, Greenhouse,
// Ashby, Workable, Workday). Zero LLM tokens, zero Playwright. Reads portals.yml +
// candidate-profile.yml for blacklist / min_start_date overrides,
// dispatches to src/scan/ats/{platform}.mjs, applies runPrefilter(), appends
// results to pipeline.md + scan-history.tsv + filtered-out.tsv.
//
// Usage:
//   node src/scan/index.mjs                  # scan all enabled Group A companies
//   node src/scan/index.mjs --only <slug>    # scan a single company by ATS slug
//   node src/scan/index.mjs --dry-run        # compute everything, write nothing
//   node src/scan/index.mjs --json           # emit structured JSON to stdout

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectPlatform } from './ats-detect.mjs';
import { fetchLever } from './ats/lever.mjs';
import { fetchGreenhouse } from './ats/greenhouse.mjs';
import { fetchAshby } from './ats/ashby.mjs';
import { fetchWorkable } from './ats/workable.mjs';
import { fetchWorkday } from './ats/workday.mjs';
import { fetchAggregator as fetchGreenhouseAggregator } from './aggregators/greenhouse.mjs';
import { runPrefilter } from '../lib/prefilter-rules.mjs';
import { fetchOfferBody } from './fetch-offer-body.mjs';
import { appendFilteredOut } from '../lib/jsonl-writer.mjs';
import { readPipelineMd, appendOffer, writePipelineMd } from '../lib/pipeline-md.mjs';
import { loadSeenUrls, appendHistoryRow } from '../lib/scan-history.mjs';
import { loadProfile } from '../lib/load-profile.mjs';
import { MissingConfigError, requireConfig } from '../lib/config-loader.mjs';
import { pLimit } from '../lib/p-limit.mjs';
import {
  hashFilterConfig,
  loadFilterState,
  saveFilterState,
  purgeSkippedFromHistory,
} from '../lib/scan-filter-state.mjs';

const FETCH_CONCURRENCY = 6;
const FETCH_RETRY_DELAY_MS = 750;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DISPATCH = {
  lever: fetchLever,
  greenhouse: fetchGreenhouse,
  ashby: fetchAshby,
  workable: fetchWorkable,
  workday: fetchWorkday,
};

const AGGREGATOR_DISPATCH = {
  greenhouse: fetchGreenhouseAggregator,
};

const VALID_SOURCES = new Set(['ats', 'aggregator', 'all']);

async function fetchAggregatorOffers(aggregatorsConfig) {
  const results = [];
  if (!aggregatorsConfig || typeof aggregatorsConfig !== 'object') return results;
  for (const [name, cfg] of Object.entries(aggregatorsConfig)) {
    if (!cfg || cfg.enabled === false) continue;
    const fn = AGGREGATOR_DISPATCH[name];
    if (!fn) {
      results.push({
        company: `${name} aggregator`,
        platform: `aggregator:${name}`,
        offers: [],
        fetchWarnings: [],
        error: `unknown aggregator "${name}"`,
      });
      continue;
    }
    try {
      const fnArgs = {
        keywords: cfg.keywords || [],
        locations: cfg.locations || [],
        limit: cfg.limit ?? Infinity,
      };
      if (Array.isArray(cfg.boards) && cfg.boards.length > 0) {
        fnArgs.boards = cfg.boards;
      }
      const { offers, warnings } = await fn(fnArgs);
      results.push({
        company: `${name} aggregator`,
        platform: `aggregator:${name}`,
        offers,
        fetchWarnings: (warnings || []).map((w) => `${w.slug}: ${w.error}`),
        error: null,
      });
    } catch (err) {
      results.push({
        company: `${name} aggregator`,
        platform: `aggregator:${name}`,
        offers: [],
        fetchWarnings: [],
        error: err?.message || 'aggregator fetch failed',
      });
    }
  }
  return results;
}

function reasonToStatus(reason) {
  if (!reason) return 'skipped_other';
  if (reason.startsWith('title:')) return 'skipped_title';
  if (reason.startsWith('blacklist:')) return 'skipped_blacklist';
  if (reason.startsWith('language:')) return 'skipped_language';
  if (reason.startsWith('location:')) return 'skipped_location';
  if (reason.startsWith('start_date:')) return 'skipped_date';
  return 'skipped_other';
}

async function fetchCompanyOffers(company) {
  const det = detectPlatform(company.careers_url);
  if (!det) {
    return { company: company.name, platform: null, offers: [], error: 'platform not detected' };
  }
  const fn = DISPATCH[det.platform];
  if (!fn) {
    return { company: company.name, platform: det.platform, offers: [], error: 'no fetcher' };
  }
  let opts;
  if (det.platform === 'workday') {
    opts = {
      onProgress: (e) => {
        if (e.type === 'term_start') {
          process.stderr.write(`[workday ${e.tenant}] fetching "${e.term}"…\n`);
        } else if (e.type === 'term_done') {
          process.stderr.write(
            `[workday ${e.tenant}] "${e.term}" done — ${e.pages} pages, ${e.total} offers total\n`
          );
        }
      },
    };
  }

  let lastError = null;
  // Retry once on transient network errors (e.g. "fetch failed" from concurrent
  // ATS calls). A 750 ms backoff is enough to clear most rate-limits without
  // slowing the happy path.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = opts ? await fn(det.slug, company.name, opts) : await fn(det.slug, company.name);
      const offers = Array.isArray(raw) ? raw : raw.offers;
      const fetchWarnings = Array.isArray(raw) ? [] : raw.warnings || [];
      return { company: company.name, platform: det.platform, offers, fetchWarnings, error: null };
    } catch (err) {
      lastError = err;
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, FETCH_RETRY_DELAY_MS));
      }
    }
  }
  return {
    company: company.name,
    platform: det.platform,
    offers: [],
    fetchWarnings: [],
    error: lastError?.message || 'fetch failed',
  };
}

export async function runScan(opts) {
  const {
    portalsConfig,
    profile,
    pipelinePath,
    historyPath,
    filteredPath,
    applicationsPath,
    filterStatePath = null,
    dryRun = false,
    onlySlug = null,
    onProgress = null,
    source = 'ats',
  } = opts;

  if (!VALID_SOURCES.has(source)) {
    throw new Error(`runScan: invalid source "${source}" (expected ats|aggregator|all)`);
  }

  const whitelist = portalsConfig.title_filter || { positive: [], negative: [] };
  const targetLocations =
    profile.target_locations || [profile.country, profile.city, 'Remote'].filter(Boolean);
  const prefilterConfig = {
    whitelist,
    blacklist: profile.blacklist_companies || [],
    minStartDate: profile.min_start_date || '2026-08-24',
    targetLocations,
    profileLanguages: profile.languages || [],
    fetchBody: fetchOfferBody,
  };

  // Filter-change detection: if the user changed title_filter / targetLocations
  // / min_start_date / blacklist / languages since the last scan, we purge all
  // `skipped_*` rows from scan-history.tsv so they get re-evaluated against
  // the new config. `added` and `error_fetch` rows are preserved.
  const currentFilterHash = hashFilterConfig(prefilterConfig);
  let filterChanged = false;
  let purgedCount = 0;
  if (filterStatePath && !onlySlug) {
    const previous = loadFilterState(filterStatePath);
    if (previous && previous.filter_hash && previous.filter_hash !== currentFilterHash) {
      filterChanged = true;
      if (!dryRun) {
        const result = purgeSkippedFromHistory(historyPath);
        purgedCount = result.purged;
      }
    }
  }

  let companies = (portalsConfig.tracked_companies || [])
    .filter((c) => c.enabled !== false)
    .filter((c) => detectPlatform(c.careers_url) !== null);

  if (onlySlug) {
    companies = companies.filter((c) => {
      const d = detectPlatform(c.careers_url);
      return d && d.slug === onlySlug;
    });
  }

  const wantsAts = source === 'ats' || source === 'all';
  const wantsAggregator = source === 'aggregator' || source === 'all';

  const companyByName = new Map(companies.map((c) => [c.name, c]));
  const limit = pLimit(FETCH_CONCURRENCY);
  const atsResults = wantsAts
    ? await Promise.all(companies.map((c) => limit(() => fetchCompanyOffers(c))))
    : [];
  const aggregatorResults = wantsAggregator
    ? await fetchAggregatorOffers(portalsConfig.aggregators)
    : [];

  const eligibleTotal = companies.length + aggregatorResults.length;
  const fetchResults = [...atsResults, ...aggregatorResults];

  const seen = loadSeenUrls(historyPath, applicationsPath);

  const today = new Date().toISOString().slice(0, 10);
  const doc = dryRun ? { header: '', sections: [] } : readPipelineMd(pipelinePath);

  const added = [];
  const errors = [];
  const filtered = {
    skipped_dup: 0,
    skipped_title: 0,
    skipped_blacklist: 0,
    skipped_language: 0,
    skipped_location: 0,
    skipped_date: 0,
    skipped_other: 0,
  };
  let raw = 0;
  let historyWrites = 0;
  let filteredWrites = 0;
  const perCompany = [];
  let progressIndex = 0;

  for (const result of fetchResults) {
    if (result.error) {
      errors.push({ company: result.company, error: result.error });
      // Only log to scan-history if this error sentinel isn't already tracked
      // (prevents unbounded growth for persistently-failing companies).
      const errorUrl = `error://${result.company}`;
      if (!dryRun && !seen.has(errorUrl)) {
        seen.add(errorUrl);
        appendHistoryRow(historyPath, {
          url: errorUrl,
          first_seen: today,
          portal: result.platform || 'unknown',
          title: result.error.slice(0, 200),
          company: result.company,
          status: 'error_fetch',
        });
        historyWrites++;
      }
      perCompany.push({
        company: result.company,
        platform: result.platform,
        rawCount: 0,
        afterFilterCount: 0,
        newCount: 0,
        error: result.error,
        warning: null,
      });
      progressIndex++;
      if (onProgress) {
        onProgress({
          index: progressIndex,
          total: fetchResults.length,
          company: result.company,
          platform: result.platform,
          rawCount: 0,
          afterFilterCount: 0,
          newCount: 0,
          error: result.error,
        });
      }
      continue;
    }

    raw += result.offers.length;

    const companyConfig = companyByName.get(result.company);
    const effectiveConfig = {
      ...prefilterConfig,
      ...(companyConfig?.skip_required_any && {
        whitelist: { ...whitelist, required_any: [] },
      }),
      ...(Array.isArray(companyConfig?.target_locations) && {
        targetLocations: companyConfig.target_locations,
      }),
    };

    let companyAfterFilter = 0;
    let companyNew = 0;
    for (const offer of result.offers) {
      let check;
      try {
        check = await runPrefilter(offer, effectiveConfig);
      } catch (err) {
        filtered.skipped_other = (filtered.skipped_other || 0) + 1;
        errors.push({ company: offer.company, error: `prefilter: ${err.message}` });
        if (!dryRun && !seen.has(offer.url)) {
          seen.add(offer.url);
          appendHistoryRow(historyPath, {
            url: offer.url,
            first_seen: today,
            portal: result.platform,
            title: offer.title,
            company: offer.company,
            status: 'skipped_other',
          });
          historyWrites++;
        }
        continue;
      }

      if (!check.pass) {
        const status = reasonToStatus(check.reason);
        filtered[status] = (filtered[status] || 0) + 1;
        if (!dryRun && !seen.has(offer.url)) {
          seen.add(offer.url);
          appendHistoryRow(historyPath, {
            url: offer.url,
            first_seen: today,
            portal: result.platform,
            title: offer.title,
            company: offer.company,
            status,
          });
          historyWrites++;
          appendFilteredOut(filteredPath, {
            date: today,
            url: offer.url,
            company: offer.company,
            title: offer.title,
            reason: check.reason,
          });
          filteredWrites++;
        }
        continue;
      }

      // Offer passed prefilter — count it before dedup check
      companyAfterFilter++;

      if (seen.has(offer.url)) {
        filtered.skipped_dup++;
        continue;
      }
      seen.add(offer.url);

      added.push(offer);
      companyNew++;
      appendOffer(doc, offer);
      if (!dryRun) {
        appendHistoryRow(historyPath, {
          url: offer.url,
          first_seen: today,
          portal: result.platform,
          title: offer.title,
          company: offer.company,
          status: 'added',
        });
        historyWrites++;
      }
    }

    const fetchWarn = result.fetchWarnings?.length > 0 ? result.fetchWarnings[0] : null;
    const warning =
      fetchWarn ??
      (result.offers.length === 0 ? 'board live but empty — possibly wrong slug' : null);
    perCompany.push({
      company: result.company,
      platform: result.platform,
      rawCount: result.offers.length,
      afterFilterCount: companyAfterFilter,
      newCount: companyNew,
      error: null,
      warning,
    });

    progressIndex++;
    if (onProgress) {
      onProgress({
        index: progressIndex,
        total: fetchResults.length,
        company: result.company,
        platform: result.platform,
        rawCount: result.offers.length,
        afterFilterCount: companyAfterFilter,
        newCount: companyNew,
        error: null,
        warning,
      });
    }
  }

  if (!dryRun && added.length > 0) {
    writePipelineMd(pipelinePath, doc);
  }

  // Persist the current filter hash so the NEXT scan can detect further
  // config changes and purge accordingly. We only write after a successful
  // scan — otherwise a crash mid-scan would silently mark the config as
  // "fully processed".
  if (!dryRun && filterStatePath && !onlySlug) {
    saveFilterState(filterStatePath, { filter_hash: currentFilterHash });
  }

  return {
    scanned: companies.length,
    eligibleTotal,
    raw,
    perCompany,
    filtered,
    added,
    errors,
    historyWrites,
    filteredWrites,
    filterChanged,
    purgedCount,
    filterHash: currentFilterHash,
  };
}

export function formatSummary(result, dryRun) {
  const lines = [];
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  lines.push(`Portal Scan — ${now}`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  if (result.filterChanged) {
    const suffix = dryRun
      ? '(would be purged — dry-run)'
      : `(${result.purgedCount} skipped_* rows purged)`;
    lines.push(`🔄 Filter config changed since last scan ${suffix}`);
  }
  lines.push(`Entreprises scannées : ${result.scanned}/${result.eligibleTotal ?? result.scanned}`);
  lines.push(`Offres brutes         : ${result.raw}`);
  for (const c of result.perCompany) {
    const mark = c.error ? '✗' : c.warning ? '⚠' : '✓';
    const note = c.error
      ? `(${c.error})`
      : c.warning
        ? `(${c.platform} — ${c.warning})`
        : `(${c.platform})`;
    const counts =
      c.error || c.rawCount === c.afterFilterCount
        ? `${c.rawCount} raw, ${c.newCount} new`
        : `${c.rawCount} raw → ${c.afterFilterCount} after filter → ${c.newCount} new`;
    lines.push(`  ${mark} ${c.company.padEnd(18)} ${counts} ${note}`);
  }
  lines.push('');
  lines.push('Filtrage :');
  lines.push(`  • Déjà vues       ${result.filtered.skipped_dup}`);
  lines.push(`  • Titre rejeté    ${result.filtered.skipped_title}`);
  lines.push(`  • Blacklist       ${result.filtered.skipped_blacklist}`);
  lines.push(`  • Langue          ${result.filtered.skipped_language ?? 0}`);
  lines.push(`  • Localisation    ${result.filtered.skipped_location}`);
  lines.push(`  • Date            ${result.filtered.skipped_date}`);
  lines.push('');
  lines.push(`Nouvelles ajoutées : ${result.added.length}`);
  for (const o of result.added) {
    lines.push(`  + ${o.company.padEnd(18)} | ${o.title}`);
  }
  lines.push('');
  if (dryRun) {
    lines.push('(dry-run — aucun fichier modifié)');
  } else {
    lines.push('Fichiers mis à jour :');
    lines.push(`  pipeline.md           (+${result.added.length} lignes)`);
    lines.push(`  scan-history.tsv      (+${result.historyWrites ?? 0} lignes)`);
    lines.push(`  filtered-out.tsv      (+${result.filteredWrites ?? 0} lignes)`);
  }
  if (result.errors.length > 0) {
    lines.push('');
    lines.push('Erreurs :');
    for (const e of result.errors) {
      lines.push(`  ! ${e.company}: ${e.error}`);
    }
  }
  lines.push('');
  lines.push('Next steps :');
  lines.push('  /score <url>        # évalue une offre via LLM (data/evaluations.jsonl)');
  lines.push('  /explain "<title>"  # trace pourquoi une offre passe/échoue le filtre');
  lines.push('  /dashboard          # régénère dashboard.html');
  lines.push('');
  lines.push('Plus de flags : /scan --help  (--dry-run, --only <slug>, --json)');
  return lines.join('\n');
}

function printScanHelp() {
  console.log(`Usage: /scan [--dry-run] [--only <slug>] [--json] [--source ats|aggregator|all]

Scan enabled ATS portals and append new offers to data/pipeline.md.

Flags:
  --dry-run                Compute everything, write nothing.
  --only <slug>            Scan a single company by ATS slug (e.g. mistral).
  --json                   Emit machine-readable output to stdout.
  --source <ats|aggregator|all>
                           Where to look for offers. Default "ats" scans
                           tracked_companies as before. "aggregator" queries
                           the public Greenhouse aggregator (no per-company
                           portals.yml entry needed). "all" runs both.
  --help, -h               Show this help and exit.

Files:
  reads:  config/portals.yml, config/candidate-profile.yml
  writes: data/pipeline.md, data/scan-history.tsv, data/filtered-out.tsv

See also: /explain, /dashboard
          docs/scan-workflow.md  (title_filter format, per-company overrides)`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printScanHelp();
    process.exit(0);
  }
  const dryRun = args.includes('--dry-run');
  const asJson = args.includes('--json');
  const onlyIdx = args.indexOf('--only');
  let onlySlug = null;
  if (onlyIdx >= 0) {
    const next = args[onlyIdx + 1];
    if (!next || next.startsWith('--')) {
      console.error('Error: --only requires a slug argument (e.g. --only mistral)');
      process.exit(2);
    }
    onlySlug = next;
  }
  const sourceIdx = args.indexOf('--source');
  let source = 'ats';
  if (sourceIdx >= 0) {
    const next = args[sourceIdx + 1];
    if (!next || !VALID_SOURCES.has(next)) {
      console.error('Error: --source requires one of ats|aggregator|all');
      process.exit(2);
    }
    source = next;
  }

  const CONFIG_DIR =
    process.env.CLAUDE_APPLY_CONFIG_DIR || path.join(__dirname, '..', '..', 'config');
  const DATA_DIR = process.env.CLAUDE_APPLY_DATA_DIR || path.join(__dirname, '..', '..', 'data');

  const portalsPath = path.join(CONFIG_DIR, 'portals.yml');
  requireConfig(portalsPath);

  const yaml = await import('js-yaml');
  const portalsConfig = yaml.load(fs.readFileSync(portalsPath, 'utf8'));
  const { profile } = await loadProfile(CONFIG_DIR);

  const result = await runScan({
    portalsConfig,
    profile,
    pipelinePath: path.join(DATA_DIR, 'pipeline.md'),
    historyPath: path.join(DATA_DIR, 'scan-history.tsv'),
    filteredPath: path.join(DATA_DIR, 'filtered-out.tsv'),
    applicationsPath: path.join(DATA_DIR, 'applications.md'),
    filterStatePath: path.join(DATA_DIR, 'scan-filter-state.json'),
    dryRun,
    onlySlug,
    source,
    onProgress: ({ index, total, company, rawCount, afterFilterCount, newCount, error }) => {
      if (error) {
        process.stderr.write(`[${index}/${total}] \u2717 ${company} \u2014 ${error}\n`);
      } else {
        const alreadySeen = afterFilterCount - newCount;
        const line =
          afterFilterCount === rawCount
            ? `${rawCount} raw, ${newCount} new`
            : `${rawCount} raw \u2192 ${afterFilterCount} after filter \u2192 ${newCount} new (${alreadySeen} already seen)`;
        process.stderr.write(`[${index}/${total}] \u2713 ${company} \u2014 ${line}\n`);
      }
    },
  });

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatSummary(result, dryRun));
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    if (err instanceof MissingConfigError) {
      console.error(err.message);
      process.exit(2);
    }
    console.error(err);
    process.exit(1);
  });
}
