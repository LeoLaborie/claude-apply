---
description: Trace which prefilter rule accepts or rejects a given job title
argument-hint: "<title>" [--company <name>] [--location <loc>]
---

# /explain $ARGUMENTS

Run the prefilter trace against a single title so you can see _why_ a given job is accepted or rejected by `portals.yml.title_filter`, the blacklist, the location check, and the start-date check.

## First-run guard

Before running, check that both `config/portals.yml` and `config/candidate-profile.yml` exist. If either is missing, **stop** and tell the user:

> "No config found. Run `/apply-onboard` first — it will extract your CV, build the configs, and find ~30 target companies for you."

Do not try to explain against the example templates.

## Run

```bash
node src/scan/explain.mjs $ARGUMENTS
```

## Flags

- `--company <name>` — apply blacklist check against this company name.
- `--location <loc>` — apply location check against this string (matched against `target_locations` in your profile).

## Output

A per-step trace:

```
Title:   ML Engineer Intern
Company: (none)

✓ title
✓ blacklist
✓ location

ACCEPTED
```

Each step prints `✓` (pass) or `✗ <reason>` (fail). The command exits `0` on ACCEPTED, `1` on REJECTED, `2` on a usage error.

## Typical uses

- "Why did my scan reject this title?" → run `/explain "<the title>"` against your current `portals.yml`.
- "Would an offer in Tokyo pass?" → `/explain "ML Engineer" --location Tokyo`.
