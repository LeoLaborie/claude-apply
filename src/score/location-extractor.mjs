export function extractLocation(signals) {
  const { ldJsonRaw } = signals;
  const fromJsonLd = tryJsonLd(ldJsonRaw);
  if (fromJsonLd) return { location: fromJsonLd, source: 'jsonld' };
  return { location: null, source: null };
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
