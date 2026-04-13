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

Run one of:

```bash
bash scripts/setup.sh --yes --clone-chrome-profile       # if user said yes
bash scripts/setup.sh --yes --no-clone-chrome-profile    # if user said no
```

This will: install npm deps if missing (`npm ci` / `npm install`), create the CDP Chrome profile (empty or cloned), append the `chrome-apply` alias to the user's shell rc (with a timestamped backup), and copy any missing templates into `config/` (harmless — `cv.md`, `candidate-profile.yml`, and `portals.yml` already exist from the earlier phases and are skipped).

If the user is in an unusual shell setup, add `--no-rc` and print the alias to them manually. Run `bash scripts/setup.sh --help` for all flags.

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

## 6. Final summary

Print a clean summary:

```
✅ Onboarding complete.

Files written:
  • config/cv.md
  • config/cv.<lang>.pdf
  • config/candidate-profile.yml
  • config/portals.yml  (N companies)

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
