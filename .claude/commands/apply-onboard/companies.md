---
description: Onboarding phase 2 — discover ~30 target companies via WebSearch, verify their ATS boards, get user approval, and write config/portals.yml
---

# /apply-onboard:companies

You are running **phase 2 of onboarding**: build `config/portals.yml`. At the end, the file contains ~30 verified companies (`tracked_companies`) plus the `title_filter` derived from the user's job-type and domain answers.

**Hard rules**

- **Never write `portals.yml` without a passing `assertPortalsApproved` gate.** Approval is recorded in `data/.onboard-state.json` by `markPortalsApproved` after the user answers `AskUserQuestion`. The gate rejects any list that differs from the approved one (see `src/lib/onboard-state.mjs`).
- **Only keep companies whose ATS board is live** — verified via `verifyCompany`, not via `curl -I` on the careers HTML.
- **Stop on ambiguity.** WebSearch returns nothing useful, the user's domain keywords are unclear, a slug redirects to a login wall → stop and ask.

This skill assumes `config/candidate-profile.yml` already exists (written by `/apply-onboard:profile`). If not, tell the user to run `/apply-onboard:profile` first.

## 1. Load inputs

Read `data/.onboard-state.json` (written by `/apply-onboard:profile`) to get `job_type`, `target_role`, `locations`. If the file is missing — the user is running this skill standalone — ask once for these three fields via `AskUserQuestion`.

## 2. Build `title_filter`

The scanner expects three keys — `positive` (title must contain at least one), `negative` (title must not contain any), and optional `required_any` (secondary filter on top).

| Job type       | `positive` keywords                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------- |
| internship     | `Intern`, `Interns`, `Internship`, `Internships`, `Stage`, `Stages`, `Stagiaire`, `Stagiaires` |
| apprenticeship | `Apprentice`, `Apprenticeship`, `Alternance`, `Alternant`, `Alternante`                        |
| entry-level    | `Junior`, `Entry`, `Graduate`, `New Grad`                                                      |
| mid-level      | (leave empty — let the domain drive the filter via `required_any`)                             |
| senior         | `Senior`, `Staff`, `Principal`, `Lead`                                                         |

Put domain keywords from `target_role` into `required_any` so offers must match both the job type _and_ the domain. Keep `negative: []` unless the user explicitly ruled something out.

## 3. Discover candidates via WebSearch

`src/scan/` supports **Lever**, **Greenhouse**, **Ashby**, and **Workday**. Every `careers_url` must match one of these hosts:

- `https://jobs.lever.co/<slug>`
- `https://boards.greenhouse.io/<slug>` or `https://job-boards.greenhouse.io/<slug>`
- `https://jobs.ashbyhq.com/<slug>`
- `https://<tenant>.wd<N>.myworkdayjobs.com/<slug>`

Use the `WebSearch` tool (load it via `ToolSearch` if not yet available). Run queries crossing the user's domain + locations with each ATS host:

```
site:jobs.lever.co "<domain keyword>" <location>
site:boards.greenhouse.io "<domain keyword>" <location>
site:jobs.ashbyhq.com "<domain keyword>" <location>
site:myworkdayjobs.com "<domain keyword>" <location>
```

Run **at least 8 queries** (2 per ATS, varying the keyword/location). Collect unique `{company, careers_url}` pairs. Target ~50 candidates at this stage to leave room for verification dropouts.

If WebSearch returns fewer than 15 candidates total, ask the user for hints ("Any companies you already have in mind?") and add them.

## 4. Workday slug registry lookup

For candidates that are likely Workday tenants (large corporates not on Lever/Greenhouse/Ashby), check the local registry before giving up:

```bash
node -e "
  import { loadSlugRegistry, lookupWorkdaySlug } from './src/scan/ats/workday-slugs.mjs';
  const reg = loadSlugRegistry('data/known-workday-slugs.json');
  const r = lookupWorkdaySlug(reg, 'Airbus');
  if (r) console.log('https://' + r.tenant + '.' + r.pod + '.myworkdayjobs.com/' + r.slug);
  else console.log('NOT_FOUND');
"
```

If the registry file does not exist (`data/known-workday-slugs.json`), skip this step silently.

## 5. Verify each URL via the ATS API

`curl -sfI` on the public careers page is **not** authoritative — Ashby for example returns `200` on the careers HTML even when the JSON board does not exist (e.g. `dust-tt`). Call the same JSON endpoint `/scan` will use, via `verifyCompany` from `src/scan/ats-detect.mjs`:

```bash
node -e "
  import('./src/scan/ats-detect.mjs').then(async m => {
    const r = await m.verifyCompany('https://jobs.lever.co/mistral');
    console.log(JSON.stringify(r));
  });
"
```

Response shape:

- `{ ok: true, count: N }` → slug is live. Keep the company. If `count` is 0, flag it for sanity-check.
- `{ ok: false, status, reason }` → drop. On transient failures (5xx, network error), retry **once** after a 2 s backoff before dropping.

Add a 100 ms delay between verifications to be polite to the APIs.

### 5b. Smart slug discovery when the careers URL is unknown

If you only have a company **name** (no URL, or your guessed URL 404s), use `discoverCompany` from `src/scan/discover-company.mjs`. It walks platform-specific slug variations (`x`, `x-ai`, `xhq`, `xlabs`, `x-labs`, …) across Lever → Greenhouse → Ashby → Workday registry and returns the first hit. Successful resolutions are cached in `data/known-ats-slugs.json` so the next run is instant.

```bash
node -e "
  import('./src/scan/discover-company.mjs').then(async m => {
    const r = await m.discoverCompany('Doctolib', {
      cachePath: 'data/known-ats-slugs.json',
      workdayRegistryPath: 'data/known-workday-slugs.json',
    });
    console.log(JSON.stringify(r));
  });
"
```

Use this whenever your naive guess returns `ok: false` before dropping the candidate — many companies (Doctolib, Cohere, Modal, Scale AI, Writer, OpenAI, …) live on a different ATS or under a non-obvious slug.

Drop any candidate that is a clear duplicate (same org, multiple slugs).

## 6. Trim to ~30 and get approval (technical gate)

Keep the top ~30 by relevance to the user's domain. Present a compact table:

```
Company           ATS          Careers URL
──────────────────────────────────────────────
Mistral AI        lever        https://jobs.lever.co/mistral
Anthropic         lever        https://jobs.lever.co/Anthropic
...
```

### 6a. MANDATORY approval question

You **MUST** call `AskUserQuestion` with exactly these options before writing anything:

- `"Approve and write"`
- `"Let me edit the list"`
- `"Cancel"`

This is the only path to writing `config/portals.yml`. Skipping this call and jumping straight to `Write config/portals.yml` is a hard-rule violation — the gate in step 6c will refuse the write anyway.

On `"Let me edit the list"`: apply the user's edits (remove X, add Y with URL Z, re-verify Y via step 5), re-present the table, and loop back to 6a with the updated list.

On `"Cancel"`: stop and report that no file was written.

### 6b. Record approval

Immediately after the user answers `"Approve and write"`, persist the approved list to a scratch JSON file and call `markPortalsApproved`:

```bash
cat > /tmp/approved-portals.json <<'JSON'
[
  {"name":"Mistral AI","careers_url":"https://jobs.lever.co/mistral"},
  {"name":"Anthropic","careers_url":"https://jobs.lever.co/Anthropic"}
]
JSON

node -e "
  import('./src/lib/onboard-state.mjs').then(async (m) => {
    const fs = await import('node:fs');
    const list = JSON.parse(fs.readFileSync('/tmp/approved-portals.json', 'utf8'));
    m.markPortalsApproved('data/.onboard-state.json', list);
    console.log('approved', list.length);
  });
"
```

The heredoc must contain the **exact** list shown to the user — same names, same URLs. Order does not matter (the hash is order-insensitive), but any other drift will re-lock the gate.

### 6c. Gate check before writing

Immediately before calling `Write config/portals.yml`, run the gate against the same list:

```bash
node -e "
  import('./src/lib/onboard-state.mjs').then(async (m) => {
    const fs = await import('node:fs');
    const list = JSON.parse(fs.readFileSync('/tmp/approved-portals.json', 'utf8'));
    m.assertPortalsApproved('data/.onboard-state.json', list);
    console.log('gate ok');
  });
"
```

- If this prints `gate ok`, proceed to `Write config/portals.yml` using the same list (add `enabled: true` on each entry) and the `title_filter` built in step 2.
- If it throws `PortalsNotApprovedError` with `reason: 'missing'` → you never called `markPortalsApproved`. Go back to 6a.
- If it throws `PortalsNotApprovedError` with `reason: 'hash_mismatch'` → the list you are about to write is not the one the user approved. Do **not** fix by re-running `markPortalsApproved` on the mutated list. Go back to 6a and re-present what you actually want to write.

Write `config/portals.yml`:

- `tracked_companies:` — the approved list, each entry `{ name, careers_url, enabled: true }`
- `title_filter:` — built in step 2 (`positive`, `negative`, optional `required_any`)

Finally, delete the scratch file:

```bash
rm -f /tmp/approved-portals.json
```

## 7. Done

Report briefly: `config/portals.yml` written with N companies and the computed title_filter. If called from the `/apply-onboard` orchestrator, control returns there. Otherwise tell the user to run `/apply-onboard:setup` next.
