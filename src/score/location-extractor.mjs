export function extractLocation(signals) {
  const { ldJsonRaw, ogLocation } = signals;

  const fromJsonLd = tryJsonLd(ldJsonRaw);
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
      const cleaned = m[1].trim().replace(/[.,;:]+$/, '').trim();
      if (cleaned.length > 0) return cleaned;
    }
  }
  return null;
}

function tryJsonLd(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const blocks = raw.split('\n---\n');
  for (const block of blocks) {
    const obj = safeParse(block);
    if (!obj) continue;
    const loc = pickLocalityFromJobPosting(obj);
    if (loc) return loc;
  }
  return null;
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function pickLocalityFromJobPosting(obj) {
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

function trimOrNull(s) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  return t.length > 0 ? t : null;
}
