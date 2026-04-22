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

// Nationality adjectives like "Spanish" or "German" are ambiguous — they often
// describe a market ("German Automotive Market Intern") instead of a language
// requirement. Only accept them when adjacent to a qualifier word, or when the
// marker is self-contained (Deutschsprachig, Hispanohablante, etc.).
const QUALIFIERS =
  'speaker|speaking|native|fluent|required|bilingual|trilingual|proficient|conversational';

function buildLangRegex(adjectives, selfMarkers = []) {
  const adj = adjectives.join('|');
  const alternatives = [];
  if (selfMarkers.length > 0) alternatives.push(selfMarkers.join('|'));
  alternatives.push(`(?:${adj})[-\\s]+(?:${QUALIFIERS})`);
  alternatives.push(`(?:${QUALIFIERS})[-\\s/]+(?:${adj})`);
  alternatives.push(`(?:bi|tri)lingual[-\\s]+\\w+[-\\s/]+(?:${adj})`);
  return new RegExp(`\\b(?:${alternatives.join('|')})\\b`, 'i');
}

// English and French excluded — treated as baseline for the target audience.
const LANG_PATTERNS = {
  es: buildLangRegex(['spanish', 'espagnol', 'español'], ['castellano', 'hispanohablante']),
  de: buildLangRegex(['german', 'allemand', 'deutsch'], ['deutschsprachig']),
  it: buildLangRegex(['italian', 'italien', 'italiano'], ['italophone']),
  nl: buildLangRegex(
    ['dutch', 'flemish', 'néerlandais', 'neerlandais', 'nederlands'],
    ['nederlandstalig']
  ),
  pt: buildLangRegex(['portuguese', 'portugais', 'português', 'portugues']),
  ja: buildLangRegex(['japanese', 'japonais']),
  zh: buildLangRegex(['chinese', 'mandarin', 'chinois']),
  ar: buildLangRegex(['arabic', 'arabe']),
};

export function detectRequiredLanguages(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const hits = [];
  for (const [code, re] of Object.entries(LANG_PATTERNS)) {
    if (re.test(text)) hits.push(code);
  }
  return hits;
}
