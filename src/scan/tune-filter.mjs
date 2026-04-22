import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { checkTitle, checkBlacklist } from '../lib/prefilter-rules.mjs';

const SAMPLE_PER_REASON = 10;
const TOP_COMPANIES = 20;

function buildSkipRequiredAny(companies) {
  const set = new Set();
  for (const c of companies || []) {
    if (c && c.skip_required_any && typeof c.name === 'string') {
      set.add(c.name.toLowerCase());
    }
  }
  return set;
}

export function simulate(filter, rows, { companies } = {}) {
  const baseWhitelist = {
    positive: filter.positive || [],
    negative: filter.negative || [],
    required_any: filter.required_any || [],
  };
  const skipWhitelist = { ...baseWhitelist, required_any: [] };
  const skipSet = buildSkipRequiredAny(companies);
  const blacklist = filter.blacklist || [];

  const rejectedByReason = new Map();
  const sampleRejected = new Map();
  const companyAgg = new Map();

  let accepted = 0;
  for (const row of rows) {
    const co = row.company || '(unknown)';
    const portal = row.portal || '(unknown)';
    const offer = { title: row.title || '', company: row.company || '' };
    const whitelist = skipSet.has(co.toLowerCase()) ? skipWhitelist : baseWhitelist;
    let reason = null;

    const t = checkTitle(offer, whitelist);
    if (!t.pass) {
      reason = t.reason;
    } else {
      const b = checkBlacklist(offer, blacklist);
      if (!b.pass) reason = b.reason;
    }

    const agg = companyAgg.get(co) || { company: co, accepted: 0, rejected: 0 };
    if (reason === null) {
      accepted += 1;
      agg.accepted += 1;
    } else {
      agg.rejected += 1;
      rejectedByReason.set(reason, (rejectedByReason.get(reason) || 0) + 1);
      const list = sampleRejected.get(reason) || [];
      if (list.length < SAMPLE_PER_REASON) {
        list.push({ title: row.title || '', company: co, portal });
        sampleRejected.set(reason, list);
      }
    }
    companyAgg.set(co, agg);
  }

  const total = rows.length;
  const byCompany = [...companyAgg.values()]
    .sort((a, b) => b.accepted - a.accepted || b.rejected - a.rejected)
    .slice(0, TOP_COMPANIES);

  return {
    total,
    accepted,
    ratio: total === 0 ? 0 : accepted / total,
    rejectedByReason,
    sampleRejected,
    byCompany,
  };
}

function parseHistory(text) {
  const lines = text.split('\n').filter(Boolean);
  if (lines.length === 0) return [];
  const header = lines[0].split('\t');
  const idx = {
    url: header.indexOf('url'),
    first_seen: header.indexOf('first_seen'),
    portal: header.indexOf('portal'),
    title: header.indexOf('title'),
    company: header.indexOf('company'),
    status: header.indexOf('status'),
  };
  return lines.slice(1).map((line) => {
    const cols = line.split('\t');
    return {
      url: cols[idx.url] || '',
      first_seen: cols[idx.first_seen] || '',
      portal: cols[idx.portal] || '',
      title: cols[idx.title] || '',
      company: cols[idx.company] || '',
      status: cols[idx.status] || '',
    };
  });
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function argVal(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

function statsToJson(stats) {
  return {
    total: stats.total,
    accepted: stats.accepted,
    ratio: stats.ratio,
    rejectedByReason: [...stats.rejectedByReason.entries()].map(([reason, count]) => ({
      reason,
      count,
    })),
    sampleRejected: [...stats.sampleRejected.entries()].map(([reason, samples]) => ({
      reason,
      samples,
    })),
    byCompany: stats.byCompany,
  };
}

async function main() {
  const historyPath = argVal(process.argv, '--history');
  if (!historyPath) {
    console.error('usage: tune-filter.mjs --history <path> < filter.json');
    process.exit(2);
  }
  if (!fs.existsSync(historyPath)) {
    console.error(`scan-history not found: ${historyPath}`);
    process.exit(2);
  }
  const rawFilter = await readStdin();
  let filter;
  try {
    filter = JSON.parse(rawFilter);
  } catch (err) {
    console.error(`invalid filter JSON on stdin: ${err.message}`);
    process.exit(2);
  }
  const rows = parseHistory(fs.readFileSync(historyPath, 'utf8'));
  const stats = simulate(filter, rows, { companies: filter.companies });
  process.stdout.write(JSON.stringify(statsToJson(stats), null, 2));
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
