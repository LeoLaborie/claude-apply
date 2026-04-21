import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { verifyCompany } from '../src/scan/ats-detect.mjs';

const WORKDAY_RE =
  /^https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)(?:\/|$)/i;

export function parseWorkdayUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const m = url.match(WORKDAY_RE);
  if (!m) return null;
  return { tenant: m[1].toLowerCase(), pod: m[2].toLowerCase(), slug: m[3] };
}

const TEMPLATE_PATH = 'templates/known-workday-slugs.example.json';
const UNRESOLVED_PATH = '/tmp/workday-unresolved.txt';

function normalizeKey(name) {
  return name.trim().toLowerCase().replace(/\s+/g, '');
}

async function readInput(inputFile) {
  const stream = inputFile ? fs.createReadStream(inputFile) : process.stdin;
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const rows = [];
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [name, url] = trimmed.split('\t').map((s) => (s ?? '').trim());
    if (!name || !url) continue;
    rows.push({ name, url });
  }
  return rows;
}

function loadExistingTemplate() {
  if (!fs.existsSync(TEMPLATE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeTemplate(registry) {
  const sorted = Object.keys(registry)
    .sort()
    .reduce((acc, k) => {
      acc[k] = registry[k];
      return acc;
    }, {});
  fs.mkdirSync(path.dirname(TEMPLATE_PATH), { recursive: true });
  fs.writeFileSync(TEMPLATE_PATH, JSON.stringify(sorted, null, 2) + '\n');
}

async function verifyWithRetry(url) {
  try {
    const res = await verifyCompany(url);
    if (res.ok) return res;
    if (res.reason && /5\d\d|network|timeout/i.test(res.reason)) {
      await new Promise((r) => setTimeout(r, 2000));
      return await verifyCompany(url);
    }
    return res;
  } catch (err) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      return await verifyCompany(url);
    } catch (err2) {
      return { ok: false, reason: err2.message };
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const mergeIdx = args.indexOf('--merge');
  const merge = mergeIdx !== -1;
  if (merge) args.splice(mergeIdx, 1);
  const inputIdx = args.indexOf('--input');
  const inputFile = inputIdx !== -1 ? args[inputIdx + 1] : null;

  const rows = await readInput(inputFile);
  if (rows.length === 0) {
    console.error('No input rows. Provide TSV via --input <file> or stdin.');
    process.exit(1);
  }

  const registry = merge ? loadExistingTemplate() : {};
  const unresolved = [];
  const seenKeys = new Set(Object.keys(registry));

  for (const { name, url } of rows) {
    const key = normalizeKey(name);
    if (seenKeys.has(key) && !merge) {
      unresolved.push({ name, url, reason: 'duplicate key (first wins)' });
      continue;
    }
    const parsed = parseWorkdayUrl(url);
    if (!parsed) {
      unresolved.push({ name, url, reason: 'url parse failed' });
      continue;
    }
    await new Promise((r) => setTimeout(r, 100));
    const result = await verifyWithRetry(url);
    if (result.ok && !result.warning) {
      registry[key] = parsed;
      seenKeys.add(key);
      process.stdout.write(`✓ ${name} (${result.count ?? '?'})\n`);
    } else {
      const reason = result.reason ?? result.warning ?? 'verify failed';
      unresolved.push({ name, url, reason });
      process.stdout.write(`✗ ${name} — ${reason}\n`);
    }
  }

  if (unresolved.length > 0) {
    fs.writeFileSync(
      UNRESOLVED_PATH,
      unresolved.map((u) => `${u.name}\t${u.url}\t${u.reason}`).join('\n') + '\n'
    );
  }

  if (Object.keys(registry).length === 0) {
    console.error(
      `\nNo entries verified; refusing to overwrite ${TEMPLATE_PATH}. ${unresolved.length} unresolved (see ${UNRESOLVED_PATH}).`
    );
    process.exit(1);
  }

  writeTemplate(registry);
  console.log(
    `\n${Object.keys(registry).length} entries in ${TEMPLATE_PATH}, ${unresolved.length} unresolved (see ${UNRESOLVED_PATH})`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
