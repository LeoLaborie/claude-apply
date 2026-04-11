#!/usr/bin/env node
// Explain why a given job title is accepted or rejected by the current
// title_filter / blacklist / location / start-date rules.
//
// Usage:
//   node src/scan/explain.mjs "Some Job Title" [--company "Foo"]
//
// Reads config/portals.yml and (optionally) config/profile.yml from
// CLAUDE_APPLY_CONFIG_DIR or the repo's ./config dir. Inlines a tiny YAML
// loader so this file is independent of any shared profile-loading helper.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import {
  checkTitle,
  checkBlacklist,
  checkLocation,
  checkStartDate,
} from '../lib/prefilter-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadYamlOptional(filePath) {
  try {
    return yaml.load(fs.readFileSync(filePath, 'utf8')) || {};
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw err;
  }
}

function loadYamlRequired(filePath) {
  return yaml.load(fs.readFileSync(filePath, 'utf8')) || {};
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args[0].startsWith('--')) {
    return { error: 'usage: node src/scan/explain.mjs "<title>" [--company "<company>"]' };
  }
  const title = args[0];
  let company = '';
  const ci = args.indexOf('--company');
  if (ci >= 0) company = args[ci + 1] || '';
  return { title, company };
}

function runTrace(offer, config) {
  const trace = [];
  const steps = [
    { name: 'title', fn: () => checkTitle(offer, config.whitelist) },
    { name: 'blacklist', fn: () => checkBlacklist(offer, config.blacklist) },
    { name: 'location', fn: () => checkLocation(offer) },
    { name: 'start_date', fn: () => checkStartDate(offer, config.minStartDate) },
  ];
  for (const s of steps) {
    const r = s.fn();
    trace.push({ name: s.name, result: r });
    if (!r.pass) return { pass: false, reason: r.reason, trace };
  }
  return { pass: true, trace };
}

function formatTrace(offer, outcome, whitelist) {
  const lines = [];
  lines.push(`Title:   ${offer.title}`);
  lines.push(`Company: ${offer.company || '(none)'}`);
  lines.push('');
  for (const step of outcome.trace) {
    const mark = step.result.pass ? '✓' : '✗';
    if (step.name === 'title' && !step.result.pass) {
      lines.push(`${mark} title — ${step.result.reason}`);
      const pos = whitelist.positive || [];
      const neg = whitelist.negative || [];
      if (pos.length > 0) {
        lines.push(`    positive tried: ${pos.map((t) => `"${t}"`).join(', ')}`);
      }
      if (neg.length > 0) {
        lines.push(`    negative tried: ${neg.map((t) => `"${t}"`).join(', ')}`);
      }
    } else if (step.result.pass) {
      lines.push(`${mark} ${step.name}`);
    } else {
      lines.push(`${mark} ${step.name} — ${step.result.reason}`);
    }
  }
  lines.push('');
  if (outcome.pass) {
    lines.push('ACCEPTED');
  } else {
    lines.push(`REJECTED: ${outcome.reason}`);
  }
  return lines.join('\n');
}

function main() {
  const parsed = parseArgs(process.argv);
  if (parsed.error) {
    console.error(parsed.error);
    process.exit(2);
  }

  const CONFIG_DIR =
    process.env.CLAUDE_APPLY_CONFIG_DIR || path.join(__dirname, '..', '..', 'config');

  const portals = loadYamlRequired(path.join(CONFIG_DIR, 'portals.yml'));
  const profile = loadYamlOptional(path.join(CONFIG_DIR, 'profile.yml'));

  const whitelist = portals.title_filter || { positive: [], negative: [] };
  const config = {
    whitelist,
    blacklist: profile.evaluation?.blacklist_companies || [],
    minStartDate: profile.evaluation?.min_start_date || '2026-08-24',
  };

  const offer = { title: parsed.title, company: parsed.company, body: '' };
  const outcome = runTrace(offer, config);
  console.log(formatTrace(offer, outcome, whitelist));
  process.exit(outcome.pass ? 0 : 1);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
