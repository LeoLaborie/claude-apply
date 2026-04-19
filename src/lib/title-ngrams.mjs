const WORD_SPLIT_RE = /[^\p{L}\p{N}]+/u;

export function tokenize(title) {
  if (!title) return [];
  return String(title)
    .toLowerCase()
    .split(WORD_SPLIT_RE)
    .filter(Boolean);
}
