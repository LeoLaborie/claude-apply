---
description: Interactive calibration of portals.yml title_filter against cached scan-history
argument-hint: ''
---

# /tune-filter

Interactively tune `config/portals.yml.title_filter` (and `candidate-profile.blacklist_companies`) against the cached `data/scan-history.tsv` corpus — no network calls, no re-scan.

## First-run guard

If `config/portals.yml` or `config/candidate-profile.yml` is missing, **stop** and say:

> "No config found. Run `/apply-onboard` first — it will extract your CV, build the configs, and find ~30 target companies for you."

If `data/scan-history.tsv` is missing or empty, **stop** and say:

> "No cached offers to calibrate against. Run `/scan` first."

## State you track in-memory during the loop

- `currentFilter`: `{ positive, negative, required_any, blacklist, companies }` — starts as a copy of what you read from `portals.yml` (positive/negative/required_any, plus the full `tracked_companies` list as `companies` so the simulator can honour per-company `skip_required_any`) and `candidate-profile.yml` (`blacklist_companies` → `blacklist`).
- `lastStats`: result of the most recent simulation against `currentFilter`.

Never write to disk except on an explicit _Save_.

## Loop

Repeat until the user picks Save or Discard:

### 1. Simulate

Run:

```bash
echo '<currentFilter as JSON>' | node src/scan/tune-filter.mjs --history data/scan-history.tsv
```

Parse the JSON result into `lastStats`.

### 2. Render the summary

Print, in this order:

```
Loaded <total> cached offers from data/scan-history.tsv (<first_seen_min> → <first_seen_max>).

Current filter:
  positive:     [<comma-joined>]
  negative:     [<comma-joined>]
  required_any: [<comma-joined>]
  blacklist:    [<comma-joined>]

Effective match: <accepted> / <total> (<ratio_percent>%)

Rejected by reason:
  <count>  <reason>
  ...

Sample rejects (up to 10 per reason):
  • "<title>" (<company>, <portal>)
  ...

Top companies passing filter:
  <accepted>  <company>
  ...
```

If `scan-history.tsv` is older than 7 days (compare latest `first_seen` to today), print after the summary:

```
⚠️  Corpus is <N> days old — consider /scan for fresh data.
```

### 3. Action menu

Use `AskUserQuestion` with these options:

- **Edit filter** → go to 4.
- **Suggest keywords** → go to 5.
- **Test alternative** → go to 6.
- **Save** → go to 7.
- **Discard** → print "No changes written." and exit.

### 4. Edit sub-flow

Ask which list to edit: `positive`, `negative`, `required_any`, `blacklist`.

For the chosen list, offer:

- **Remove** → `AskUserQuestion` `multiSelect` with the list's current values as options; drop the selected ones from `currentFilter`.
- **Add** → free-text prompt ("one keyword per line; wrap in `/…/` for regex"). For each entered term, run it through a regex-compile check by invoking:

  ```bash
  node -e 'import("./src/lib/prefilter-rules.mjs").then(({ checkTitle }) => { const r = checkTitle({title:"x"}, {positive:[<JSON_term>]}); if (r.reason && r.reason.includes("invalid title_filter term")) { process.exit(1); } })'
  ```

  If the process exits non-zero, surface the term as invalid and re-prompt. Do not add invalid terms.

- **Clear** → confirm via `AskUserQuestion` yes/no; on yes, empty the list.
- **Done** → return to step 1 (re-simulate with the mutated `currentFilter`).

### 5. Suggest sub-flow

1. Select from `lastStats.sampleRejected` all entries whose `reason` starts with `title:`. Collect their `title` fields. Also pull the full rejected-title list by re-simulating with `sampleRejected` bumped — but for v1, the in-memory sample (capped at 10 per reason) is enough.
2. Call:

   ```bash
   node -e '
     import("./src/lib/title-ngrams.mjs").then(({ suggestNgrams }) => {
       const titles = <JSON of titles>;
       const existing = <JSON of all current filter terms>;
       const STOP = new Set(["the","and","of","in","for","a","to","at","with","on","as","by","or","an","-"]);
       console.log(JSON.stringify(suggestNgrams(titles, { maxN: 3, minCount: 3, stopWords: STOP, existingTerms: existing })));
     });
   '
   ```

3. Display the top 10 suggestions:

   ```
   Suggestion      Count   Lift
   research engineer   8   0.16
   applied scientist   6   0.12
   ...
   ```

4. `AskUserQuestion` `multiSelect` — user picks which n-grams to add.
5. `AskUserQuestion` single-select — target list for the picks (default `required_any`, alternatives `positive`, `negative`).
6. Merge picks into `currentFilter[targetList]` (deduplicate, preserve existing order, append new at the end).
7. Return to step 1.

### 6. Test alternative sub-flow

Prompt the user for a YAML snippet (parsed with `js-yaml`) shaped like:

```yaml
positive: [Intern]
negative: []
required_any: []
blacklist: []
```

Merge missing keys with `currentFilter`, simulate once without mutating `currentFilter`, print the delta:

```
Effective match: <oldAccepted> → <newAccepted> (<signed_delta>)
New companies represented: <company (count)>, ...
```

Return to step 3 with `currentFilter` unchanged.

### 7. Save sub-flow

1. Compute the diff of each list between the loaded filter and `currentFilter`; render as:

   ```
   title_filter.positive:
     + Stagiaire
     - (nothing removed)
   title_filter.required_any:
     + Research
     + Applied Scientist
   blacklist:
     + ReallyBadCorp
   ```

   If no differences exist, say "No changes to save." and return to step 3.

2. `AskUserQuestion` yes/no: "Write changes to `config/portals.yml` and `config/candidate-profile.yml`?". On no, return to step 3.

3. Apply the writes:
   - For `title_filter.*` changes, call the writer:

     ```bash
     node -e '
       import("./src/lib/portals-writer.mjs").then(({ write }) => {
         write("config/portals.yml", { title_filter: <JSON of changed title_filter keys> });
       });
     '
     ```

   - For `blacklist` changes, use the same writer against `candidate-profile.yml` — **same rules, different file**:

     ```bash
     node -e '
       import("./src/lib/portals-writer.mjs").then(({ write }) => {
         write("config/candidate-profile.yml", { blacklist_companies: <JSON array> });
       });
     '
     ```

     The writer replaces the `blacklist_companies` list in-place and preserves surrounding comments.

   - If either `node -e` exits non-zero, surface the error, write the candidate YAML to `config/portals.yml.tune-proposal`, print:

     > "Could not round-trip; candidate written to `config/portals.yml.tune-proposal`. Merge manually."

4. Re-simulate against the now-persisted filter once, print the final ratio, and exit.

## Example run

```
$ /tune-filter

Loaded 2 359 cached offers from data/scan-history.tsv (2026-04-12 → 2026-04-19).

Current filter:
  positive:     [Intern, Internship, Stage, Stagiaire]
  negative:     []
  required_any: []
  blacklist:    []

Effective match: 412 / 2 359 (17.5%)

...
```
