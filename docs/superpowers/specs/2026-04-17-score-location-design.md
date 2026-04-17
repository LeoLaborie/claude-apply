# Design spec — issue #66: extract location into `evaluations.jsonl`

Date: 2026-04-17  
Branch: fix/issue-66-score-location  
Author: Claude (brainstorming session)

## Problem

The `location` field in `data/evaluations.jsonl` is always `""` for most offers.

Root cause: `fetchOfferBody()` in `src/score/index.mjs` only attempts one extraction strategy — a narrow CSS selector:
```js
document.querySelector('[class*="location" i], [data-testid*="location" i]')
```
This misses real-world pages that expose location via structured data, meta tags, or plain text.

Additionally, when the source is `pipeline` or `flags` and the caller-provided location is empty, the scraped value is never used as a fallback.

## Goals

- Populate `location` reliably from any signal the page provides.
- Distinguish "not found" (`null`) from legacy empty-string entries (`""`).
- Keep the logic pure and testable without Playwright.

## Approach selected: Module pur `location-extractor.mjs`

### New module: `src/score/location-extractor.mjs`

Single exported function mirroring `src/lib/page-liveness.mjs`:

```js
export function extractLocation(signals) {
  // signals = { ldJsonRaw, ogLocation, cssLocation, bodyText }
  // returns { location: string | null, source: 'jsonld'|'meta'|'dom'|'regex'|null }
}
```

### Extraction cascade (first non-empty wins)

1. **ld+json** — parse each `<script type="application/ld+json">` block (passed as `ldJsonRaw`, a `"\n---\n"`-joined string).
   - `jobLocation.address.addressLocality` (handles array + single-object schema.org shapes)
   - fallback: `jobLocation.address.addressRegion`
   - malformed blocks: silently skipped with `try/catch`

2. **meta / og** — `ogLocation` (value of `og:location` or `name="location"` meta tag)

3. **css** — `cssLocation` (existing selector, now named consistently)

4. **regex on body text** — patterns against `bodyText`:
   - `/(?:Location|Lieu|Ville|Standort|Ubicación)\s*[:：]\s*([^\n]{2,80})/i`
   - `/📍\s*([^\n]{2,80})/`
   - First match, trimmed, trailing punctuation stripped.

Returns `{ location: null, source: null }` when all strategies produce nothing.

### Changes to `src/score/index.mjs`

**`fetchOfferBody()`** — expand `page.evaluate()` to return two new fields:
- `ldJsonRaw`: `[...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.innerHTML).join('\n---\n')`
- `ogLocation`: `document.querySelector('meta[property="og:location"], meta[name="location"]')?.content || ''`

**`buildOffer()`** — after `fetchOfferBody()`:
- Call `extractLocation({ ldJsonRaw, ogLocation, cssLocation, bodyText: body })`
- `scrape` path: `location = extracted.location`
- `pipeline`/`flags` paths: `location = (override.location?.trim()) || extracted.location`

**Record assembly** (`main()`, both single and `--batch` paths):
- `offer.location || ''` → `offer.location ?? null`

### Tests

**New:** `tests/score/location-extractor.test.mjs`

Test cases:
- ld+json `addressLocality: "Paris"` → `{location:'Paris', source:'jsonld'}`
- ld+json array `jobLocation` → picks first entry
- ld+json with only `addressRegion` → returns region
- Malformed ld+json + valid `ogLocation` → falls through to meta
- Only `cssLocation` → `{location:..., source:'dom'}`
- Body `"Location: Paris"` → `{location:'Paris', source:'regex'}`
- Body `"Lieu : Lyon"` → correct
- Body `"📍 Berlin"` → correct
- No signals → `{location:null, source:null}`
- `cssLocation` whitespace-only → treated as empty

**Existing tests to audit:**
- `tests/score/metadata-source.test.mjs` — check for `location === ''` assertions
- `tests/score/score-batch.test.mjs` — same

## Out of scope

- Changing location extraction in the `scan` pipeline (different context, ATS API fields)
- Parsing country/city from free-text body beyond the regex patterns above
- Backfilling existing `evaluations.jsonl` entries

## Verification

```bash
# Unit tests
node --test tests/score/location-extractor.test.mjs
npm test

# Manual smoke test
node src/score/index.mjs <lever-or-greenhouse-url>
# expect: "location": "Paris" (or real city) in evaluations.jsonl

# Null behaviour: minimalist SPA
# expect: "location": null in evaluations.jsonl
```
