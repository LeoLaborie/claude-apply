import fs from 'node:fs';
import { parseDocument, isSeq } from 'yaml';
import {
  detectPlatform,
  getSupportedHosts,
  verifyCompany as defaultVerify,
} from './ats-detect.mjs';
import { discoverCompany as defaultDiscover } from './discover-company.mjs';

export class AddCompanyError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'AddCompanyError';
    this.code = code;
    this.details = details;
  }
}

export function appendCompany(portalsPath, entry) {
  const raw = fs.readFileSync(portalsPath, 'utf8');
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) {
    throw new AddCompanyError('SHAPE_INVALID', 'portals.yml parse failed', { errors: doc.errors });
  }

  const list = doc.get('tracked_companies', true);
  if (!isSeq(list)) {
    throw new AddCompanyError('SHAPE_INVALID', 'tracked_companies is not a sequence');
  }

  const node = doc.createNode({
    name: entry.name,
    careers_url: entry.careersUrl,
    enabled: true,
  });
  list.add(node);

  const out = String(doc);
  const reparsed = parseDocument(out);
  if (reparsed.errors.length > 0) {
    throw new AddCompanyError('POST_PARSE_FAILED', 'post-mutation reparse failed', {
      errors: reparsed.errors,
    });
  }

  fs.writeFileSync(portalsPath, out);
  return {
    entryIndex: list.items.length - 1,
    total: list.items.length,
    entry: {
      name: entry.name,
      careers_url: entry.careersUrl,
      enabled: true,
    },
  };
}

export function findByCareersUrl(doc, careersUrl) {
  const list = doc.get('tracked_companies', true);
  if (!isSeq(list)) return null;
  const idx = list.items.findIndex((item) => item.get?.('careers_url') === careersUrl);
  return idx >= 0 ? { index: idx, node: list.items[idx] } : null;
}

const VERIFIABLE_PLATFORMS = new Set(['lever', 'greenhouse', 'ashby', 'workday']);

function titleCaseSlug(slug) {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

function loadDoc(portalsPath) {
  if (!fs.existsSync(portalsPath)) return null;
  const raw = fs.readFileSync(portalsPath, 'utf8');
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) {
    throw new AddCompanyError('SHAPE_INVALID', 'portals.yml parse failed', { errors: doc.errors });
  }
  return doc;
}

function duplicateStatus(doc, careersUrl) {
  const match = findByCareersUrl(doc, careersUrl);
  if (!match) return null;
  const enabled = match.node.get('enabled') === true;
  return {
    status: enabled ? 'duplicate' : 'disabled-duplicate',
    duplicateOf: { name: match.node.get('name'), enabled },
  };
}

export async function resolveCompany({ input, portalsPath, deps }) {
  const trimmed = String(input ?? '').trim();
  const doc = loadDoc(portalsPath);
  if (!doc) return { status: 'no-portals', input: trimmed };

  if (/^https?:\/\//i.test(trimmed)) {
    return resolveByUrl(trimmed, doc, deps);
  }
  return resolveByName(trimmed, doc, deps);
}

async function resolveByUrl(url, doc, deps) {
  const detected = detectPlatform(url);
  if (!detected) {
    return { status: 'unknown-host', form: 'url', input: url, supportedHosts: getSupportedHosts() };
  }

  const { platform, slug } = detected;
  if (!VERIFIABLE_PLATFORMS.has(platform)) {
    return {
      status: 'unsupported-platform',
      form: 'url',
      input: url,
      platform,
      slug,
      knownHost: platform,
    };
  }

  const dup = duplicateStatus(doc, url);
  if (dup) {
    return { ...dup, form: 'url', input: url, platform, slug, careersUrl: url };
  }

  const verify = await deps.verifyCompany(url);
  if (!verify.ok) {
    return {
      status: 'not-found',
      form: 'url',
      input: url,
      platform,
      slug,
      reason: verify.reason ?? 'verify failed',
    };
  }

  const out = {
    status: 'ok',
    form: 'url',
    input: url,
    platform,
    slug,
    careersUrl: url,
    count: verify.count ?? 0,
    suggestedName: titleCaseSlug(slug),
  };
  if ((verify.count ?? 0) === 0) out.warning = 'empty board';
  return out;
}

async function resolveByName(name, doc, deps) {
  if (!name) {
    return { status: 'not-found', form: 'name', input: name, reason: 'empty input', tried: [] };
  }

  const result = await deps.discoverCompany(name);
  if (!result.ok) {
    return {
      status: 'not-found',
      form: 'name',
      input: name,
      reason: result.reason ?? 'no slug matched',
      tried: result.tried ?? [],
    };
  }

  const dup = duplicateStatus(doc, result.careersUrl);
  if (dup) {
    return {
      ...dup,
      form: 'name',
      input: name,
      platform: result.platform,
      slug: result.slug,
      careersUrl: result.careersUrl,
    };
  }

  return {
    status: 'ok',
    form: 'name',
    input: name,
    platform: result.platform,
    slug: result.slug,
    careersUrl: result.careersUrl,
    count: result.count ?? null,
    suggestedName: name,
  };
}

export function toggleEnabled(doc, careersUrl) {
  const match = findByCareersUrl(doc, careersUrl);
  if (!match) return null;
  const current = match.node.get('enabled');
  if (current === true) {
    return { status: 'already-enabled', name: match.node.get('name') };
  }
  match.node.set('enabled', true);
  return { status: 'toggled', name: match.node.get('name') };
}

function parseArgs(argv) {
  const args = {
    input: null,
    name: null,
    dryRun: false,
    yes: false,
    json: false,
    portals: 'config/portals.yml',
    cache: 'data/known-ats-slugs.json',
    workdayRegistry: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    switch (key) {
      case '--input':
        args.input = next;
        i += 1;
        break;
      case '--name':
        args.name = next;
        i += 1;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--yes':
        args.yes = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--portals':
        args.portals = next;
        i += 1;
        break;
      case '--cache':
        args.cache = next;
        i += 1;
        break;
      case '--workday-registry':
        args.workdayRegistry = next;
        i += 1;
        break;
      default:
        break;
    }
  }
  if (!args.dryRun && !args.yes) args.dryRun = true;
  return args;
}

function emit(args, payload) {
  process.stdout.write(JSON.stringify(payload) + '\n');
}

export async function main(argv, depsOverride = {}) {
  const args = parseArgs(argv);
  if (!args.input) {
    throw new AddCompanyError('MISSING_INPUT', '--input is required');
  }

  const deps = {
    verifyCompany: depsOverride.verifyCompany ?? defaultVerify,
    discoverCompany:
      depsOverride.discoverCompany ??
      ((name) =>
        defaultDiscover(name, {
          cachePath: args.cache,
          workdayRegistryPath: args.workdayRegistry,
        })),
  };

  const resolved = await resolveCompany({ input: args.input, portalsPath: args.portals, deps });

  if (args.yes && resolved.status === 'disabled-duplicate') {
    const raw = fs.readFileSync(args.portals, 'utf8');
    const doc = parseDocument(raw);
    const careersUrl =
      resolved.careersUrl ?? (/^https?:\/\//i.test(args.input) ? args.input : null);
    const toggle = toggleEnabled(doc, careersUrl);
    const outStr = String(doc);
    const reparsed = parseDocument(outStr);
    if (reparsed.errors.length > 0) {
      throw new AddCompanyError('POST_PARSE_FAILED', 'post-mutation reparse failed', {
        errors: reparsed.errors,
      });
    }
    fs.writeFileSync(args.portals, outStr);
    emit(args, { status: 'toggled', name: toggle.name });
    return;
  }

  if (!args.yes || resolved.status !== 'ok') {
    emit(args, resolved);
    return;
  }

  // --yes and status === 'ok' → append
  const finalName = args.name ?? resolved.suggestedName ?? resolved.input;
  const result = appendCompany(args.portals, { name: finalName, careersUrl: resolved.careersUrl });
  emit(args, {
    status: 'written',
    entryIndex: result.entryIndex,
    total: result.total,
    entry: result.entry,
  });
}

const invokedDirectly = (() => {
  try {
    return process.argv[1] && process.argv[1].endsWith('add-company.mjs');
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`${err.name}: ${err.message}\n`);
    if (err.details) process.stderr.write(JSON.stringify(err.details, null, 2) + '\n');
    process.exit(1);
  });
}
