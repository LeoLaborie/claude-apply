// Public Greenhouse aggregator.
//
// Unlike per-company ATS fetchers, this module discovers offers across MANY
// Greenhouse-hosted boards without requiring the user to declare each company
// in portals.yml. It piggybacks on the same public API
// (`boards-api.greenhouse.io`) already used by ats/greenhouse.mjs.
//
// Why Greenhouse and not Simplify? Simplify's ToS forbids automated scraping
// of simplify.jobs. Greenhouse's `boards-api` is an unauthenticated, publicly
// documented JSON API meant for board embedding — the same one we already use
// per company. Using a curated list of well-known public boards stays squarely
// within the API's intended use.

import { fetchGreenhouse } from '../ats/greenhouse.mjs';
import { pLimit } from '../../lib/p-limit.mjs';
import knownBoards from './known-greenhouse-boards.json' with { type: 'json' };

const FETCH_CONCURRENCY = 6;

function compileWordRegex(terms) {
  if (!Array.isArray(terms) || terms.length === 0) return null;
  const escaped = terms.map((t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'i');
}

function compileSubstringRegex(terms) {
  if (!Array.isArray(terms) || terms.length === 0) return null;
  const escaped = terms.map((t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?:${escaped.join('|')})`, 'i');
}

export async function fetchAggregator({
  keywords = [],
  locations = [],
  limit = Infinity,
  boards = knownBoards,
} = {}) {
  const titleRe = compileWordRegex(keywords);
  const locationRe = compileSubstringRegex(locations);

  const validBoards = boards.filter((b) => b && typeof b.slug === 'string');
  const concurrency = pLimit(FETCH_CONCURRENCY);

  const settled = await Promise.all(
    validBoards.map((board) =>
      concurrency(async () => {
        const company = board.company || board.slug;
        try {
          const raw = await fetchGreenhouse(board.slug, company);
          return { board, company, raw, error: null };
        } catch (err) {
          return { board, company, raw: null, error: err };
        }
      })
    )
  );

  const offers = [];
  const warnings = [];

  for (const r of settled) {
    if (r.error) {
      warnings.push({ slug: r.board.slug, company: r.company, error: r.error?.message });
      continue;
    }
    for (const o of r.raw) {
      const tagged = { ...o, source: 'aggregator:greenhouse' };
      if (titleRe && !titleRe.test(tagged.title || '')) continue;
      if (locationRe && !locationRe.test(tagged.location || '')) continue;
      offers.push(tagged);
      if (offers.length >= limit) {
        return { offers, warnings };
      }
    }
  }

  return { offers, warnings };
}

export { knownBoards };
