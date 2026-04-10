# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
