import fs from 'node:fs';
import { parseDocument, isSeq } from 'yaml';
import { detectPlatform, getSupportedHosts } from './ats-detect.mjs';

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
    return { status: 'unsupported-platform', form: 'url', input: url, platform, slug, knownHost: platform };
  }

  const dup = duplicateStatus(doc, url);
  if (dup) {
    return { ...dup, form: 'url', input: url, platform, slug, careersUrl: url };
  }

  const verify = await deps.verifyCompany(url);
  if (!verify.ok) {
    return { status: 'not-found', form: 'url', input: url, platform, slug, reason: verify.reason ?? 'verify failed' };
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
    return { ...dup, form: 'name', input: name, platform: result.platform, slug: result.slug, careersUrl: result.careersUrl };
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
