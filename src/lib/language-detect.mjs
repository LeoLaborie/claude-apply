export const MIN_LANGUAGE_LEVEL = 'B2';

const LEVEL_RANK = {
  a1: 1,
  a2: 2,
  b1: 3,
  b2: 4,
  c1: 5,
  c2: 6,
  native: 7,
};

export function levelRank(level) {
  if (typeof level !== 'string' || level.length === 0) return 0;
  return LEVEL_RANK[level.toLowerCase()] ?? 0;
}

// Patterns per ISO-639-1 code. English and French excluded — treated as baseline.
const LANG_PATTERNS = {
  es: /\b(spanish|espagnol|español|castellano|hispanohablante)(?:[-\s]*(?:speaker|speaking|native|fluent|required))?\b/i,
  de: /\b(german|allemand|deutsch|deutschsprachig)(?:[-\s]*(?:speaker|speaking|native|fluent|required))?\b/i,
  it: /\b(italian|italien|italiano|italophone)(?:[-\s]*(?:speaker|speaking|native|fluent|required))?\b/i,
  nl: /\b(dutch|flemish|néerlandais|neerlandais|nederlands|nederlandstalig)(?:[-\s]*(?:speaker|speaking|native|fluent|required))?\b/i,
  pt: /\b(portuguese|portugais|português|portugues)(?:[-\s]*(?:speaker|speaking|native|fluent|required))?\b/i,
  ja: /\b(japanese|japonais)(?:[-\s]*(?:speaker|speaking|native|fluent|required))?\b/i,
  zh: /\b(chinese|mandarin|chinois)(?:[-\s]*(?:speaker|speaking|native|fluent|required))?\b/i,
  ar: /\b(arabic|arabe)(?:[-\s]*(?:speaker|speaking|native|fluent|required))?\b/i,
};

export function detectRequiredLanguages(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const hits = [];
  for (const [code, re] of Object.entries(LANG_PATTERNS)) {
    if (re.test(text)) hits.push(code);
  }
  return hits;
}
