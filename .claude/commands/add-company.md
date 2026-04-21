---
description: Discover and append a new company to config/portals.yml (no hand-editing YAML)
argument-hint: '<name or URL>'
---

# /add-company $ARGUMENTS

Add a company to `config/portals.yml` by name or by ATS careers URL, without editing YAML by hand.

## First-run guard

Before anything, check that `config/candidate-profile.yml` **and** `config/portals.yml` exist. If either is missing, stop and tell the user:

> "No config found. Run `/apply-onboard` first — it will extract your CV, build the configs, and find ~30 target companies for you."

## Step 1 — dry-run (discover & verify)

Run:

```bash
node src/scan/add-company.mjs --input "$ARGUMENTS" --dry-run --json
```

Parse the JSON output and branch on `status`:

| status                 | What to tell the user                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ok`                   | Show `platform / slug (careersUrl) — N offers`. If `warning: "empty board"`, ask explicitly: "Board is live but 0 offers — add anyway?" Otherwise: "Confirm name and add? [Yes / Edit name / Edit URL / No]" |
| `duplicate`            | "Already in portals.yml: `<duplicateOf.name>` (enabled: true). Nothing to do."                                                                                                                               |
| `disabled-duplicate`   | "Found existing entry `<duplicateOf.name>` with enabled: false. Enable it? [Yes / No]"                                                                                                                       |
| `unknown-host`         | "Host not recognized. Supported: `<supportedHosts joined>`. Open an issue to add this ATS."                                                                                                                  |
| `unsupported-platform` | If `knownHost` is `workable`, say: "Workable is not yet supported — see issue #83." Otherwise generic.                                                                                                       |
| `not-found`            | For URL form: "Slug 404 or empty. Double-check the URL." For name form: "No slug matched (tried N candidates). Try `/add-company <url>` with the full URL."                                                  |
| `no-portals`           | "No portals config. Run `/apply-onboard` first."                                                                                                                                                             |

## Step 2 — confirm & write

Once the user confirms, run:

```bash
node src/scan/add-company.mjs --input "$ARGUMENTS" --name "<final-name>" --yes --json
```

- Use the name the user confirmed (which may differ from `suggestedName`).
- If the user chose "Edit URL" in step 1, re-run step 1 with the new URL instead.
- For the `disabled-duplicate` → "Yes" branch, run step 2 **without** `--name`; the script detects the toggle from the existing entry.

Report back based on the returned `status`:

- `written` → "Added `<entry.name>` — entry `<entryIndex+1>` of `<total>`."
- `toggled` → "Enabled `<name>` in portals.yml."

## Safety rules

- **Never write without explicit user confirmation in the conversation.** Step 1 is always dry-run.
- If the script returns a non-zero exit code, surface stderr and stop — do not retry blindly.
- Never edit `config/portals.yml` yourself; the script is the only writer.
