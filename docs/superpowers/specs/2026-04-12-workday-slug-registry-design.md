# Workday Slug Registry — Design Spec

**Issue:** #19 — `feat(scan): Registre de slugs Workday connus`
**Scope:** Court terme — fichier JSON statique versionné dans le repo
**Date:** 2026-04-12

## Problem

Workday URLs require 3 components: `{tenant}.{pod}.myworkdayjobs.com/{site}`. Unlike Lever/Greenhouse/Ashby where the slug is predictable, Workday "site" values are often non-standard (e.g. `TotalEnergies_careers`, not `totalenergies`). Out of ~15 CAC40 companies identified as valid Workday tenants, only 5 slugs could be found. Each failed guess costs ~2s and conversation tokens.

## Solution

Ship a static JSON registry at `src/scan/ats/workday-registry.json` containing known tenant→slug mappings. The registry is consulted before any network call, enabling:
- Onboarding to propose Workday companies without verification I/O
- Future slug discovery to be persisted via PRs

## Registry Format

File: `src/scan/ats/workday-registry.json`

```json
[
  { "tenant": "sanofi", "pod": "wd3", "site": "SanofiCareers", "company": "Sanofi" },
  { "tenant": "airbus", "pod": "wd3", "site": "Airbus", "company": "Airbus" },
  { "tenant": "renault", "pod": "wd3", "site": "Renault", "company": "Renault" },
  { "tenant": "michelin", "pod": "wd3", "site": "Michelin", "company": "Michelin" },
  { "tenant": "criteo", "pod": "wd3", "site": "Criteo", "company": "Criteo" },
  { "tenant": "totalenergies", "pod": "wd3", "site": "TotalEnergies_careers", "company": "TotalEnergies" }
]
```

Each entry has 4 required fields:
- `tenant` — lowercase subdomain
- `pod` — Workday pod (`wd1`–`wd5`)
- `site` — the site slug (case-sensitive, as Workday expects it)
- `company` — human-readable label for display

## New Exports

### `workday.mjs`

```js
export function lookupRegistry(tenant)
```
- Loads `workday-registry.json` once at module level via `JSON.parse(readFileSync(...))`
- Returns `{ tenant, pod, site, company }` or `null`
- Lookup is by `tenant` field (lowercase match)

### `ats-detect.mjs`

```js
export function resolveWorkdayFromRegistry(tenant)
```
- Calls `lookupRegistry(tenant)` internally
- Returns the full URL `https://{tenant}.{pod}.myworkdayjobs.com/{site}` or `null`

```js
export function listWorkdayRegistry()
```
- Returns the full registry array `[{ tenant, pod, site, company }, ...]`
- Used by onboarding to list available Workday companies

## Integration Points

### Onboarding (`onboard.md`)

1. Agent calls `listWorkdayRegistry()` to get known Workday companies
2. Filters by relevance to user's domain
3. Proposes them in the company table with pre-built `careers_url`
4. No network verification needed for these entries
5. Update the ATS constraint section in `onboard.md` to include Workday

### Scan (no changes)

The scanner already works with full Workday URLs from `portals.yml`. If onboarding writes correct URLs (using the registry), scan works unchanged.

## Initial Data

6 verified entries: Sanofi, Airbus, Renault, Michelin, Criteo, TotalEnergies.

The ~8 companies with unknown slugs (LVMH, BNP, L'Oréal, Schneider, Safran, Danone, Thales) are out of scope — to be addressed by a future scraper (long-term approach from issue #19).

## Tests

All pure unit tests, no network:

- `lookupRegistry('sanofi')` → returns the Sanofi entry
- `lookupRegistry('unknown')` → returns `null`
- `resolveWorkdayFromRegistry('totalenergies')` → returns full URL
- `resolveWorkdayFromRegistry('inconnu')` → returns `null`
- `listWorkdayRegistry()` → returns non-empty array, each entry has all 4 required fields
- Registry JSON validation: no duplicate tenants, all required fields present

## Files Changed

| File | Change |
|---|---|
| `src/scan/ats/workday-registry.json` | **New** — registry data |
| `src/scan/ats/workday.mjs` | Add `lookupRegistry()` export |
| `src/scan/ats-detect.mjs` | Add `resolveWorkdayFromRegistry()`, `listWorkdayRegistry()` exports |
| `tests/scan/ats-workday.test.mjs` | Add registry tests |
| `.claude/commands/onboard.md` | Add Workday to supported ATS list, document registry usage |
