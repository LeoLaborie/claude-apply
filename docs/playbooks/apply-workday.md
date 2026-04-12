# Workday apply playbook

This playbook is read by the agent when `/apply` detects a `*.myworkdayjobs.com` URL. It assumes that `apply.md` step 0 (tool loading, profile validation, CDP probe) has already been executed.

Follow this playbook **step by step**. At the slightest anomaly (captcha, unknown required field, submit error, unrecognized page), **STOP and ask the user** before continuing.

## 0. URL parsing and dedup

1. Import `parseWorkdayUrl` from `src/scan/ats/workday.mjs`.
2. Call `parseWorkdayUrl('$ARGUMENTS')` → `{ tenant, site, jobId }`.
3. If the parse returns `null` → STOP: "Invalid Workday URL. Expected format: `https://{tenant}.wd{N}.myworkdayjobs.com/{site}/job/{slug}/{jobId}`".
4. Check `data/applications.md`. If an entry already matches `$ARGUMENTS` with status `Applied`, `Submitted (unconfirmed)`, or `Failed`, ask the user before continuing.

## 1. Open tab, GIF, and blocker check

1. Open `$ARGUMENTS` in a new tab with `mcp__claude-in-chrome__tabs_create_mcp`.
2. Start GIF recording with `mcp__claude-in-chrome__gif_creator`. Name: `apply-workday-<tenant>-<YYYYMMDD-HHMM>.gif`.
3. Wait 2 seconds for JavaScript to load.
4. Call `read_page` to capture DOM + text.
5. **Blocker detection:** search the page for:
   - Closed offer: `no longer accepting`, `position filled`, `job expired` → status `Discarded`, log, stop.
   - Maintenance page: `maintenance`, `temporarily unavailable` → STOP, ask user.
   - 404 / error page → STOP, ask user.
6. **Pre-flight extension permission probe** (same as `apply.md` step 0.6): run `typeof document !== 'undefined' ? 'ok' : 'no document'` via `javascript_tool`. If permission error → STOP with the permission fix instructions.
