# Design: Confirmation detection fallback for page freeze (Issue #18)

## Problem

After clicking "Submit application", the ATS page can freeze (JS timeout after 45s). Both `javascript_tool` and `get_page_text` depend on the renderer process — they fail silently. The current polling loop (apply.md step 8) has no fallback and returns `Submitted (unconfirmed)` even when the application was successfully submitted.

Beyond page freeze, other degradation cases are unhandled:
- Tab closed by the site after submit
- Redirect to a third-party domain (e.g. `success.lever.co/...`)
- Modal blocking the DOM without changing the URL

## Approach

Three-level fallback strategy, codified as pure functions in `confirmation-detector.mjs` + updated playbook instructions.

| Level | Trigger | Data source | Action |
|-------|---------|-------------|--------|
| L1 — Normal | `javascript_tool` + `get_page_text` respond | URL + pageText | `classifyConfirmation()` (existing) |
| L2 — Renderer blocked | `javascript_tool` timeout/error 2x | `tabs_context_mcp` (title + URL via browser process) | `classifyTabContext()` (new) |
| L3 — URL unchanged | L2 finds no match and URL == beforeUrl | Navigate to candidate URLs | `suggestProbeUrls()` (new) → `navigate` → `classifyConfirmation()` |

## Code changes

### `src/apply/confirmation-detector.mjs`

#### `classifyTabContext({ url, title })`

New exported function. Classifies from `tabs_context_mcp` data (no pageText).

- Matches `url` against existing `SUCCESS_URL` patterns
- Matches `url` against `/already-received` (Lever re-submission block) → `Applied`
- Matches `title` against a subset of `SUCCESS_TEXT` suitable for `<title>` tags:
  - `thank you for (applying|your application)`
  - `application (has been )?(received|submitted)`
  - `your application is (complete|received)`
  - `merci (pour|de) votre candidature`
  - `candidature (bien )?(reçue|envoyée|enregistrée)`
- If match → `{ status: 'Applied', reason: 'tab context: url|title matched' }`
- Otherwise → `{ status: 'Submitted (unconfirmed)', reason: 'tab context: no pattern matched' }`
- No error detection (can't read validation errors from tab title)
- Handles `title: null/undefined` without crashing

#### `suggestProbeUrls(baseUrl)`

New exported function. Generates candidate URLs to test when L1 and L2 fail.

```js
suggestProbeUrls('https://jobs.lever.co/acme/abc123')
→ [
    'https://jobs.lever.co/acme/abc123/thanks',
    'https://jobs.lever.co/acme/abc123/thank-you',
    'https://jobs.lever.co/acme/abc123/confirmation',
    'https://jobs.lever.co/acme/abc123/submitted',
    'https://jobs.lever.co/acme/abc123/merci',
    'https://jobs.lever.co/acme/abc123/already-received',
  ]
```

- Strips trailing slash from baseUrl before suffixing
- Strips query string before suffixing (ATS confirmation pages don't route on query params)
- Returns an array — no fetching, just URL generation

#### `classifyConfirmation` — no changes

Already handles `pageText: null` via `pageText || ''`.

## Playbook changes

### `.claude/commands/apply.md` step 8

Replace the current 15s polling loop with the L1→L2→L3 algorithm:

```
Capture beforeUrl before submit (already done in step 7).
attempts = 0, level = 'L1'

LOOP (max 20s, poll 2s):

  IF level == 'L1':
    Try javascript_tool → afterUrl
    Try get_page_text → pageText
    IF timeout/error on either:
      attempts++
      IF attempts >= 2: level = 'L2'
      CONTINUE
    classifyConfirmation({ beforeUrl, afterUrl, pageText })
    → Applied/Failed: EXIT
    → Submitted (unconfirmed): CONTINUE

  IF level == 'L2':
    tabs_context_mcp → { url, title } of active tab
    IF tab gone/closed:
      status = 'Submitted (unconfirmed)'
      reason = 'tab closed by site after submit'
      EXIT (alert user)
    classifyTabContext({ url, title })
    → Applied: EXIT
    IF url != beforeUrl AND no match:
      Try get_page_text (new page may be responsive)
      IF success: classifyConfirmation({ beforeUrl, afterUrl: url, pageText })
      → Applied/Failed: EXIT
    IF url == beforeUrl: level = 'L3'

  IF level == 'L3':
    suggestProbeUrls(beforeUrl) → candidates[]
    FOR EACH candidate:
      navigate → candidate
      Wait 2s
      Try get_page_text → pageText
      classifyConfirmation({ beforeUrl, afterUrl: candidate, pageText })
      → Applied: EXIT
    IF no match: status = 'Submitted (unconfirmed)', EXIT

END LOOP
timeout 20s reached → status = 'Submitted (unconfirmed)'
```

Changes vs current:
- Timeout extended 15s → 20s (margin for L2/L3)
- 2 `javascript_tool` failures trigger L2 instead of looping uselessly
- L3 is destructive (navigates away) — only reached if L2 also fails
- Tab stays open on any status != `Applied` (unchanged)

Known gotcha notes added:
- **Lever `/already-received`**: reinforced in L2 via `classifyTabContext`
- **Tab closed by site**: L2 detects, `Submitted (unconfirmed)`, alert user
- **Third-party domain redirect**: L2 captures via `tabs_context_mcp`
- **WTTJ silent modal close**: L3 probes candidate URLs

### `docs/playbooks/apply-workday.md` step 5

Replace the current 15-line polling section with a one-line reference:

> Follow step 8 of `.claude/commands/apply.md` for confirmation detection (L1→L2→L3 fallback).

This eliminates duplication between the two playbooks.

## Tests

### `tests/apply/confirmation-detector.test.mjs`

**`classifyTabContext`** (6 tests):
- Title "Thank you for applying" → `Applied`
- Title "Merci pour votre candidature" → `Applied`
- URL matches `/confirmation` → `Applied`
- URL matches `/already-received` → `Applied`
- Generic title + unchanged URL → `Submitted (unconfirmed)`
- Title `null`/`undefined` → no crash, `Submitted (unconfirmed)`

**`suggestProbeUrls`** (3 tests):
- Standard URL → returns 6 expected candidates
- URL with trailing slash → strips before suffixing
- URL with query string → suffixes before `?`

### No browser integration tests

The L1→L2→L3 algorithm is orchestrated by the LLM agent, not Node code. Coverage comes from:
- Pure functions tested (above)
- Playbook is the spec for agent behavior
- Manual validation with a real `/apply` on an ATS

## Files touched

| File | Action |
|------|--------|
| `src/apply/confirmation-detector.mjs` | Add `classifyTabContext`, `suggestProbeUrls` |
| `tests/apply/confirmation-detector.test.mjs` | Add ~9 tests |
| `.claude/commands/apply.md` step 8 | Rewrite with L1→L2→L3 algorithm |
| `docs/playbooks/apply-workday.md` step 5 | Replace with reference to apply.md step 8 |

No new files. No dependencies added.
