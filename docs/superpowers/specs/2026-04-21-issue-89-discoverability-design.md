# Issue #89 — Slash-command discoverability and post-action guidance

**Date:** 2026-04-21
**Issue:** [#89 — docs: improve slash-command discoverability and post-action guidance](https://github.com/LeoLaborie/claude-apply/issues/89)
**Status:** Design approved, ready for implementation plan.

## Context

During an onboarding session (2026-04-19), `/scan` returned `1 hit out of 2 359 raw offers`. The user had no path from that result to the tools that would actually help diagnose it (`/explain`, `/dashboard`, `--dry-run`), and no concept of what to expect from the system over time. Issue #89 bundles the seven discoverability gaps surfaced during that single session.

This spec addresses all seven items through four additive, locally-scoped deliverables. No architectural change, no data-format change, no new runtime dependencies.

## Goals

- Every slash command that wraps a node CLI (`/scan`, `/score`, `/explain`, `/dashboard`) accepts `--help` / `-h` and prints a deterministic usage block.
- `/apply` (a skill, not a CLI) documents its usage in `.claude/commands/apply.md` with an explicit instruction to honor `--help` in `$ARGUMENTS`.
- The `/scan` summary footer points the user to the next useful commands (`/score`, `/explain`, `/dashboard`) and surfaces the flags (`--dry-run`, `--only`, `--json`).
- The onboarding summary shows the user's current `title_filter`, a dry-run calibration preview of their first scan, and the full command list (`/scan`, `/score`, `/apply`, `/explain`, `/dashboard`).
- The `title_filter` format is documented in `docs/scan-workflow.md` (already true) and reachable from `/scan --help` and `/scan` (new).

## Non-goals

- No adoption of an argparse library. Manual inspection of `process.argv.slice(2)` stays the convention.
- No mention of `/tune-filter` (issue #85) — not yet merged. The PR that merges it will add the pointer.
- No internationalization of `--help` output (stays in English, matching the rest of the CLI).
- No new `Next steps` footer on `/score`, `/explain`, or `/dashboard` output — their existing outputs are already fit-for-purpose; only `/scan` has the ambiguous `1/N` moment that needs a nudge.

## Deliverables

### L1 — `/scan` summary footer

**File:** `src/scan/index.mjs` (`formatSummary()`)

Append a `Next steps` block after the `Erreurs` section (if any). Always emit it, including when `result.added.length === 0` — that is precisely when `/explain` matters most. Do **not** emit the block when `--json` is active, to keep stdout strictly JSON-parseable.

Exact text:

```
Next steps :
  /score <url>        # évalue une offre via LLM (data/evaluations.jsonl)
  /explain "<title>"  # trace pourquoi une offre passe/échoue le filtre
  /dashboard          # régénère dashboard.html

Plus de flags : /scan --help  (--dry-run, --only <slug>, --json)
```

**File:** `.claude/commands/scan.md`

Remove the `## Next step` section (currently says only "run `/score <url>` on each"). The CLI footer becomes the single source of truth.

**Covers issue items:** 1, 5.

### L2 — `--help` on CLI entry points

**Files:** `src/scan/index.mjs`, `src/score/index.mjs`, `src/scan/explain.mjs`, `src/dashboard/build.mjs`

Add a local `printHelp()` function to each module. At the very top of `main()`, before `requireConfig()` or any I/O, intercept the flag:

```js
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }
  // ... existing body unchanged
}
```

This guarantees `/<cmd> --help` works without any config present — critical for first-time users who haven't run `/apply-onboard` yet.

If both `--help` and another flag are passed, `--help` wins (Unix convention).

**Template for each help block** — four fixed sections: Usage / Flags / Files / See also. Each block is emitted verbatim via `console.log(` a template string `)`.

**`/scan --help`:**

```
Usage: /scan [--dry-run] [--only <slug>] [--json]

Scan enabled ATS portals and append new offers to data/pipeline.md.

Flags:
  --dry-run         Compute everything, write nothing.
  --only <slug>     Scan a single company by ATS slug (e.g. mistral).
  --json            Emit machine-readable output to stdout.
  --help, -h        Show this help and exit.

Files:
  reads:  config/portals.yml, config/candidate-profile.yml
  writes: data/pipeline.md, data/scan-history.tsv, data/filtered-out.tsv

See also: /explain, /dashboard
          docs/scan-workflow.md  (title_filter format, per-company overrides)
```

**`/score --help`:**

```
Usage: /score <url> [--re-score]

LLM-evaluate a single offer URL against config/cv.md.

Flags:
  --re-score    Re-evaluate an offer already present in evaluations.jsonl.
  --help, -h    Show this help and exit.

Files:
  reads:  config/cv.md, config/candidate-profile.yml
  writes: data/evaluations.jsonl  (one JSON line per invocation)

See also: /explain, /dashboard
          docs/score-workflow.md
```

**`/explain --help`:**

```
Usage: /explain "<title>" [--company <name>] [--location <loc>]

Trace which prefilter rule accepts or rejects a given title.

Flags:
  --company <name>    Apply blacklist check against this company.
  --location <loc>    Apply location check against this string.
  --help, -h          Show this help and exit.

Files:
  reads:  config/portals.yml, config/candidate-profile.yml
  writes: (nothing)

Exit codes: 0 = ACCEPTED, 1 = REJECTED, 2 = usage error.

See also: /scan
          docs/scan-workflow.md#title-filter
```

**`/dashboard --help`:**

```
Usage: /dashboard

Regenerate dashboard.html from data/ and reports/.

Flags:
  --help, -h    Show this help and exit.

Files:
  reads:  data/pipeline.md, data/evaluations.jsonl, data/applications.md,
          data/apply-log.jsonl, reports/
  writes: dashboard.html  (at repo root)

See also: /scan, /score
```

**`/apply` — skill, not CLI.** Add to `.claude/commands/apply.md`, immediately after the frontmatter and before the first heading:

> **Si `$ARGUMENTS` commence par `--help` ou `-h`, imprime uniquement le bloc Usage ci-dessous et arrête-toi — n'ouvre pas Chrome, ne lis aucun autre fichier.**
>
> ```
> Usage: /apply <url>
>
> Open the URL in Chrome (CDP on port 9222), classify the form,
> fill from config/candidate-profile.yml, upload the CV, submit,
> and update data/applications.md + data/apply-log.jsonl.
>
> Stops and asks the user on: captcha, login wall, unknown required field.
>
> Prerequisites:
>   - chrome-apply alias launched (CDP port 9222 up)
>   - claude-in-chrome extension installed with host permissions
>
> Files:
>   reads:  config/candidate-profile.yml, config/cv.<lang>.pdf
>   writes: data/applications.md, data/apply-log.jsonl
>
> See also: /scan, /score, /dashboard
>           docs/apply-workflow.md, docs/cdp-setup.md
> ```

**Covers issue item:** 7.

### L3 — `title_filter` format documentation

**Status:** Already documented in `docs/scan-workflow.md` under `## Title filter`, including the per-company overrides `skip_required_any` and `target_locations`. No rewrite needed.

**Two additions only, to make it reachable:**

1. **`/scan --help` See also** — explicit pointer: `docs/scan-workflow.md (title_filter format, per-company overrides)`. (Already in L2.)
2. **`.claude/commands/scan.md`** — append one line to the `## Interpreting the output` section:

   > Pour comprendre en détail comment `title_filter` rejette une offre, voir [`docs/scan-workflow.md#title-filter`](../../docs/scan-workflow.md#title-filter) ou lance `/explain "<titre>"`.

**Covers issue item:** 3.

### L4 — Onboarding summary

**File:** `.claude/commands/apply-onboard/setup.md`

Three changes, preserving the existing six-step flow.

**Step 2 — print `setup.sh --help` once.** Before invoking `bash scripts/setup.sh --yes …`, run `bash scripts/setup.sh --help` and print its output, prefaced by one sentence:

> *"Voici les flags supportés par le script (affichés une fois pour que tu saches ce qui est disponible) — je vais maintenant lancer le setup avec les flags correspondant à ton choix clone-chrome-profile."*

Zero additional execution cost (help exits immediately).

**New step 5.5 — dry-run calibration.** Inserted after the user confirms extension permissions (end of step 5) and before the final summary (step 6). The dry-run does not require the extension — only the configs, which exist by this point.

```
Before printing the summary, run:

  node src/scan/index.mjs --dry-run --json

Parse the JSON to extract:
  - result.raw                              (total raw offers)
  - result.added.length                     (new hits after all filters)
  - result.perCompany.filter(c => c.newCount > 0)
      sorted desc by newCount, top 3        (top companies)
```

**Failure mode:** if the dry-run fails (network issue, ATS down, any non-zero exit), do **not** block onboarding. Skip the preview block in the summary and substitute:

> `(First scan preview skipped — network issue during dry-run; run /scan --dry-run when ready.)`

**Step 6 — rewritten summary:**

```
✅ Onboarding complete.

Files written:
  • config/cv.md
  • config/cv.<lang>.pdf
  • config/candidate-profile.yml
  • config/portals.yml  (N companies)

Your title_filter:
  required_any  : Intern, Internship, Stage, Stagiaire
  excluded_any  : Senior, Manager
  (source: config/portals.yml — edit there to re-tune,
   or run /explain "<title>" to debug one title)

First scan preview (dry-run):
  3 new offers after filter (from 2 359 raw).
  Top hits: mistral (1), anthropic (1), photoroom (1).
  → If 0 hits: your required_any is probably too strict.
    Run /explain "<one of your target titles>" to trace it,
    then edit config/portals.yml and re-run /scan.

Chrome launched in CDP mode (port 9222) with the
claude-in-chrome extension page open.

One last manual step:
  → Click "Add to Chrome" on the page that just opened,
    then confirm the install dialog.

Then you can run:
  /scan                # fetch new offers into data/pipeline.md
  /score <url>         # LLM-evaluate an offer
  /apply <url>         # automated form fill + submit
  /explain "<title>"   # debug why a title passes/fails the filter
  /dashboard           # regenerate dashboard.html

Tip: append --help to any command (e.g. /scan --help) to see its flags.
```

**Edge cases:**

- `portals.yml` without any `title_filter` → print `Your title_filter: (none — every title accepted)`. Unlikely in practice because `apply-onboard:companies` always writes a filter, but the fallback stays robust.
- Dry-run succeeds with `raw === 0` for every company → print `First scan preview (dry-run): 0 raw offers — likely an ATS outage or empty portals.yml. Run /scan after the extension install to retry.`

**Covers issue items:** 2, 4, 6.

## Testing

| Layer | Test |
|---|---|
| L1 `formatSummary` | Extend `tests/scan-format-summary.test.mjs`: assert `Next steps` block is present in the default path; assert absence in `--json` output. |
| L2 `--help` | One new test file per CLI: `tests/scan-help.test.mjs`, `tests/score-help.test.mjs`, `tests/explain-help.test.mjs`, `tests/dashboard-help.test.mjs`. Each spawns the node script with `--help` (e.g. via `node:child_process.spawnSync`), asserts `exitCode === 0` and that stdout contains `Usage:` and the command name. |
| L2 `/apply --help` | Not unit-testable (skill). Verified manually via `/apply --help` in a real session. |
| L3 | No test — pure Markdown. |
| L4 onboarding | No automated test (skill). Add one entry to `docs/testing.md` E2E checklist: "`/apply-onboard` final summary shows `Your title_filter` block and dry-run preview (or graceful fallback when network fails)." |

Every new test must run without any config present — that is the scenario where `--help` matters most.

## Migration

None. Every change is additive:

- `formatSummary` gains a trailing block; existing callers keep working.
- CLIs gain a `--help` branch; any invocation without `--help` is unchanged.
- `apply.md` gains a preamble block that is a no-op when `$ARGUMENTS` does not contain `--help`.
- `setup.md` gains one new step and rewrites the final summary block; the external contract of the skill (files written, Chrome launched, permissions granted) is unchanged.

No data-file migration, no config-file migration, no version bump.

## Coverage matrix

| Issue item | Deliverable |
|---|---|
| 1. End of `/scan` doesn't surface `/explain`/`/dashboard` | L1 |
| 2. `bash scripts/setup.sh --help` is never shown | L4 (step 2) |
| 3. `title_filter` format undocumented at slash-command level | L3 |
| 4. No post-onboarding recap | L4 (step 6 + step 5.5 dry-run) |
| 5. `--dry-run` and `--only` never surfaced | L1 |
| 6. `/explain` and `/dashboard` silent during onboarding | L4 (step 6) |
| 7. No `/scan --help` (or any `--help`) | L2 |
