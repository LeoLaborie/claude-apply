# Security policy

## Reporting a vulnerability

Please **do not open a public GitHub issue** for security reports. Instead, email the maintainer privately at the address listed in the GitHub profile at [github.com/LeoLaborie](https://github.com/LeoLaborie).

Expected response: acknowledgement within 7 days.

## Scope

- Code shipped under `src/`, `scripts/`, and `.github/workflows/`.
- The PII gate (`scripts/check-no-pii.sh`) — if you find a pattern that bypasses it, that is a security issue.
- Any default configuration that would leak user data at rest or in transit.

Out of scope:

- Vulnerabilities in upstream dependencies (report them upstream; we track via Dependabot).
- Issues requiring local code execution on a user's machine that already has full access to `config/` and `data/`.
- Social engineering or phishing targeting the maintainer.

## No bug bounty

This is a personal-scale project with no budget for paid disclosures. Credit in the changelog is the only reward on offer.

## Responsible disclosure

Please give the maintainer a reasonable window (ideally 30 days) to release a fix before any public writeup. If a fix requires coordination with an upstream dependency or an ATS vendor, that window may be extended.
