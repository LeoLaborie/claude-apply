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
