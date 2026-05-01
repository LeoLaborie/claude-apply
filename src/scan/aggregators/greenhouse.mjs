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
import knownBoards from './known-greenhouse-boards.json' with { type: 'json' };

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

  const offers = [];
  const warnings = [];

  for (const board of boards) {
    if (!board || typeof board.slug !== 'string') continue;
    const company = board.company || board.slug;
    try {
      const raw = await fetchGreenhouse(board.slug, company);
      for (const o of raw) {
        const tagged = { ...o, source: 'aggregator:greenhouse' };
        if (titleRe && !titleRe.test(tagged.title || '')) continue;
        if (locationRe && !locationRe.test(tagged.location || '')) continue;
        offers.push(tagged);
        if (offers.length >= limit) {
          return { offers, warnings };
        }
      }
    } catch (err) {
      warnings.push({ slug: board.slug, company, error: err.message });
    }
  }

  return { offers, warnings };
}

export { knownBoards };
