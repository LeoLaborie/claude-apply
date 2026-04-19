import fs from 'node:fs';
import { verifyCompany } from '../src/scan/ats-detect.mjs';

export function buildWorkdayUrl({ tenant, pod, slug } = {}) {
  if (!tenant) throw new Error('buildWorkdayUrl: missing tenant');
  if (!pod) throw new Error('buildWorkdayUrl: missing pod');
  if (!slug) throw new Error('buildWorkdayUrl: missing slug');
  return `https://${tenant}.${pod}.myworkdayjobs.com/${slug}`;
}

const TEMPLATE_PATH = 'templates/known-workday-slugs.example.json';

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
  const fix = args.includes('--fix');

  if (!fs.existsSync(TEMPLATE_PATH)) {
    console.error(`Template file not found: ${TEMPLATE_PATH}`);
    process.exit(1);
  }
  const registry = JSON.parse(fs.readFileSync(TEMPLATE_PATH, 'utf8'));

  const live = {};
  const dead = [];

  for (const [key, entry] of Object.entries(registry)) {
    const url = buildWorkdayUrl(entry);
    await new Promise((r) => setTimeout(r, 100));
    const result = await verifyWithRetry(url);
    if (result.ok) {
      live[key] = entry;
      process.stdout.write(`✓ ${key} (${result.count ?? '?'})\n`);
    } else {
      dead.push({ key, url, reason: result.reason ?? 'verify failed' });
      process.stdout.write(`✗ ${key} — ${result.reason ?? 'verify failed'}\n`);
    }
  }

  console.log(`\n${Object.keys(live).length} live, ${dead.length} dead`);

  if (dead.length > 0) {
    console.log('\nDead entries:');
    for (const d of dead) console.log(`  ${d.key}\t${d.url}\t${d.reason}`);
  }

  if (fix) {
    fs.writeFileSync(TEMPLATE_PATH, JSON.stringify(live, null, 2) + '\n');
    console.log(`\nTemplate rewritten with ${Object.keys(live).length} live entries.`);
    process.exit(0);
  }

  process.exit(dead.length > 0 ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
