# Supported ATS platforms

| Platform             | Scan (API)     | Form fill | CDP upload | Known issues / notes                                              |
| -------------------- | -------------- | --------- | ---------- | ----------------------------------------------------------------- |
| **Lever**            | ✅ supported    | ✅        | ✅         | Blocks re-submission for ~3 months (returns `/already-received`). |
| **Greenhouse**       | ✅ supported    | ✅        | ✅         | Splits name into `first_name` / `last_name`. Many optional EEO/subforms hidden behind `+ Add`. |
| **Ashby**            | ✅ supported    | ✅        | ✅         | Field names use `_systemfield_*`. Custom questions map to `free_text`. |
| **Welcome to the Jungle** | ⚠️ aggregator | ✅        | ✅         | Not an ATS — the apply button jumps to the real ATS (Lever, GH, Workable, Teamtailor…). The playbook follows the redirect automatically. Confirmation often silent — use the WTTJ application tracker as fallback. |
| **Workable**         | ❌ no scan      | ✅        | ✅         | Public API requires authentication. Form filling works once the URL is known. |
| **Teamtailor**       | ❌ no scan      | ⚠️ partial | ✅        | Custom React form; most standard fields classify correctly, but add-on questions may need manual intervention. |
| **SmartRecruiters**  | ❌ no scan      | ⚠️ partial | ✅        | Similar to Teamtailor. |
| **Custom career page** | ❌            | ❌        | ❌         | Not supported. Manual fallback or contribute an ATS fetcher (see [`extending.md`](extending.md)). |

## Gotchas worth knowing

### Lever

- **Duplicate detection**: submitting the same offer twice returns a page containing `"Your application was already submitted"` or `"Application already received"`. The confirmation detector treats this as `Applied`, not `Failed`.
- **Location autocomplete**: Lever's `#location-input` is a Google Places autocomplete. Programmatic `dispatchEvent('input')` does **not** call the Places API, so the field stays "invalid" server-side even if `.value` looks right. Use physical keyboard input via `mcp__claude-in-chrome__computer` to type into the field and hit `Enter`.
- **File upload "Success!" trap**: injecting a `DataTransfer` via JS does show "Success! cv.pdf" in the UI, but the backend silently drops the file and rejects the submit with `"Please attach a resume"`. **Always use the CDP helper.**

### Greenhouse

- **Long forms, many optional sections**: education, employment, website URLs, EEO all live behind `+ Add` buttons. The classifier lists them; the playbook expands them before scanning.

### Ashby

- **`_systemfield_*` naming**: field classification works from the label, not the name, so this is fine. Just don't try to match on `name` directly.

### Welcome to the Jungle

- **Aggregator, not ATS**: the Apply button is `<a target="_blank" href="<real-ats-url>">`. Claude-in-chrome may not see the new tab; the playbook extracts the real URL from `href` and navigates directly.
- **Newsletter form misread as login wall**: the visible `#email` input inside the "Subscribe to our newsletter" form is **not** a login. Check `closest('form')` before classifying.
- **Silent submit**: the apply modal closes without showing a confirmation page or toast. Text/URL detection fails. Fallback: poll the user's application tracker page (`/fr/me/application-tracker`) for a new entry matching the target company within the last ~2 minutes.

## Adding a new ATS

See [`docs/extending.md`](extending.md) — short version: add a fetcher in `src/scan/ats/<name>.mjs`, extend `ats-detect.mjs`, add tests, submit a PR.
