# Design: per-company `target_locations` override

**Issue:** [#77 — improvement: portals.yml should support per-company target_locations override](https://github.com/LeoLaborie/claude-apply/issues/77)

**Problem:** `config/candidate-profile.yml` defines a global `target_locations` list applied uniformly to every company during `/scan`. Some companies have remote-first roles that are de-facto acceptable even though their job location string shows a foreign city (e.g. "Berlin (Remote OK)"). Conversely, a user may want to accept a specific city for one employer only (e.g. London for a dream company) without broadening the global preference. There is currently no way to express this per-company.

**Solution:** An optional `target_locations` array on `tracked_companies` entries in `portals.yml`. When present, it replaces the global `targetLocations` for that company's offers only, following the exact pattern of the existing `skip_required_any` per-company override.

## Config change

New optional field on `tracked_companies` entries:

```yaml
tracked_companies:
  - name: DeepMind
    careers_url: https://boards.greenhouse.io/deepmind
    enabled: true
    target_locations:        # overrides global target_locations for this company
      - London
      - Remote
      - France
```

Semantics:
- **Key absent / `undefined`** → fallback to global `profile.target_locations`.
- **Array present (including empty `[]`)** → strict override; global list is ignored for this company.
- Empty array `[]` is a valid and deliberate override meaning "no location accepted" for this company (every offer rejected on the location check). This is option A from brainstorming — presence of the key is the signal, not truthiness.

No default change for existing entries (no key → identical behavior).

## Code change

**`src/scan/index.mjs`** — extend the existing `effectiveConfig` spread block (currently lines 179–181) to include a conditional `targetLocations` override:

```js
const effectiveConfig = {
  ...prefilterConfig,
  ...(companyConfig?.skip_required_any && {
    whitelist: { ...whitelist, required_any: [] },
  }),
  ...(Array.isArray(companyConfig?.target_locations) && {
    targetLocations: companyConfig.target_locations,
  }),
};
```

Key detail: `Array.isArray(...)` — not truthiness — so that an empty array still triggers the override, per the semantics above.

`checkLocation` in `src/lib/prefilter-rules.mjs` already performs a case-insensitive substring match (`seg.toLowerCase().includes(t.toLowerCase())`), so **no change to `prefilter-rules.mjs`**.

## What does NOT change

- `src/lib/prefilter-rules.mjs` — untouched.
- `src/score/` and `src/apply/` — unaffected (override is consumed only by scan).
- Global `profile.target_locations` behavior — identical when no per-company override is set.
- Other per-company fields (`enabled`, `skip_required_any`) — unchanged and still composable with the new field.

## Tests

In `tests/scan/scan.test.mjs`, add cases covering:

1. **Override applied when defined.** Company with `target_locations: ['London']` receives an offer located in "London, UK" → offer passes the location check even when global `targetLocations = ['Paris']`.
2. **Fallback when absent.** Same setup but without `target_locations` on the company → offer is rejected on location (`skipped_location`).
3. **Empty array = strict reject.** Company with `target_locations: []` → every offer rejected on location, regardless of global list.
4. **Other companies unaffected.** Two companies in the same scan, only one has the override → the other still uses the global list.

Use the existing fixture-driven style in `scan.test.mjs`; no new helpers required.

## Docs

- `templates/portals.example.yml` — add a commented example on one entry showing the new field (mirroring the existing `skip_required_any` example).
- `docs/scan-workflow.md` — new sub-section "Per-company override: `target_locations`" right after the existing "Per-company override: `skip_required_any`" section, documenting the fallback/override/empty-array semantics.

## Scope

~5 lines of production code, ~40 lines of tests, 2 doc updates. No new dependencies, no schema changes, no breaking changes.
