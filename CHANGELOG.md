# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **BREAKING**: the onboarding slash command is now `/apply-onboard` (previously `/onboard`), with sub-commands `/apply-onboard:profile`, `/apply-onboard:companies`, `/apply-onboard:setup`. The rename avoids a collision with the `onboard` skill shipped by the `frontend-design` Claude Code plugin, which was shadowing the project command and rendering the documented entry point unusable (issue #35). First-run guards in `/scan`, `/score`, and `/apply` now point at `/apply-onboard`.
- **BREAKING**: `portals.yml` `title_filter` terms now match whole words, case-insensitive (was: case-insensitive substring). `intern` no longer rejects `International`, but also no longer matches `Interns`/`Internship` — add explicit plural variants, or use the new `/regex/flags` escape hatch for full control.

### Added

- `discoverCompany(name, options)` in `src/scan/discover-company.mjs` — smart slug discovery that walks platform-specific variations (`x`, `x-ai`, `xhq`, `xlabs`, `x-labs`, …) across Lever → Greenhouse → Ashby → Workday registry and returns the first hit. Resolutions are cached in `data/known-ats-slugs.json`. Closes #38: `/apply-onboard:companies` no longer drops the 17/37 companies (Doctolib, Cohere, Modal, Scale AI, Writer, OpenAI, …) that live under non-obvious slugs.
- `npm run explain -- "<title>" [--company "<co>"]` CLI traces why a title is accepted or filtered by the current `portals.yml` + `candidate-profile.yml`.
- `verifySlug(slug)` primitive on each ATS fetcher (`lever`, `greenhouse`, `ashby`), returning `{ ok, count }` or `{ ok: false, status, reason }`.
- `verifyCompany(careersUrl)` dispatcher and `getSupportedHosts()` helper in `src/scan/ats-detect.mjs`.
- `/onboard` step 7.4 documents the four `claude-in-chrome` host permissions the user must grant after installing the extension, with the host list derived from `getSupportedHosts()` (single source of truth).
- `/apply` step 0 now pre-flights the extension host permission and surfaces a clear remediation block on failure.
- Workday ATS support for `/scan` — new fetcher `src/scan/ats/workday.mjs` with `parseWorkdayUrl`, `fetchWorkday` (paginated), and `verifySlug`. Portals in `config/portals.yml` can now use `platform: workday` with the full career page URL (e.g. `https://totalenergies.wd3.myworkdayjobs.com/TotalEnergies_careers`). Unlocks scanning ~60% of CAC40 and a large share of Fortune 500 hiring. `/apply` support for Workday is not yet implemented.

### Changed (continued)

- `/onboard` step 5.2 now verifies candidate companies via the JSON API endpoint (`verifyCompany`) instead of `curl -sfI` on the public careers page. Fixes a silent-drop bug where Ashby returned `200` on the careers HTML but `404` on the JSON board (e.g. `dust-tt`).

## [0.1.0-alpha.0] — 2026-04-10

### Added

- Initial public alpha release.
- `src/scan` — ATS scanner for Lever, Greenhouse, and Ashby (zero-LLM public APIs).
- `src/score` — Lightweight offer evaluator using a stripped `claude -p` call.
- `src/apply` — Field classifier, language detector, confirmation detector, cover-letter generator, apply log, and a Playwright CDP file-upload helper.
- `src/dashboard` — Self-contained HTML dashboard generator.
- Claude Code slash commands: `/scan`, `/score`, `/apply`.
- `scripts/setup.sh` — Interactive first-time setup (Chrome CDP profile, shell alias, config templates).
- `scripts/check-no-pii.sh` — PII gate with path-regex exclusions.
- HTML fixtures and end-to-end integration tests for 4 ATS platforms.
- Documentation: README, CLAUDE.md, AGENTS.md, architecture, workflow guides, CDP setup, ATS support matrix, extension guide, agent guide, testing guide.
- Community files: CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.

[Unreleased]: https://github.com/LeoLaborie/claude-apply/compare/v0.1.0-alpha.0...HEAD
[0.1.0-alpha.0]: https://github.com/LeoLaborie/claude-apply/releases/tag/v0.1.0-alpha.0
