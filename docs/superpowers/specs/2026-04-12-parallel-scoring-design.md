# Parallel Scoring Design

**Issue:** #15 — `feat(score): Scoring parallèle (--parallel N)`
**Date:** 2026-04-12
**Status:** Approved

## Problem

Scoring 25 offers takes ~5 minutes sequentially. Each call spawns a blocking `claude -p` process via `spawnSync`. The calls are completely independent — parallelizing them with 5 workers brings wall time from ~5 min to ~1 min.

## Approach

**Approach A (selected):** Convert `callClaude` from `spawnSync` to async `spawn`, add a zero-dependency Promise-based semaphore (`pLimit`), and add a `--batch` mode to `src/score/index.mjs` that reads unscored offers from `pipeline.md`.

Rejected alternatives:
- **Worker threads:** Over-engineered for I/O-bound work. Each worker would load Playwright + spawn `claude` — thread isolation adds complexity without benefit.
- **Separate batch script:** Duplicates `main()` logic, two entry points to maintain, still requires making `callClaude` async.

## CLI Interface

### Single-URL (unchanged)

```bash
node src/score/index.mjs <url> [--from-pipeline] [--id NNN]
```

### Batch (new)

```bash
node src/score/index.mjs --batch [--parallel N]
```

- `--batch`: Read all offers from `data/pipeline.md`, filter out those already in `evaluations.jsonl` (dedup by URL), score the rest.
- `--parallel N`: Number of concurrent workers. Default: `5`. Implies `--batch`.
- `--batch` and `<url>` are mutually exclusive.

The `/score` slash command remains single-URL. Batch mode is invoked via `npm run score:batch` or programmatically.

## Internal Changes

### `callClaude` → `callClaudeAsync`

Replace `spawnSync` with `spawn` from `node:child_process`. Returns a `Promise<string>` that resolves with full stdout. Stderr is buffered and logged on error. Signature: `(system, user) → Promise<string>`.

### `pLimit` — zero-dependency semaphore

New file `src/lib/p-limit.mjs` (~15 lines). Exports `pLimit(concurrency)` returning a wrapper `limit(fn) → Promise`. Separate file for unit testing and potential reuse (e.g., parallel scan).

### ID pre-allocation

Before launching the pool, read `nextId()` once and pre-allocate one ID per pending offer sequentially (`startId`, `startId+1`, ..., `startId+N-1`). Each worker receives its ID as a parameter — no race condition on the counter.

### JSONL writing

Workers return their `record` to the main flow. Writing to `evaluations.jsonl` and `tracker-additions/` happens sequentially as each Promise resolves (completion order, not input order). `appendFileSync` is atomic for short lines on a single process — safe since everything runs in the same event loop.

## Batch Flow

1. Read `data/pipeline.md` via `readPipelineMd()` → list of offers `{url, company, title, location}`
2. Read `data/evaluations.jsonl` → extract the set of already-scored URLs
3. Filter: `pendingOffers = pipeline.filter(o => !scoredUrls.has(o.url))`
4. If empty → log `[batch] Nothing to score — all offers already evaluated.` and exit 0
5. Pre-allocate IDs: `startId = nextId(evalPath)`, each offer gets `startId + index`
6. Load `cvMarkdown` once (shared across all workers)
7. Launch pool `pLimit(N)` over `pendingOffers`

### Per-worker flow

1. `fetchOfferBody(url)` — fetch the page via Playwright (needed for JD body)
2. `runPrefilter(offer)` — if skip, write to `filtered-out.tsv`, return `{skipped: true}`
3. `detectClosedPage(offer)` — if closed, same treatment
4. `buildPrompt({cvMarkdown, offer})` — CV loaded once, shared
5. `callClaudeAsync(system, user)` — the bulk of the time
6. `parseScoreJson(raw)` → return the `record`

Each worker is autonomous (fetch + score). `pLimit` controls global concurrency, preventing both too many Playwright browsers and too many `claude` processes. With `--parallel 5`, up to 5 headless Chromium instances may run simultaneously (~200MB each). The default of 5 is chosen to stay under ~1GB extra RAM while still achieving a ~5x speedup. Users on memory-constrained machines can lower it with `--parallel 2`.

## Output

### Progress (stderr)

Each worker logs on completion:
```
[batch]  [3/25] ✓ Mistral AI — Research Intern          4.2 apply
[batch]  [4/25] ✓ Datadog — SRE Intern                  3.1 skip
[batch]  [5/25] ✗ Qonto — Backend Intern                skipped (prefilter: location)
```

Individual errors don't stop the batch:
```
[batch]  [7/25] ✗ Acme Corp — Data Intern               error: claude CLI timeout
```

Failed offers are not written to `evaluations.jsonl` — they will be retried on next `--batch` run.

### Summary (stderr)

```
[batch] Done: 22 scored, 2 filtered, 1 error (25 total)
[batch] Results: 14 apply, 8 skip
[batch] Time: 58s (5 parallel workers)
```

### Stdout

Each record as a JSON line (same format as single-URL mode), consumable by pipes and slash commands.

## Files Changed

| File | Change |
|------|--------|
| `src/score/index.mjs` | `callClaude` → `callClaudeAsync`, new `--batch` flow in `main()`, `parseScoreArgs` extended |
| `src/lib/p-limit.mjs` | **New** — Promise semaphore (~15 lines) |
| `.claude/commands/score.md` | Document `--batch` and `--parallel N` |
| `docs/score-workflow.md` | Add batch section |
| `package.json` | Add `score:batch` script |

## Files NOT Changed

- `prompt-builder.mjs`, `prefilter.mjs`, `jd-truncate.mjs` — untouched
- `jsonl-writer.mjs`, `tsv-writer.mjs` — untouched, writing remains sequential on caller side
- `pipeline-md.mjs` — reuse `readPipelineMd` and `findOfferByUrl` as-is

## Tests

| Test file | Verifies |
|-----------|----------|
| `p-limit.test.mjs` | Concurrency respected (max N simultaneous), completion order, rejection propagation |
| `score-batch.test.mjs` | URL dedup (offers already in evaluations.jsonl skipped), ID pre-allocation correctness, progress counter, single error doesn't abort batch |
| `callClaudeAsync.test.mjs` | Async behavior, stdout parsing, process error handling |

Batch tests mock `callClaudeAsync` to avoid spawning `claude -p` in CI. `p-limit` tests are purely functional (Promises with timers).
