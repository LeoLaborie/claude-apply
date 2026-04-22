---
description: Onboarding phase 3 — run scripts/setup.sh, launch Chrome in CDP mode, and guide the user through the extension install and host permissions
---

# /apply-onboard:setup

You are running **phase 3 of onboarding**: finalize the environment. At the end, `node_modules/` is installed, the CDP Chrome profile exists, the `chrome-apply` alias is in the user's shell rc, Chrome is running on port 9222, and the user has been told exactly which hosts to grant to the `claude-in-chrome` extension.

**Hard rules**

- **Do not run `/scan` or `/apply`** yourself at the end — the user still needs to install the extension manually.
- **Do not proceed past the extension instructions** until the user confirms the permissions are granted.
- **Use `run_in_background: true`** when launching Chrome. Chrome is a long-running GUI process and must not block the tool call.

This skill is safe to rerun — `setup.sh` is idempotent.

## 1. Load the clone-profile answer

Read `data/.onboard-state.json` (written by `/apply-onboard:profile`) to get `clone_chrome_profile`. If the file is missing or the field is absent, ask the user once:

> "Clone your existing Chrome profile (cookies, extensions) into the dedicated CDP profile? yes / no"

## 2. Run `scripts/setup.sh`

(The `--clone-chrome-profile` flag below uses the answer the user gave in phase 1. "yes" copies cookies/sessions/extensions from their current Chrome profile — they stay logged in to ATSes. "no" starts from scratch.)

**First, print the script's usage once** so the user discovers flags like `--no-clone-chrome-profile` and `--no-rc`:

    bash scripts/setup.sh --help

Print the captured output verbatim, prefaced by one short line:

> "Voici les flags supportés par le script (affichés une fois pour que tu saches ce qui est disponible) — je vais maintenant lancer le setup avec les flags correspondant à ton choix clone-chrome-profile."

Then run one of:

    bash scripts/setup.sh --yes --clone-chrome-profile       # if user said yes
    bash scripts/setup.sh --yes --no-clone-chrome-profile    # if user said no

This will: install npm deps if missing (`npm ci` / `npm install`), create the CDP Chrome profile (empty or cloned), append the `chrome-apply` alias to the user's shell rc (with a timestamped backup), and copy any missing templates into `config/` (harmless — `cv.md`, `candidate-profile.yml`, and `portals.yml` already exist from the earlier phases and are skipped).

If the user is in an unusual shell setup, add `--no-rc` and print the alias to them manually.

## 3. Check if CDP is already up

Probe the debug port:

```bash
curl -sf http://127.0.0.1:9222/json/version
```

- **Responds with JSON** → Chrome is already in CDP mode (user launched `chrome-apply` before). Skip to step 5.
- **No response** → continue to step 4.

## 4. Launch Chrome in CDP mode (background)

You do **not** need `source ~/.bashrc`. Detect the Chrome binary and profile path the same way `scripts/setup.sh` does:

- **Linux**: binary = first of `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`; profile = `$HOME/.config/google-chrome-claude-apply`.
- **macOS**: binary = `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`; profile = `$HOME/Library/Application Support/Google/Chrome-claude-apply`.

Launch Chrome with the CDP flag and open the extension page directly. **Use `run_in_background: true`**:

```bash
"<chrome_bin>" \
  --user-data-dir="<cdp_profile>" \
  --remote-debugging-port=9222 \
  "https://chromewebstore.google.com/search/claude-in-chrome"
```

Poll the CDP port for up to 8 seconds (4 probes × 2 s):

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

- **CDP up** → continue to step 5.
- **Not up after 8 s** → inspect the background task output, tell the user to run `chrome-apply` manually, and still print the summary from step 6.

## 5. Print the extension permission instructions

The `claude-in-chrome` extension needs per-host permission for every ATS domain. Chrome does **not** expose a programmatic grant — the user must click. Without this, `/apply` fails on the first `find` call with _"Extension manifest must request permission to access the respective host"_.

Derive the list from the single source of truth — do not hard-code it:

```bash
node -e "
  import('./src/scan/ats-detect.mjs').then(m => {
    for (const h of m.getSupportedHosts()) console.log('  - ' + h);
  });
"
```

Print this exact instruction block, substituting the host list:

```
After you click "Add to Chrome" and approve the install:

  1. Click the puzzle-piece icon in Chrome's toolbar.
  2. Find "claude-in-chrome" → three-dot menu → "This can read and
     change site data" → "On specific sites".
  3. Add each of these hosts (one by one):
       <host list from getSupportedHosts() above>
  4. If prompted during install, also allow
     https://chromewebstore.google.com/*.
```

**Wait for the user to confirm permissions are granted** before continuing.

### 5a. Verify host permissions via a minimal probe

After the user confirms, run a one-shot probe against a representative ATS host. This catches the common case where the user installed the extension but forgot to grant host permissions — which otherwise fails only on the first `/apply` call.

1. Load the MCP tools if not yet available:

   ```
   ToolSearch query: select:mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__find
   ```

2. Navigate to the probe host and run a benign `find`:

   ```
   mcp__claude-in-chrome__navigate(url: "https://jobs.lever.co/anthropic")
   mcp__claude-in-chrome__find(selector: "body")
   ```

3. Feed the results into the probe interpreter:

   ```bash
   node -e "
     import('./src/lib/extension-permission-probe.mjs').then(m => {
       const r = m.interpretProbeResult({
         navigateResult: <paste JSON result of navigate, or null>,
         findResult: <paste JSON result of find, or null>,
         findError: <paste error message if find threw, or null>,
         navigateError: <paste error message if navigate threw, or null>,
       });
       console.log(JSON.stringify(r));
     });
   "
   ```

4. Based on `{ok, reason}`:
   - `{ok: true}` → print: `✓ Permissions OK — extension can read ATS hosts.`
   - `{ok: false, reason: 'missing_permission'}` → print:
     ```
     ✗ Missing host permission.
       Reopen the extension menu and re-check the host list shown above.
       Then rerun /apply-onboard:setup step 5 only.
     ```
   - `{ok: false, reason: 'extension_not_installed'}` → print:
     ```
     ✗ Extension not detected.
       Did you complete the "Add to Chrome" install? Retry step 5.
     ```
   - `{ok: false, reason: 'navigation_failed' | 'timeout' | 'unknown'}` → print:
     ```
     ⚠ Could not reach the probe host (reason: <reason>).
       Skipping verification — test with /apply when ready.
     ```

This probe is **non-blocking**: print the final summary (step 6) regardless of the probe result. The user can always rerun setup step 5 later if needed.

## 5.5. Calibration dry-run (best-effort)

Before printing the final summary, run a `/scan --dry-run --json` to give the user a realistic preview of what their first real scan will yield. The extension is not required for this step.

```bash
node src/scan/index.mjs --dry-run --json
```

Parse the JSON to extract:

- `result.raw` — total raw offers across all companies
- `result.added.length` — number of offers that would survive all filters
- `result.perCompany.filter(c => c.newCount > 0)` — companies with at least one hit, sorted descending by `newCount`, top 3

Cache these three values (or a single "skipped" flag on failure) so step 6 can reference them.

**Failure mode (network error, ATS outage, any non-zero exit):** do **not** block onboarding. Set an internal "dry-run skipped" flag and let step 6 fall back to the "skipped" message. The user will still have a working install.

## 6. Final summary

Read `config/portals.yml` once to extract `title_filter.required_any` and `title_filter.excluded_any`. Use the dry-run values cached in step 5.5 (or the "skipped" flag).

Print the following summary, substituting values where marked:

```
✅ Onboarding complete.

Files written:
  • config/cv.md
  • config/cv.<lang>.pdf
  • config/candidate-profile.yml
  • config/portals.yml  (<N> companies)

Your title_filter:
  required_any  : <comma-separated list from portals.yml, or "(none)">
  excluded_any  : <comma-separated list from portals.yml, or "(none)">
  (source: config/portals.yml — edit there to re-tune,
   or run /explain "<title>" to debug one title)

First scan preview (dry-run):
  <A> new offers after filter (from <R> raw).
  Top hits: <company1> (<n1>), <company2> (<n2>), <company3> (<n3>).
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

**Fallback when step 5.5 was skipped:** replace the "First scan preview" block with exactly:

```
First scan preview (dry-run):
  (skipped — network issue during dry-run; run /scan --dry-run when ready.)
```

**Fallback when `raw === 0` across all companies** (likely ATS outage or empty `portals.yml`): replace the block with:

```
First scan preview (dry-run):
  0 raw offers — likely an ATS outage or an empty portals.yml.
  Run /scan after the extension install to retry.
```

**Fallback when `title_filter` is absent from `portals.yml`:** print `(none — every title accepted)` for both `required_any` and `excluded_any`.

**Do not run `/scan` or `/apply` yourself** — the user still needs to install the extension manually. Your onboarding stops here.
