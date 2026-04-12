# Design: per-company `skip_required_any` flag

**Issue:** [#13 — feat(scan): Flag skip_required_any pour les entreprises AI-native](https://github.com/LeoLaborie/claude-apply/issues/13)

**Problem:** Companies like Mistral AI are 100% AI-focused, so their job titles don't redundantly include "AI" or "ML". The global `required_any` filter in `portals.yml` rejects valid offers because the domain keyword is implicit in the company name.

**Solution:** A per-company `skip_required_any: true` boolean in `portals.yml` that bypasses the `required_any` check for that company's offers, while keeping `positive` and `negative` filters intact.

## Config change

New optional field on `tracked_companies` entries:

```yaml
tracked_companies:
  - name: Mistral AI
    careers_url: https://jobs.lever.co/mistral
    skip_required_any: true   # domain is implicit — skip required_any filter
```

Default: `false` (no behavior change for existing entries).

## Code change

**`src/scan/index.mjs` ~line 160–162** — before calling `runPrefilter`, build a per-company whitelist when the flag is set:

```js
const companyWhitelist = company.skip_required_any
  ? { ...whitelist, required_any: [] }
  : whitelist;
check = runPrefilter(offer, { ...prefilterConfig, whitelist: companyWhitelist });
```

`checkTitle` (line 125) already treats an empty `required_any` array as a no-op via `Array.isArray(whitelist.required_any) && whitelist.required_any.length > 0`, so **no change to `prefilter-rules.mjs`**.

## What does NOT change

- `prefilter-rules.mjs` — untouched
- `score/` and `apply/` — unaffected (flag only consumed by scan)
- `positive` and `negative` filters — still applied for skip_required_any companies

## Tests

1. **Unit test** in `tests/lib/prefilter-title.test.mjs`: confirm `required_any: []` is a no-op (explicit regression guard — currently only implicitly covered).
2. **Integration-level test**: verify the scan loop respects `skip_required_any` by passing a company config with the flag set and asserting the offer passes prefilter despite missing `required_any` keywords.

## Docs

- `templates/portals.example.yml`: add `skip_required_any: true` on Mistral entry with a comment.
- `docs/scan-workflow.md`: add a paragraph in the "Title filter" section explaining the per-company override.

## Scope

~10 lines of production code, ~20 lines of tests, 2 doc updates. No new dependencies, no schema changes, no breaking changes.
