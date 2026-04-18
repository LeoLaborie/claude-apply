---
description: Rebuild dashboard.html from data/ + reports/
argument-hint:
---

# /dashboard

Regenerate `dashboard.html` — a self-contained static page summarizing the pipeline, scores, and applications from `data/` and `reports/`.

## First-run guard

Before running the builder, check that `config/candidate-profile.yml` exists. If it does not, **stop** and tell the user:

> "No config found. Run `/apply-onboard` first — it will extract your CV, build the profile, and prepare the target companies."

Do not try to build the dashboard without a real profile.

## Run

```bash
node src/dashboard/build.mjs
```

## Output

- **`dashboard.html`** — self-contained HTML file at the repo root. Open it with your browser (e.g. `xdg-open dashboard.html` on Linux, `open dashboard.html` on macOS).

## Next step

Nothing. The dashboard is read-only; regenerate it after any `/scan`, `/score`, or `/apply`.
