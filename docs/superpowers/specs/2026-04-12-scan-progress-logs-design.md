# Design: Scan Progress Logs (Issue #12)

## Problem

`runScan()` produces no output until the entire scan completes. When scanning 55 companies, users cannot tell whether the scan is running, stuck, or how far along it is.

## Solution

Add an optional `onProgress` callback to `runScan()`. The CLI wires it to `stderr`; tests can capture or ignore it.

## Callback Signature

```js
onProgress({ index, total, company, platform, count, error })
```

| Field      | Type             | Description                                    |
|------------|------------------|------------------------------------------------|
| `index`    | `number`         | 1-based counter of completed companies         |
| `total`    | `number`         | Total number of companies to scan              |
| `company`  | `string`         | Company name                                   |
| `platform` | `string \| null` | Detected ATS platform                          |
| `count`    | `number`         | Number of raw offers fetched                   |
| `error`    | `string \| null` | Error message if fetch failed, null on success |

## Call Site

The callback fires inside the existing `for (const result of fetchResults)` loop in `runScan()`, after the `Promise.all` resolves. Since iteration order matches the `companies` array order, the counter increments deterministically.

## CLI Output Format (stderr)

```
[12/55] ✓ Mistral AI — 147 raw, 3 new
[13/55] ✗ Datadog — fetch error: 403
```

- Success: `[index/total] ✓ company — N raw, M new`
- Error: `[index/total] ✗ company — error message`
- Active for both normal and `--json` modes (stderr does not pollute stdout)

Note: `new` count requires tracking per-company new offers in the results loop, which is derived from offers that pass dedup and prefilter.

## Concurrency

The existing `Promise.all` parallel fetch is preserved. No change to scan performance.

## What Does Not Change

- `runScan()` return value shape
- `formatSummary()` final output
- Existing tests (no `onProgress` = no log)

## Files Changed

| File                           | Change                                                        |
|--------------------------------|---------------------------------------------------------------|
| `src/scan/index.mjs`          | Add `onProgress` to `runScan` opts, call in results loop, wire to stderr in `main()` |
| `tests/scan/progress.test.mjs`| New test verifying callback args (index, total, company info) |

## Tests

A test passes a mock `onProgress` callback that accumulates calls into an array, then asserts:
- Called once per company
- `index` increments from 1 to `total`
- `total` equals number of companies
- Error companies have non-null `error` field
