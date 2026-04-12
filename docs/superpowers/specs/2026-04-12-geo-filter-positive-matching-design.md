# Design: Positive Geographic Filtering (Issue #14)

## Problem

The current `checkLocation()` in `prefilter-rules.mjs` uses negative regex matching
against title and body text. This fails for Workday offers (empty body) and misses
non-Western location formats ("PRC, Shanghai", "Brazil - Sao Paulo", "Taiwan-Hsinchu").
Result: 12/25 scored offers were out-of-scope geographically, wasting ~$0.36.

Three root causes:
1. `offer.location` (structured, always populated by fetchers) is never checked
2. `LOCATION_FOREIGN_RE` doesn't cover Workday-specific formats
3. No positive filtering — only a hardcoded blocklist of foreign cities/countries

## Solution

Replace negative-only regex with **positive matching against `target_locations`**,
falling back to the current regex heuristic when structured location data is absent.

## New Signature

```javascript
checkLocation(offer, targetLocations)
// targetLocations: string[] e.g. ["France", "Paris", "Remote"]
```

## Logic Flow

```
1. If offer.location is non-empty:
   a. Split location into segments on " - ", "/", ", "
   b. Discard pure "Remote" segments (handled separately)
   c. If geographic segments remain:
      - Any segment matches a target (case-insensitive substring)? → PASS
      - No match? → REJECT "location: <location> not in target zones"
   d. If only "Remote" segments (no geo qualifier):
      - "Remote" is in targetLocations? → PASS
      - Otherwise → PASS (ambiguous, let scorer decide)

2. If offer.location is empty, fallback to current regex on title + body:
   a. Title has foreign match AND no FR match? → REJECT
   b. FR match in title or body? → PASS
   c. Foreign match in body only? → REJECT
   d. No signal? → PASS (ambiguous)
```

### Remote Handling

- `"Remote - France"` → segments ["Remote", "France"] → geo segment "France" matches target → PASS
- `"Remote - US"` → segments ["Remote", "US"] → geo segment "US" matches no target → REJECT
- `"Remote"` alone → no geo segments → PASS (ambiguous)

## Configuration

### In `candidate-profile.yml` (optional)

```yaml
# --- Geographic targeting (optional) ---
target_locations:
  - France
  - Paris
  - Remote
```

### Default Derivation

When `target_locations` is absent, derived from existing profile fields:

```javascript
const targetLocations = profile.target_locations
  || [profile.country, profile.city, 'Remote'].filter(Boolean);
```

For Alice Martin: `["France", "Paris", "Remote"]`.

### Wiring

`src/scan/index.mjs` builds `targetLocations` from the profile and passes it
via `config.targetLocations` to `runPrefilter`, which forwards it to `checkLocation`.

## Changes by File

| File | Change |
|------|--------|
| `src/lib/prefilter-rules.mjs` | New `checkLocation(offer, targetLocations)` signature; positive matching on `offer.location` with segment splitting; fallback to existing regex; `runPrefilter` passes `config.targetLocations` |
| `src/scan/index.mjs` | Build `targetLocations` from profile before calling `runPrefilter` |
| `templates/candidate-profile.example.yml` | Add commented `target_locations` section |
| `tests/lib/prefilter-rules.test.mjs` | New tests for structured location, remote handling, fallback |

## Key Test Cases

| # | location | targets | title/body | Expected | Why |
|---|----------|---------|------------|----------|-----|
| 1 | `"Paris, France"` | `["France"]` | — | PASS | Substring match on "France" |
| 2 | `"PRC, Shanghai"` | `["France", "Remote"]` | — | REJECT | No segment matches targets |
| 3 | `"Brazil - Sao Paulo"` | `["France"]` | — | REJECT | No segment matches |
| 4 | `"Remote - France"` | `["France", "Remote"]` | — | PASS | Geo segment "France" matches |
| 5 | `"Remote - US"` | `["France", "Remote"]` | — | REJECT | Geo segment "US" no match |
| 6 | `"Remote"` | `["France", "Remote"]` | — | PASS | No geo qualifier, ambiguous |
| 7 | `""` | `["France"]` | body: "Paris office" | PASS | Fallback regex finds FR |
| 8 | `""` | `["France"]` | body: "New York City, USA only" | REJECT | Fallback regex finds foreign |
| 9 | `""` | `["France"]` | body: "Great team" | PASS | Fallback: no signal, ambiguous |
| 10 | `"Taiwan-Hsinchu"` | `["France"]` | — | REJECT | Segment split on "-", no match |
| 11 | `"Paris, France / London, UK"` | `["France"]` | — | PASS | One segment matches |
| 12 | — | (derived) | — | — | Verify default derivation from profile |

## Non-Goals

- Regex escape hatch for `target_locations` (YAGNI — add later if needed)
- Scoring prompt changes (scorer already receives location metadata)
- Changes to fetcher location extraction (already correct)
