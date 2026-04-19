# Scan filter rework — soft match + language filter

**Issue**: [#82](https://github.com/LeoLaborie/claude-apply-dev/issues/82) — items **1** (soft match) and **2** (language filter).
**Date**: 2026-04-19
**Scope**: spec #1 of 2. A follow-up spec will cover items 4, 5, 6 (UX/diagnostics). Item 3 (surface `filtered-out.tsv`) is already done in PR #79.

## Problem

A fresh scan with 25 verified AI/ML companies returned **1 usable lead out of 2 359 raw offers**. Two root causes:

1. The `required_any` filter (`[AI, ML, Research, …]`) applies to the **title only**. Roles like « Research Scientist Intern » at Mistral or « Applied Scientist » at Anthropic get rejected because neither « AI » nor « ML » appears literally in the title — even though the offer's description explicitly targets AI/ML.
2. The single match (Shift Technology) demanded a Spanish speaker. The user has Spanish A2 and cannot apply. Nothing in the scanner detects language requirements, so these offers waste user attention.

## Goals

- **Item 1**: Allow `required_any` to match on title **OR** description, opt-in via new `portals.yml` key. Expected impact: ≥10 distinct hits across the top-5 AI companies on the onboarding profile.
- **Item 2**: Automatically exclude offers whose title requires a language the candidate doesn't master at ≥ B2. Auto-derived from `candidate-profile.yml.languages` — zero new config.

## Non-goals

- Items 4 (drill-down samples), 5 (auto-suggest relaxation), 6 (`--explain-filter`) — separate spec.
- Body-based language detection (title-only for v1).
- English/French baseline enforcement — the candidate is assumed fluent in both; « English only » or « French required » are not treated as filters.
- Per-company overrides for `required_any_in` or `language_filter`.

## Approach

**Approach 1 — extend `prefilter-rules`** (chosen).
- Keep existing filter chain shape; add one new rule (`checkLanguages`) and extend `checkTitle` to accept an optional `body`.
- Add two small pure modules: `src/lib/language-detect.mjs` (regex map + level ranker) and `src/scan/fetch-offer-body.mjs` (platform-aware lazy fetch).
- No refactor of the filter chain structure — deferred until a third or fourth filter justifies it (YAGNI).

Rejected alternatives:
- *Filter chain object (per-rule files)*: cleaner long-term but unnecessary for two rules.
- *Enrich-then-filter (always fetch body)*: wastes fetches for offers that pass on title alone.

## Architecture

### New files

**`src/lib/language-detect.mjs`** (pure, ~60 LOC)
- `LANG_PATTERNS`: map of ISO-639-1 code → RegExp for non-baseline languages (es, de, it, nl, pt, ja, zh, ar). English and French are excluded — treated as baseline.
- `detectRequiredLanguages(text: string): string[]` — returns the array of codes whose pattern matches.
- `MIN_LANGUAGE_LEVEL = 'B2'` — hardcoded constant.
- `LEVEL_RANK: Record<string, number>` — `A1=1, A2=2, B1=3, B2=4, C1=5, C2=6, native=7`, unknown = 0.
- `levelRank(level: string): number`.

**`src/scan/fetch-offer-body.mjs`** (~40 LOC)
- `fetchOfferBody(offer): Promise<string | null>` — dispatch by `offer.platform`:
  - **Lever / Ashby**: return `offer.body` if already populated (no network call).
  - **Greenhouse**: GET `offer.url`, parse HTML, strip tags via `/<[^>]+>/g`, return text.
  - **Workday**: similar to Greenhouse; best-effort HTTP GET.
  - Network or parse error → return `null`, log warning to stderr.
- Purely additive — does not mutate `offer`.

### Modified files

**`src/lib/prefilter-rules.mjs`**
- `checkTitle(offer, whitelist, opts?)` — new `opts.body` optional. Only `required_any` is checked against `title + body`; `positive` and `negative` remain title-only.
- New `checkLanguages(offer, profileLanguages)` — uses `detectRequiredLanguages` on `offer.title`, then verifies each required code is in `profileLanguages` at rank ≥ `B2`. Absent profile → pass.
- `runPrefilter(offer, config)` — signature unchanged (just one new optional field `config.fetchBody`), becomes `async`. When `checkTitle` fails with `title: missing required_any keyword`, `whitelist.required_any_in` includes `description`, and `config.fetchBody` is provided, `runPrefilter` awaits `config.fetchBody(offer)` and re-runs only the `required_any` portion with the body. Chain order:
  `checkTitle → checkBlacklist → checkLanguages → checkLocation → checkStartDate`.
- Keeps `src/lib/` free of any `src/scan/` imports — `fetchBody` is injected from the caller.

**`src/scan/index.mjs`**
- In the per-offer loop: call `await runPrefilter(offer, effectiveConfig)` (now async). Build `effectiveConfig.fetchBody = (o) => fetchOfferBody(o)` once and pass it through.
- New `filtered.skipped_language` counter; `reasonToStatus` maps `language:*` → `skipped_language`.
- `formatSummary` prints one new line: `  • Langue           ${result.filtered.skipped_language}`.

**`templates/portals.example.yml`**
- Document the new `required_any_in: [title, description]` key with the same commentary as existing fields.

### Config changes (`portals.yml`)

```yaml
title_filter:
  positive: [Intern, Internship, Stage, Stagiaire]
  required_any: [AI, ML, Research]
  # NEW — default: [title]. When [title, description], also match required_any
  # against the offer body when a title-only match fails. Costs one extra HTTP
  # fetch per candidate offer on Greenhouse/Workday.
  required_any_in: [title, description]
```

No change to `candidate-profile.yml` — `languages` is read as-is.

### Reason strings

- `title: missing required_any keyword` (unchanged for title-only)
- `title: missing required_any (title+description)` (after soft-match failure)
- `language: requires es (have A2)` / `language: requires de (have none)`

## Data flow

```
per offer:
  ├─ checkTitle(offer, whitelist, {body: null})
  │    └─ if pass → continue to next rule
  │    └─ if fail with reason "title: missing required_any keyword"
  │         AND whitelist.required_any_in includes 'description':
  │         ├─ body = await fetchOfferBody(offer)
  │         ├─ checkTitle(offer, whitelist, {body})  ← only required_any re-checked
  │         └─ if still fail → reject with "(title+description)" suffix
  ├─ checkBlacklist(offer, config.blacklist)
  ├─ checkLanguages(offer, config.profileLanguages)  ← NEW
  ├─ checkLocation(offer, config.targetLocations)
  └─ checkStartDate(offer, config.minStartDate)
```

`config.profileLanguages` is populated by `runScan` from `profile.languages`. Absent → `checkLanguages` skips. `config.fetchBody` is injected by `runScan` and always defined; `runPrefilter` only invokes it when the soft-match short-circuit triggers.

## Errors & edge cases

| Case | Behaviour |
|---|---|
| `profile.languages` absent or empty | `checkLanguages` returns `{pass: true}` |
| `required_any_in` malformed (non-array or unknown values) | Silent fallback to `[title]`, single warning to stderr |
| `fetchOfferBody` throws or returns null | Soft-match treated as failed → reject |
| Title matches multiple language codes (« DE/ES speaker ») | All must be present at ≥ B2 |
| Body returned as raw HTML | Tags stripped via `/<[^>]+>/g` before regex |
| `required_any_in` includes `description` but body is empty | Reject as if body missing |
| `positive` fails (title-only) | No body fetch — offer rejected immediately |
| `negative` matches (title-only) | No body fetch — offer rejected immediately |
| Language code in profile outside `LANG_PATTERNS` (e.g. `pl`) | Ignored — only languages we can detect are enforced |
| « English only » / « French required » in title | Not rejected — en/fr are baseline |

**Parallelism**: offers are processed sequentially per company. Soft-match adds at most N extra HTTP GETs where N = offers that matched `positive` but not `required_any`. Typical scan caps at a few dozen extra fetches total.

## Testing strategy

### New test files

**`tests/lib/language-detect.test.mjs`** (~10 cases)
- `detectRequiredLanguages`:
  - « Data Scientist - Spanish speaker » → `['es']`
  - « Senior Deutschsprachig Engineer » → `['de']`
  - « Bilingual DE/ES Analyst » → matches both
  - « Argentinian Data Scientist » → no match (country name, not language marker)
  - Titles with accents: « Español native » → `['es']`
  - No language marker → `[]`
- `levelRank`: A1<A2<B1<B2<C1<C2<native ; unknown level → 0.

**`tests/lib/prefilter-language.test.mjs`**
- Candidate without `es`, offer requires `es` → `{pass: false, reason: 'language: requires es (have none)'}`
- Candidate with `es: C1` → pass
- Candidate with `es: A2` → reject
- `profile.languages` undefined → pass
- Chain order validated via `runPrefilter` fixture.

**`tests/scan/fetch-offer-body.test.mjs`**
- Lever offer with `offer.body` already populated → no `fetch()` call, returns body as-is
- Greenhouse offer: mocked `fetch` returns HTML → body stripped of tags
- Network error (500) → returns `null`

### Modified existing tests

- `tests/lib/prefilter-rules.test.mjs`: add fixture with `required_any_in: [title, description]` — title lacks keyword but body contains it → pass ; both lack → reject with `(title+description)` suffix.
- `tests/scan/index.test.mjs`: integration with three mocked offers (one title-match, one description-soft-match, one language-reject) — assert `filtered.skipped_language === 1` and summary includes « Langue » line.

### Coverage target

All branches of `checkLanguages` and the soft-match short-circuit. ~20 new tests. `npm test` green on the branch before requesting review.

## Acceptance criteria

From issue #82:

- Fresh scan with the onboarding `portals.yml` + `target_role: "IA / ML / Deep Learning"` yields **≥10 distinct hits** across Mistral, Anthropic, OpenAI, DeepMind, Cohere.
- Offers requiring Spanish/German/Italian/Dutch/Portuguese/Japanese/Chinese/Arabic (detected in title) are rejected automatically when the candidate lacks that language at B2+.
- `filtered.skipped_language` counter appears in the scan summary.
- All existing tests still pass; new tests added for the new behaviour.

## Out of scope (tracked for spec #2)

- Item 4: 3 random samples per rejected bucket in the summary.
- Item 5: « matched/raw < 1% » warning with relax suggestion.
- Item 6: `--explain-filter` flag printing the merged effective filter.
