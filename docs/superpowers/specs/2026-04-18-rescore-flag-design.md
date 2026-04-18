# Design — `--re-score` flag for `/score`

Issue: [#76](https://github.com/anthropics/claude-apply/issues/76)
Date: 2026-04-18

## Problem

`/score <url>` and `/score --batch` dedupe via `getScoredUrls(evaluationsPath)` and skip any URL already present in `data/evaluations.jsonl`. This is correct for normal use, but there is no supported workflow to **re-evaluate** an offer after:

- Updating `config/cv.md` or `config/candidate-profile.yml`.
- Changing the scoring prompt in `src/score/prompt-builder.mjs`.
- Noticing the previous score was based on a closed/broken page (stale body).

The only current workaround is to manually delete the line from `evaluations.jsonl` plus the corresponding `tracker-additions/<id>-<slug>.tsv`. This is error-prone, undocumented, and non-atomic.

## Goals

1. Provide a `--re-score` flag usable in single-URL and batch modes.
2. Preserve the evaluation `id` so report links do not break.
3. Keep existing `evaluations.jsonl` and `tracker-additions/` files in a consistent state (no duplicates, no orphans) after a re-score.
4. Behave safely if the target page has since become unreachable/closed.

## Non-goals

- No changes to the JSONL schema (no new `rescored_date` field).
- No partial re-scoring (e.g. "only re-score offers older than N days") — a `--re-score` run re-scores everything in scope.
- No retention of previous scores / audit trail. A re-score overwrites. Users who want history can `git log data/evaluations.jsonl`.

## User-facing behaviour

### Single URL

```bash
node src/score/index.mjs <url> --re-score
node src/score/index.mjs <url> --from-pipeline --re-score
node src/score/index.mjs <url> --company X --role Y --location Z --re-score
```

- The URL **must** already be present in `data/evaluations.jsonl`. If absent → exit code 2 with message `--re-score: url not found in data/evaluations.jsonl: <url>`.
- Re-fetch the page, re-run `detectClosedPage`, re-build the prompt, re-call `claude -p`.
- Reuse the existing `id` from the matched entry. `--id NNN` is **ignored** in re-score mode (log a warning `[re-score] --id ignored: preserving existing id <id>`).
- Update the entry in-place: same `id`, same `url`, new `date`, new `score`, new `reason`, new `verdict`, new `location` (re-extracted), refreshed `metadata_source` (matches the current flag set).
- Delete the old `tracker-additions/<id>-*.tsv` files (glob by id prefix), then write a fresh TSV.

### Batch

```bash
node src/score/index.mjs --batch --re-score [--parallel N]
```

- Reads all offers from `data/pipeline.md` (inchangé).
- Does **not** filter by `getScoredUrls` — every offer in `pipeline.md` is processed.
- For each offer:
  - If the URL is already in `evaluations.jsonl` → re-score flow (reuse id, update entry, cleanup+rewrite TSV).
  - If the URL is **not** in `evaluations.jsonl` → initial score flow (assign new id from `nextId`, append, write TSV).
- Progress log distinguishes the two cases:
  - `[batch]  [N/T] ↻ Acme — Senior Eng      7.5 apply` (re-score)
  - `[batch]  [N/T] ✓ Bco — Junior Dev        6.0 skip` (initial score)
  - `[batch]  [N/T] ✗ Cco — Role              error: ...`
  - `[batch]  [N/T] ✗ Dco — Role              liveness: http-404` (filtered)
  - `[batch]  [N/T] ⊘ Eco — Role              skipped: page closed, keeping existing score` (re-score on closed page)
- End-of-run summary: `Done: X re-scored, Y scored, Z filtered, W kept (closed), E errors (T total)`.

### Closed / broken pages during re-score

If `detectClosedPage(offer)` returns `closed: true` **during a re-score**:
- Keep the existing `evaluations.jsonl` entry intact.
- Do **not** touch `tracker-additions/`.
- Do **not** append to `filtered-out.tsv` (we already have a valid score; no need to duplicate signals).
- Log `[re-score] <url>: page closed (<reason>), keeping existing score`.
- Exit code 0 for the single-URL path; count under `kept (closed)` in batch summary.

Rationale: an existing valid score is more useful than an erased entry, and a transient fetch failure or liveness false-positive must not destroy data.

(Contrast: initial scoring in `--batch` continues to call `appendFilteredOut` for closed offers, because there is no prior evaluation to preserve. In `--batch --re-score`, the closed-page branch depends on which flow the offer took: a new offer with no prior entry still goes to `filtered-out.tsv`; a re-scored offer keeps its existing entry.)

## Architecture

### Changes by file

**`src/lib/jsonl-writer.mjs`** — add:

```js
export function updateJsonlEntry(filePath, matchFn, newObj) {
  // Read all lines, parse, find first index where matchFn(obj) is true.
  // Replace that line with JSON.stringify(newObj) + '\n'.
  // Write to `<filePath>.tmp` then fs.renameSync -> atomic.
  // Return the previous entry (object) or null if no match.
  // If no match: do NOT write; return null.
}
```

- Atomic via tmp+rename, same pattern used elsewhere in the repo.
- `matchFn` keeps the helper general (callers pass `(e) => e.url === url`).

**`src/lib/tsv-writer.mjs`** — add:

```js
export function removeTrackerTsvById(tsvDir, id) {
  // If tsvDir does not exist: no-op.
  // Read dir, unlink every file matching `^${id}-.*\.tsv$`.
  // Return array of removed filenames (for logging / tests).
}
```

**`src/score/index.mjs`** — changes:

1. `parseScoreArgs` parses `--re-score` into `flags.reScore: boolean`.
2. `parseScoreArgs` accepts the new flag alongside `--batch`, `--from-pipeline`, single-URL, and metadata overrides. No new mutual-exclusion rule: `--re-score` is orthogonal.
3. New helper `findEvaluationByUrl(evalPath, url)` — reads JSONL, returns the first matching entry or null.
4. New helper `writeRescoredRecord(evalPath, tsvDir, record)` — calls `updateJsonlEntry` + `removeTrackerTsvById` + `writeTrackerTsv` under a mutex (see concurrency below).
5. Single-URL path: when `flags.reScore`, branch to the re-score logic described above before the existing scoring block.
6. Batch path: remove the `pending = allOffers.filter(...)` line when `flags.reScore`; for each offer, decide inside the task closure whether to re-score (URL found in JSONL) or score-new.

**`.claude/commands/score.md`** — add:
- `--re-score` in the flags list.
- New section "Re-scoring existing evaluations" with three examples and a note about preserved ids.

### Concurrency in `--batch --re-score`

`updateJsonlEntry` is not safe under concurrent read-modify-write on the same file. The existing batch path uses `appendJsonl` (atomic append, safe concurrently because individual `appendFileSync` calls are atomic for short writes on POSIX). We lose that property when re-scoring.

Solution: serialize all writes to `evaluations.jsonl` through a single-slot queue.

```js
const writeLock = pLimit(1);
// inside each task:
await writeLock(() => writeRescoredRecord(evalPath, tsvDir, record));
// or for score-new:
await writeLock(() => {
  appendJsonl(evalPath, record);
  writeTrackerTsv(tsvDir, tsvRow);
});
```

The scoring itself (fetch + `claude -p`) still runs at `flags.parallel` width. Only the final write is serialized. The write is sub-millisecond compared to the multi-second LLM call, so the bottleneck is unchanged.

### Id allocation in batch

- For re-scored offers: reuse the existing id (found via `findEvaluationByUrl`).
- For score-new offers: allocate from `nextId(evalPath)` at batch start, then distribute incrementally.
- Because re-score does not change the id count, allocating ids purely from `nextId()` for new offers is safe, even if the new offers are interleaved with re-scores in the task queue. Ids remain dense and monotonic.

Concretely: compute `let nextAvail = parseInt(nextId(evalPath), 10)` once, and inside each task lock, if the offer is score-new, consume `nextAvail++`.

### Error handling

- `--re-score` with a URL absent from `evaluations.jsonl` (single mode) → exit 2.
- `--re-score` with `--id NNN` → warning logged, `--id` ignored.
- Re-score fetch throws → count as error, original entry untouched.
- Re-score page closed → original entry untouched, counted as `kept`.
- `updateJsonlEntry` atomic tmp-rename: if rename fails, caller sees the exception; file state is unchanged.

## Testing plan

### Unit

- `tests/jsonl-writer.test.mjs` (new cases):
  - `updateJsonlEntry`: match found → line replaced, others untouched, return value is previous entry.
  - `updateJsonlEntry`: no match → file unchanged, return null.
  - `updateJsonlEntry`: atomic (simulate by checking no partial file after mid-write — or just trust tmp+rename semantics and test the happy path + a corrupted-line scenario where one existing line is not parseable JSON: it should be preserved as-is).

- `tests/tsv-writer.test.mjs` (new cases):
  - `removeTrackerTsvById`: removes `042-old-slug.tsv` and `042-other.tsv`, keeps `043-*.tsv`.
  - `removeTrackerTsvById`: missing directory → no-op.

- `tests/score-index.test.mjs` or new `tests/score-rescore.test.mjs`:
  - `parseScoreArgs('--re-score')` → `flags.reScore === true`.
  - `parseScoreArgs('--re-score --batch')` → both true.
  - `parseScoreArgs('<url> --re-score --id 999')` → both parsed (warning emitted at runtime).

### Integration (fixture-driven, no network)

Using `--json-input` to bypass fetch, and isolated `CLAUDE_APPLY_DATA_DIR`:

- Single re-score with URL present:
  - Pre-seed `evaluations.jsonl` with one entry (id 007), one TSV `007-old-slug.tsv`.
  - Run re-score with stubbed `callClaudeAsync` returning a new score.
  - Assert: `evaluations.jsonl` has one line, id `007`, new score, new date. TSV `007-old-slug.tsv` is gone, a new TSV `007-<new-slug>.tsv` exists.

- Single re-score with URL absent → exit code 2.

- Single re-score on closed page:
  - Pre-seed entry. Stub `detectClosedPage` to return `closed: true`.
  - Assert: entry unchanged, no TSV changes, log contains `page closed, keeping existing score`, exit 0.

- Batch re-score mixing cases:
  - Pre-seed: `pipeline.md` with 3 offers (A, B, C). `evaluations.jsonl` already has A (id 001) and B (id 002). C is new.
  - Run `--batch --re-score`.
  - Assert: 2 re-scored (A, B kept their ids), 1 scored (C assigned id 003). Summary counts match.

## Rollout

- No migration needed: `evaluations.jsonl` schema unchanged.
- Existing users pick up the flag after pulling; old runs without `--re-score` keep current dedup behaviour.

## Alternatives considered

- **Delete-and-re-run** (status quo): rejected per issue — error-prone, leaves dangling TSVs.
- **Add `rescored_date` field**: rejected — schema change, complicates downstream readers (dashboard, tracker). If the distinction between original and re-score dates matters, `git log` is authoritative.
- **Re-score without preserving id**: rejected — breaks deep links in reports and trackers.
- **Batch re-score that skips new offers** (Q1 option B/C): rejected per user decision — the common case is "I changed my CV, re-evaluate everything".
- **Batch writes collected then flushed**: rejected in favour of a write mutex — avoids holding the whole dataset in memory during long batches and makes partial-progress on crash straightforward to reason about.
