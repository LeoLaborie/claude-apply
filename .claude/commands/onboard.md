---
description: First-time setup — extract the user's CV, build config files, discover ~30 target companies, and run setup.sh non-interactively
argument-hint: [path-to-cv.pdf]
---

# /onboard $ARGUMENTS

You are guiding a **first-time user** through the end-to-end setup of `claude-apply`. Your job is to do the maximum for them: extract their CV, build the config files, find target companies, and run `setup.sh`. The user should only have to answer a small number of questions and approve the final company list.

**Hard rules for this flow** (these override any instinct to "just do it"):

- **Never invent PII.** Every field in `config/candidate-profile.yml` must come from the CV or from an explicit user answer. Leave it `null` if neither is available.
- **Never commit anything.** All files you write live under `config/` or `data/`, both gitignored. Do not `git add` or `git commit`.
- **Never skip approval of the company list.** Present it, wait for confirmation, then write `portals.yml`.
- **Stop on ambiguity.** If the CV is unreadable, the PDF path is wrong, WebSearch returns nothing useful, or a user answer is inconsistent — stop and ask.

## 0. Detect existing state

1. Check whether `config/candidate-profile.yml` already exists. If yes, ask the user: "An existing profile was found. Do you want to (a) **abort** and keep it, (b) **rerun onboarding and overwrite** it, or (c) **only regenerate portals.yml**?" Act accordingly.
2. Check whether `node_modules/` exists (`setup.sh` in step 4 will skip the install if present).
3. Check whether the `chrome-apply` alias is already in `~/.zshrc` or `~/.bashrc` (`setup.sh` in step 4 will skip the rc append if present).

## 1. Ask for the CV

If `$ARGUMENTS` is a path to a PDF file that exists, use it. Otherwise, ask the user:

> "Please provide the absolute path to your CV PDF (or drop the file in the conversation). I'll extract everything I can from it."

Once you have the path:

1. Verify the file exists and is a PDF (`file <path>` via Bash, or check the extension + first bytes).
2. Read it with the `Read` tool (Claude Code reads PDFs natively).
3. Extract as much as possible:
   - **Identity**: first name, last name, email, phone, LinkedIn URL, GitHub URL, personal website.
   - **Address**: city (country only if explicit on the CV).
   - **Education**: each entry with school, degree, field, start, end, graduation year, 1-line description.
   - **Experiences**: each entry with company, title, start, end, description (keep 3–5 lines max per entry).
   - **Languages**: list with `{code, level}` — levels in CEFR (A1…C2) or `native`.
4. If any of these are genuinely missing from the CV, mark them for the question block in step 3.

## 2. Write `config/cv.md`

Create `config/cv.md` as a clean markdown version of the CV. This file is read by `/score` and the cover-letter generator — it should be faithful to the PDF but flow as markdown (no tables, use headers `##` for sections). Do not paraphrase or embellish.

Copy the PDF itself to `config/cv.<lang>.pdf` (detect language from the CV content — usually `fr` or `en`). Use this path in `candidate-profile.yml`.

## 3. Ask everything missing — in ONE block

Use **`AskUserQuestion`** once with all the fields you could not extract, grouped logically. Typical questions:

**Job search**

- **Job type**: internship / apprenticeship / entry-level / mid-level / senior / other
- **Target start date**: (ISO date)
- **Duration** (if internship/apprenticeship): months
- **Target role / domain keywords**: free text — this drives both `title_filter` (step 5) and company discovery (step 6). Example: "AI/ML engineering", "backend Python", "devtools", "data engineering".

**Location & remote**

- **Locations**: cities or regions, comma-separated
- **Remote preference**: onsite / hybrid / remote

**Admin**

- **Date of birth**: (some forms require it; may skip if user refuses)
- **Nationality**
- **Work authorization**: free text (e.g. "EU citizen — no sponsorship needed")
- **Requires visa sponsorship**: yes / no

**Setup choices**

- **Clone your existing Chrome profile** into the dedicated CDP profile (cookies, extensions)? yes / no
- **Cover letter auto-generation**: enable now? yes / no (default no)

Leave anything the user declines to answer as `null`. Do **not** loop back with follow-up questions unless the user's answer is internally inconsistent (e.g. "internship" + "senior level").

## 4. Run `setup.sh` with the right flags

**This step must happen before profile validation and company verification** — both rely on `node_modules` (for `js-yaml` in the profile schema, and for `node src/scan/index.mjs`). Running `setup.sh` here also sets up the Chrome CDP profile and shell alias while we already have the user's answers from step 3.

Based on the user's Chrome-profile clone answer, run one of:

```bash
bash scripts/setup.sh --yes --clone-chrome-profile       # if user said yes
bash scripts/setup.sh --yes --no-clone-chrome-profile    # if user said no
```

This will: install npm deps if missing (`npm ci` / `npm install`), create the CDP profile (empty or cloned), append the `chrome-apply` alias to the user's shell rc (timestamped backup), and copy any missing templates into `config/` (harmless — you will overwrite `candidate-profile.yml` and `portals.yml` in the next steps; `cv.md` already exists from step 2 so it is skipped).

If the user is in an unusual shell setup, add `--no-rc` and print the alias to them manually.

## 5. Build `config/candidate-profile.yml`

Assemble the YAML file from:

- Fields extracted from the CV (step 1)
- Answers from the question block (step 3)
- Defaults for genuinely optional fields (`salary_expectation: null`, `website: null`, `cover_letter.generate: false` unless the user said yes)

Validate the file by importing `validateProfile` from `src/apply/candidate-profile.schema.mjs` and running it on the parsed YAML. If `ok: false`, show the errors to the user, ask the missing/invalid fields, and retry — do not write an invalid profile.

Also build **`title_filter`** for `portals.yml` from the job type answer. The scanner expects three keys — `positive` (title must contain at least one), `negative` (title must not contain any), and the optional `required_any` (secondary filter, applied on top):

| Job type       | `positive` keywords                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------- |
| internship     | `Intern`, `Interns`, `Internship`, `Internships`, `Stage`, `Stages`, `Stagiaire`, `Stagiaires` |
| apprenticeship | `Apprentice`, `Apprenticeship`, `Alternance`, `Alternant`, `Alternante`                        |
| entry-level    | `Junior`, `Entry`, `Graduate`, `New Grad`                                                      |
| mid-level      | (leave empty — let the domain drive the filter via `required_any`)                             |
| senior         | `Senior`, `Staff`, `Principal`, `Lead`                                                         |

If the user gave specific role/domain keywords in step 3 (e.g. "Machine Learning", "Backend"), put them in `required_any` so offers must match both the job type _and_ the domain. Keep `negative: []` unless the user explicitly ruled something out (e.g. senior user excluding `Intern`).

## 6. Discover ~30 target companies

This is the most fragile step. Read it twice before starting.

**Constraint**: `src/scan/` only supports **Lever**, **Greenhouse**, and **Ashby** as of v0.1. Every company you add to `portals.yml` must have a `careers_url` matching one of these hosts:

- `https://jobs.lever.co/<slug>`
- `https://boards.greenhouse.io/<slug>` or `https://job-boards.greenhouse.io/<slug>`
- `https://jobs.ashbyhq.com/<slug>`

### 5.1 Build a candidate list via WebSearch

Use the `WebSearch` tool (load it via `ToolSearch` if not already loaded). Run queries targeted at the user's domain + locations, crossed with the ATS host:

```
site:jobs.lever.co "<domain keyword>" <location>
site:boards.greenhouse.io "<domain keyword>" <location>
site:jobs.ashbyhq.com "<domain keyword>" <location>
```

Run **at least 6 queries** (2 per ATS, varying the keyword/location). Collect unique `{company, careers_url}` pairs from the results. Target ~50 candidates at this stage to leave room for verification dropouts.

If the domain is very niche and WebSearch returns fewer than 15 candidates total, ask the user for hints ("Any companies you already have in mind?") and add them.

### 5.2 Verify each URL

For each candidate, verify the careers URL actually returns offers via the public ATS API. Use `curl -sfI` for a quick HEAD check, then trust `src/scan/ats-detect.mjs` behavior. You may run a dry-run scan on a single company:

```bash
# Write a minimal temp portals.yml with one company and run:
node src/scan/index.mjs --dry-run --only <slug>
```

Drop any candidate where:

- The URL 404s or 301s to a non-ATS host
- The company has zero current offers matching `title_filter` (not a hard drop — keep if at least 3 total offers exist on the board, the filter may match next week)
- The company is a clear duplicate (same org, multiple slugs)

### 5.3 Trim to ~30 and present for approval

Keep the top ~30 by relevance to the user's domain (your judgement). Present them as a compact table to the user:

```
Company           ATS          Careers URL
──────────────────────────────────────────────
Mistral AI        lever        https://jobs.lever.co/mistral
Anthropic         lever        https://jobs.lever.co/Anthropic
...
```

Then ask: **"Here are 30 companies I found. Should I write them to `config/portals.yml`, or do you want me to remove/add any?"**

Apply the user's edits (remove X, add Y with URL Z, etc.) and loop until they approve. Only then write `config/portals.yml` with:

- `tracked_companies:` — the approved list, each entry `{ name, careers_url, enabled: true }`
- `title_filter:` — built in step 5 (`positive`, `negative`, optional `required_any`)

## 7. Launch Chrome and finalize

You can automate almost everything that's left. The user should only have to click "Add to Chrome" on the extension page (the Chrome Web Store does not expose a programmatic install API).

### 7.1 Check if CDP is already up

Probe the debug port:

```bash
curl -sf http://127.0.0.1:9222/json/version
```

- **If it responds with JSON**: Chrome is already running in CDP mode (user launched `chrome-apply` before). Skip to 7.3.
- **Otherwise**: proceed to 7.2.

### 7.2 Launch Chrome in background

You do **not** need `source ~/.bashrc` — the `chrome-apply` alias is a convenience for the user's terminal. You can invoke the real command directly. Detect the Chrome binary and CDP profile path (same logic as `scripts/setup.sh`):

- **Linux**: binary = first of `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`; profile = `$HOME/.config/google-chrome-claude-apply`.
- **macOS**: binary = `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; profile = `$HOME/Library/Application Support/Google/Chrome-claude-apply`.

Launch Chrome with the CDP flag and open the extension page directly. **Use `run_in_background: true`** on the Bash tool — Chrome is a long-running GUI process and you must not block on it:

```bash
"<chrome_bin>" \
  --user-data-dir="<cdp_profile>" \
  --remote-debugging-port=9222 \
  "https://chromewebstore.google.com/search/claude-in-chrome"
```

Then poll the CDP port for up to 8 seconds (4 probes of 2s), waiting for it to come up:

```bash
for i in 1 2 3 4; do
  sleep 2
  if curl -sf http://127.0.0.1:9222/json/version > /dev/null; then
    echo "CDP up after ${i} probes"
    exit 0
  fi
done
exit 1
```

- **If CDP comes up**: great, continue to 7.3.
- **If not** (8s elapsed): Chrome may have failed to start. Check the background task output for errors. Fall back to telling the user to run `chrome-apply` manually and print the summary from 7.3 anyway.

### 7.3 Final summary

Print a clean summary. The only manual step left is clicking "Add to Chrome" on the extension page that should now be open:

```
✅ Onboarding complete.

Files written:
  • config/cv.md
  • config/cv.<lang>.pdf
  • config/candidate-profile.yml
  • config/portals.yml  (30 companies)

Chrome launched in CDP mode (port 9222) with the claude-in-chrome
extension page open.

One last manual step:
  → Click "Add to Chrome" on the page that just opened,
    then confirm the install dialog.

Then you can run:
  /scan                # fetch new offers into data/pipeline.md
  /score <url>         # LLM-evaluate an offer
  /apply <url>         # automated form fill + submit
```

**Do not run `/scan` or `/apply` yourself** — the user still needs to install the extension manually. Your onboarding stops here.

## Absolute rules (recap)

- **One question block** — never pepper the user with follow-ups.
- **Approve before writing `portals.yml`** — always.
- **Validate the profile** before writing it — never write an invalid YAML.
- **Never guess PII** — `null` is always a valid answer.
- **Never `git commit`** — `config/` and `data/` are gitignored on purpose.
- **Stop on ambiguity** — login wall on an ATS URL during verification, unreadable PDF, contradictory answers → stop and ask.
