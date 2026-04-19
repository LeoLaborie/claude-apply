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

export function tokenize(title) {
  if (!title) return [];
  return String(title)
    .toLowerCase()
    .split(WORD_SPLIT_RE)
    .filter(Boolean);
}
