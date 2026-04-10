# Chrome DevTools Protocol (CDP) setup

`/apply` uploads files via Playwright `connectOverCDP()`. This requires Chrome to be running with `--remote-debugging-port=9222` on a **non-default user data directory** — Chrome refuses to expose CDP on the default profile for security reasons.

`scripts/setup.sh` does this automatically on first run. This document is the manual reference.

## Why a separate profile?

Chrome's security policy blocks `--remote-debugging-port` when the requested user data dir is the default one (`~/.config/google-chrome` on Linux, `~/Library/Application Support/Google/Chrome` on macOS). The error message is:

```
DevTools remote debugging requires a non-default data directory
```

`scripts/setup.sh` creates a dedicated profile at:

- Linux: `~/.config/google-chrome-claude-apply`
- macOS: `~/Library/Application Support/Google/Chrome-claude-apply`

On the first run, you can choose to clone your default Chrome profile — that copies your extensions, cookies, and logged-in sessions (helpful for WTTJ, LinkedIn, etc.). If you skip the clone, the new profile is empty and you'll need to re-install the `claude-in-chrome` extension manually.

## The alias

`scripts/setup.sh` adds an alias to your shell rc (`~/.zshrc` or `~/.bashrc`):

```bash
alias chrome-apply='"/usr/bin/google-chrome" --user-data-dir="$HOME/.config/google-chrome-claude-apply" --remote-debugging-port=9222 &'
```

After `source ~/.zshrc`, typing `chrome-apply` launches the CDP-enabled Chrome in the background. **Always use this alias** for applying — the Chrome dock icon or app launcher opens the default profile without CDP.

## Verifying CDP

With Chrome running via `chrome-apply`:

```bash
curl -sf http://127.0.0.1:9222/json/version
```

Expected output: JSON with `"Browser"`, `"webSocketDebuggerUrl"`, etc. If curl fails, CDP is not active.

## Updating the cloned profile

If you install a new extension or update an existing one in your default Chrome profile, the CDP profile won't see the change. To refresh:

1. Close both Chromes fully (check no `chrome` process is running: `pgrep chrome`).
2. Re-clone:
   ```bash
   rm -rf ~/.config/google-chrome-claude-apply
   cp -a ~/.config/google-chrome ~/.config/google-chrome-claude-apply
   ```
3. Relaunch via `chrome-apply`.

On macOS, substitute the path and use the same `cp -a` pattern.

## Troubleshooting

| Symptom                                              | Cause                                              | Fix                                               |
| ---------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------- |
| `curl: (7) Failed to connect to 127.0.0.1 port 9222` | Chrome not running or not launched via the alias  | Run `chrome-apply`                                |
| `DevTools remote debugging requires a non-default data directory` | Profile path points to default profile   | Use `~/.config/google-chrome-claude-apply`        |
| Extension missing in CDP window                      | Skipped the clone at setup                         | Install the extension in the CDP window, or re-clone |
| `TAB_NOT_FOUND` from upload helper                   | Multiple Chromes running, wrong one hit            | Kill all Chromes, start only via `chrome-apply`   |

## Windows support

Not shipped in v0.1 — Playwright CDP works on Windows, but the `setup.sh` script and the shell alias plumbing are Unix-only. PRs welcome.
