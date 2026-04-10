// Pure functions for deterministic pre-filtering of job offers.
// Each function returns {pass: true} or {pass: false, reason: string}.

const LOCATION_FR_RE = /\b(france|paris|lyon|toulouse|marseille|bordeaux|lille|nantes|grenoble|sophia[- ]antipolis|rennes|compi[eè]gne|strasbourg|montpellier|nice|remote.*france|t[eé]l[eé]travail|full.remote.eu)\b/i;
const LOCATION_FOREIGN_RE = /\b(new york|nyc|london|berlin|munich|san francisco|sf bay|palo alto|tokyo|seoul|singapore|dubai|mena|morocco|sydney|australia|montreal|warsaw|poland|sweden|stockholm|netherlands|amsterdam|spain|madrid|barcelona|germany|luxembourg|italy|italian|milan|rome|austria|vienna|switzerland|zurich|geneva|denmark|copenhagen|norway|oslo|finland|helsinki|ireland|dublin|belgium|brussels|usa only|uk only|us citizens? only|green card|visa sponsorship not)\b/i;

export function checkLocation(offer) {
  const title = offer.title || '';
  const body = offer.body || '';
  // 1. If the title explicitly mentions a foreign-only location and no FR
  //    location, reject immediately. This handles patterns like
  //    "Role - Morocco" or "Account Executive - Netherlands" where the body
  //    may incidentally mention France as a supported region.
  const titleHasForeign = LOCATION_FOREIGN_RE.test(title);
  const titleHasFr = LOCATION_FR_RE.test(title);
  if (titleHasForeign && !titleHasFr) {
    return { pass: false, reason: 'location: foreign in title, no FR' };
  }
  // 2. FR mention anywhere (title or body) → pass. Hybrid titles like
  //    "AI Scientist - Paris/London" fall into this branch.
  const haystack = `${title} ${body}`;
  if (LOCATION_FR_RE.test(haystack)) return { pass: true };
  // 3. No FR signal found — if body has a foreign-only mention, reject.
  if (LOCATION_FOREIGN_RE.test(body)) return { pass: false, reason: 'location: foreign only' };
  return { pass: true }; // ambiguous → pass
}

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12,
};

function parseDates(text) {
  const out = [];
  const re = /\b(january|february|march|april|may|june|july|august|september|october|november|december|janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre)\s+(\d{4})\b/gi;
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
  const anyValid = dates.some((d) => d >= new Date(Date.UTC(min.getUTCFullYear(), min.getUTCMonth(), 1)));
  if (anyValid) return { pass: true };
  return { pass: false, reason: `start_date: all parsed dates before ${minStartDateIso}` };
}

export function checkTitle(offer, whitelist) {
  const title = (offer.title || '').toLowerCase();
  const neg = (whitelist.negative || []).find((n) => title.includes(n.toLowerCase()));
  if (neg) return { pass: false, reason: `title: negative match "${neg}"` };
  const pos = (whitelist.positive || []).some((p) => title.includes(p.toLowerCase()));
  if (!pos) return { pass: false, reason: 'title: no positive match' };
  // Optional: if required_any is defined, the title must contain at least one
  // of these keywords as a WHOLE WORD (word-boundary match on both sides).
  // This prevents "Intern" from matching "International" / "Internal" while
  // still catching "Intern", "Interns", "Internship" (explicit variants).
  if (Array.isArray(whitelist.required_any) && whitelist.required_any.length > 0) {
    const req = whitelist.required_any.some((r) => {
      const escaped = String(r).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`\\b${escaped}\\b`).test(title);
    });
    if (!req) return { pass: false, reason: 'title: missing required_any keyword' };
  }
  return { pass: true };
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
    () => checkLocation(offer),
    () => checkStartDate(offer, config.minStartDate),
  ];
  for (const fn of checks) {
    const r = fn();
    if (!r.pass) return r;
  }
  return { pass: true };
}
