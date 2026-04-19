const WORD_SPLIT_RE = /[^\p{L}\p{N}]+/u;

export function ngrams(tokens, maxN) {
  const out = [];
  for (let n = 1; n <= maxN; n++) {
    if (tokens.length < n) break;
    for (let i = 0; i + n <= tokens.length; i++) {
      out.push(tokens.slice(i, i + n).join(' '));
    }
  }
  return out;
}

export function suggestNgrams(titles, { maxN, minCount, stopWords, existingTerms }) {
  const existing = new Set((existingTerms || []).map((t) => String(t).toLowerCase()));
  const counts = new Map();
  const total = titles.length || 1;

  for (const title of titles) {
    const tokens = tokenize(title);
    const seen = new Set();
    for (const gram of ngrams(tokens, maxN)) {
      if (seen.has(gram)) continue;
      seen.add(gram);
      const parts = gram.split(' ');
      if (parts.every((p) => stopWords.has(p))) continue;
      if (existing.has(gram)) continue;
      counts.set(gram, (counts.get(gram) || 0) + 1);
    }
  }

  const ranked = [];
  for (const [ngram, count] of counts) {
    if (count < minCount) continue;
    ranked.push({ ngram, count, lift: count / total });
  }
  ranked.sort((a, b) => b.count - a.count || a.ngram.localeCompare(b.ngram));
  return ranked;
}

export function tokenize(title) {
  if (!title) return [];
  return String(title).toLowerCase().split(WORD_SPLIT_RE).filter(Boolean);
}
