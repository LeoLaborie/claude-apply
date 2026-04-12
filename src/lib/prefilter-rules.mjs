// Pure functions for deterministic pre-filtering of job offers.
// Each function returns {pass: true} or {pass: false, reason: string}.

const LOCATION_FR_RE =
  /\b(france|paris|lyon|toulouse|marseille|bordeaux|lille|nantes|grenoble|sophia[- ]antipolis|rennes|compi[eè]gne|strasbourg|montpellier|nice|remote.*france|t[eé]l[eé]travail|full.remote.eu)\b/i;
const LOCATION_FOREIGN_RE =
  /\b(new york|nyc|london|berlin|munich|san francisco|sf bay|palo alto|tokyo|seoul|singapore|dubai|mena|morocco|sydney|australia|montreal|warsaw|poland|sweden|stockholm|netherlands|amsterdam|spain|madrid|barcelona|germany|luxembourg|italy|italian|milan|rome|austria|vienna|switzerland|zurich|geneva|denmark|copenhagen|norway|oslo|finland|helsinki|ireland|dublin|belgium|brussels|usa only|uk only|us citizens? only|green card|visa sponsorship not)\b/i;

const LOCATION_SEG_RE = /\s*[-/,]\s*/;
const REMOTE_RE = /^remote$/i;

function splitLocationSegments(loc) {
  return loc
    .split(LOCATION_SEG_RE)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function checkLocation(offer, targetLocations) {
  const loc = offer.location || '';

  // Structured location available — use positive matching
  if (loc) {
    const segments = splitLocationSegments(loc);
    const geoSegments = segments.filter((s) => !REMOTE_RE.test(s));

    if (geoSegments.length === 0) {
      // Pure "Remote" with no geographic qualifier — ambiguous, pass
      return { pass: true };
    }

    const match = geoSegments.some((seg) =>
      (targetLocations || []).some((t) => seg.toLowerCase().includes(t.toLowerCase()))
    );
    if (match) return { pass: true };
    return { pass: false, reason: `location: ${loc} not in target zones` };
  }

  // Fallback: no structured location — use regex heuristic on title + body
  const title = offer.title || '';
  const body = offer.body || '';
  const titleHasForeign = LOCATION_FOREIGN_RE.test(title);
  const titleHasFr = LOCATION_FR_RE.test(title);
  if (titleHasForeign && !titleHasFr) {
    return { pass: false, reason: 'location: foreign in title, no FR' };
  }
  const haystack = `${title} ${body}`;
  if (LOCATION_FR_RE.test(haystack)) return { pass: true };
  if (LOCATION_FOREIGN_RE.test(body)) return { pass: false, reason: 'location: foreign only' };
  return { pass: true };
}

const MONTHS = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  janvier: 1,
  février: 2,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  août: 8,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  décembre: 12,
  decembre: 12,
};

function parseDates(text) {
  const out = [];
  const re =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(\d{4})\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const month = MONTHS[m[1].toLowerCase()];
    const year = parseInt(m[2], 10);
    if (month && year) out.push(new Date(Date.UTC(year, month - 1, 1)));
  }
  return out;
}

export function checkStartDate(offer, minStartDateIso) {
  const text = offer.body || '';
  const dates = parseDates(text);
  if (dates.length === 0) return { pass: true };
  const min = new Date(minStartDateIso);
  // Keep offer if at least one plausible start date is ≥ min
  const anyValid = dates.some(
    (d) => d >= new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), 1))
  );
  if (anyValid) return { pass: true };
  return { pass: false, reason: `start_date: all parsed dates before ${minStartDateIso}` };
}

// Compile a title-filter term into a RegExp.
//
// Escape hatch: a term of the form "/pattern/flags" is parsed as a real regex.
// Case-insensitivity is enforced — if the user omits "i", we add it.
//
// Plain string: case-insensitive, word-boundary match with special chars
// escaped. "stage" → /\bstage\b/i, matches "Stage Data" but NOT "Backstage".
function compileMatcher(term) {
  const s = String(term);
  const m = s.match(/^\/(.+)\/([gimsuy]*)$/);
  try {
    if (m) {
      const flags = m[2].includes('i') ? m[2] : m[2] + 'i';
      return new RegExp(m[1], flags);
    }
    const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i');
  } catch (err) {
    const e = new Error(`invalid title_filter term "${s}": ${err.message}`);
    e.code = 'INVALID_TITLE_FILTER_TERM';
    e.term = s;
    throw e;
  }
}

function findMatch(terms, title) {
  for (const t of terms || []) {
    if (compileMatcher(t).test(title)) return t;
  }
  return null;
}

export function checkTitle(offer, whitelist) {
  const title = offer.title || '';
  try {
    const neg = findMatch(whitelist.negative, title);
    if (neg) return { pass: false, reason: `title: negative match "${neg}"` };
    const pos = findMatch(whitelist.positive, title);
    if (!pos) return { pass: false, reason: 'title: no positive match' };
    if (Array.isArray(whitelist.required_any) && whitelist.required_any.length > 0) {
      const req = findMatch(whitelist.required_any, title);
      if (!req) return { pass: false, reason: 'title: missing required_any keyword' };
    }
    return { pass: true };
  } catch (err) {
    if (err.code === 'INVALID_TITLE_FILTER_TERM') {
      return { pass: false, reason: `title: ${err.message}` };
    }
    throw err;
  }
}

export function checkBlacklist(offer, blacklist) {
  const company = (offer.company || '').toLowerCase();
  const hit = (blacklist || []).find((b) => company.includes(b.toLowerCase()));
  if (hit) return { pass: false, reason: `blacklist: ${hit}` };
  return { pass: true };
}

export function runPrefilter(offer, config) {
  const checks = [
    () => checkTitle(offer, config.whitelist),
    () => checkBlacklist(offer, config.blacklist),
    () => checkLocation(offer, config.targetLocations),
    () => checkStartDate(offer, config.minStartDate),
  ];
  for (const fn of checks) {
    const r = fn();
    if (!r.pass) return r;
  }
  return { pass: true };
}
