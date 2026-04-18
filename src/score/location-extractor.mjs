export function extractLocation(signals) {
  const { ldJsonBlocks, ogLocation } = signals;

  const fromJsonLd = tryJsonLd(ldJsonBlocks);
  if (fromJsonLd) return { location: fromJsonLd, source: 'jsonld' };

  const fromMeta = trimOrNull(ogLocation);
  if (fromMeta) return { location: fromMeta, source: 'meta' };

  const fromDom = trimOrNull(signals.cssLocation);
  if (fromDom) return { location: fromDom, source: 'dom' };

  const fromRegex = tryRegex(signals.bodyText);
  if (fromRegex) return { location: fromRegex, source: 'regex' };

  return { location: null, source: null };
}

const LABEL_RE = /(?:Location|Lieu|Ville|Standort|Ubicación)\s*[:：]\s*([^\n]{2,80})/i;
const EMOJI_RE = /📍\s*([^\n]{2,80})/;

function tryRegex(bodyText) {
  if (!bodyText || typeof bodyText !== 'string') return null;
  for (const re of [LABEL_RE, EMOJI_RE]) {
    const m = bodyText.match(re);
    if (m) {
      const cleaned = m[1]
        .trim()
        .replace(/[.,;:]+$/, '')
        .trim();
      if (cleaned.length > 0) return cleaned;
    }
  }
  return null;
}

function tryJsonLd(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  for (const block of blocks) {
    const parsed = safeParse(block);
    if (!parsed) continue;
    for (const node of expandJsonLd(parsed)) {
      const loc = pickLocalityFromJobPosting(node);
      if (loc) return loc;
    }
  }
  return null;
}

function expandJsonLd(parsed) {
  const roots = Array.isArray(parsed) ? parsed : [parsed];
  const nodes = [];
  for (const root of roots) {
    if (!root || typeof root !== 'object') continue;
    if (Array.isArray(root['@graph'])) {
      for (const child of root['@graph']) nodes.push(child);
    } else {
      nodes.push(root);
    }
  }
  return nodes;
}

function safeParse(s) {
  if (typeof s !== 'string' || s.trim().length === 0) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function pickLocalityFromJobPosting(obj) {
  if (!isJobPosting(obj)) return null;
  const jobLoc = obj?.jobLocation;
  const locs = Array.isArray(jobLoc) ? jobLoc : [jobLoc];
  for (const jl of locs) {
    const addr = jl?.address;
    if (!addr) continue;
    const v = trimOrNull(addr.addressLocality) || trimOrNull(addr.addressRegion);
    if (v) return v;
  }
  return null;
}

function isJobPosting(obj) {
  const t = obj?.['@type'];
  if (typeof t === 'string') return t === 'JobPosting';
  if (Array.isArray(t)) return t.includes('JobPosting');
  return false;
}

function trimOrNull(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}
