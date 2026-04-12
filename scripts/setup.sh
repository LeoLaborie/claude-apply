#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# Flags for non-interactive runs (used by /onboard).
#   --yes                       assume yes, never prompt
#   --clone-chrome-profile      clone the default Chrome profile
#   --no-clone-chrome-profile   create an empty Chrome profile
#   --no-rc                     do not touch ~/.zshrc or ~/.bashrc
#   -h | --help                 print usage
ASSUME_YES=0
CLONE_PROFILE=""   # "" = ask, "yes", "no"
TOUCH_RC=1
print_usage() {
  cat <<'USAGE'
Usage: bash scripts/setup.sh [flags]

Flags:
  --yes                       assume yes for all prompts (non-interactive)
  --clone-chrome-profile      clone the default Chrome profile into the CDP profile
  --no-clone-chrome-profile   create an empty CDP profile (do not clone)
  --no-rc                     do not append the chrome-apply alias to ~/.zshrc or ~/.bashrc
  -h, --help                  show this help

Running without flags keeps the interactive prompts.
USAGE
}
while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) ASSUME_YES=1 ;;
    --clone-chrome-profile) CLONE_PROFILE="yes" ;;
    --no-clone-chrome-profile) CLONE_PROFILE="no" ;;
    --no-rc) TOUCH_RC=0 ;;
    -h|--help) print_usage; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; print_usage >&2; exit 2 ;;
  esac
  shift
done

echo "🚀 claude-apply setup"
echo ""

# 1. Prereqs
if ! bash "$SCRIPT_DIR/check-prereqs.sh"; then
  echo ""
  echo "Fix missing prerequisites first, then re-run: bash scripts/setup.sh"
  exit 1
fi
echo ""

# 2. npm install
if [[ ! -d node_modules ]]; then
  echo "→ Installing npm dependencies..."
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
else
  echo "→ node_modules already present, skipping npm install"
fi
echo ""

# 3. Chrome CDP profile
OS="$(uname -s)"
case "$OS" in
  Linux)
    CDP_PROFILE="$HOME/.config/google-chrome-claude-apply"
    DEFAULT_PROFILE="$HOME/.config/google-chrome"
    CHROME_BIN="$(command -v google-chrome || command -v google-chrome-stable || command -v chromium || command -v chromium-browser || echo google-chrome)"
    ;;
  Darwin)
    CDP_PROFILE="$HOME/Library/Application Support/Google/Chrome-claude-apply"
    DEFAULT_PROFILE="$HOME/Library/Application Support/Google/Chrome"
    CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    ;;
  *)
    echo "Unsupported OS: $OS (v0.1 supports Linux and macOS)"
    exit 1
    ;;
esac

# 2b. pdflatex (for cover letter PDF generation)
if command -v pdflatex >/dev/null 2>&1; then
  echo "→ pdflatex already installed"
else
  echo "→ Installing pdflatex (for cover letter generation)..."
  case "$OS" in
    Linux)
      if command -v apt-get >/dev/null 2>&1; then
        sudo apt-get install -y texlive-latex-base texlive-latex-recommended
      else
        echo "  ✗ Cannot auto-install texlive — install pdflatex manually"
      fi
      ;;
    Darwin)
      if command -v brew >/dev/null 2>&1; then
        brew install --cask basictex
      else
        echo "  ✗ Cannot auto-install basictex — install pdflatex manually"
      fi
      ;;
  esac
  if command -v pdflatex >/dev/null 2>&1; then
    echo "  ✓ pdflatex installed"
  else
    echo "  ⚠ pdflatex not available — cover letter PDF generation will not work"
  fi
fi
echo ""

if [[ ! -d "$CDP_PROFILE" ]]; then
  echo "→ Creating Chrome CDP profile at: $CDP_PROFILE"
  if [[ -d "$DEFAULT_PROFILE" ]]; then
    decision="$CLONE_PROFILE"
    if [[ -z "$decision" ]]; then
      if [[ "$ASSUME_YES" -eq 1 ]]; then
        decision="no"
      else
        read -r -p "  Clone your default Chrome profile (extensions, cookies)? [y/N] " yn
        if [[ "${yn:-n}" =~ ^[Yy]$ ]]; then
          decision="yes"
        else
          decision="no"
        fi
      fi
    fi
    if [[ "$decision" == "yes" ]]; then
      cp -a "$DEFAULT_PROFILE" "$CDP_PROFILE"
      echo "  ✓ Profile cloned"
    else
      mkdir -p "$CDP_PROFILE"
      echo "  ✓ Empty profile created"
    fi
  else
    mkdir -p "$CDP_PROFILE"
    echo "  ✓ Empty profile created (no default Chrome profile to clone)"
  fi
else
  echo "→ Chrome CDP profile already exists at: $CDP_PROFILE"
fi
echo ""

# 4. Shell alias
SHELL_RC=""
if [[ "$TOUCH_RC" -eq 0 ]]; then
  echo "→ --no-rc: skipping shell rc update. Add this alias manually if needed:"
  echo "    alias chrome-apply='\"$CHROME_BIN\" --user-data-dir=\"$CDP_PROFILE\" --remote-debugging-port=9222 &'"
  echo ""
elif [[ -f "$HOME/.zshrc" ]]; then
  SHELL_RC="$HOME/.zshrc"
elif [[ -f "$HOME/.bashrc" ]]; then
  SHELL_RC="$HOME/.bashrc"
fi

if [[ -n "$SHELL_RC" ]]; then
  if ! grep -q "alias chrome-apply=" "$SHELL_RC" 2>/dev/null; then
    cp "$SHELL_RC" "$SHELL_RC.backup.$(date +%s)"
    {
      echo ""
      echo "# claude-apply: Chrome with CDP debugging enabled"
      echo "alias chrome-apply='\"$CHROME_BIN\" --user-data-dir=\"$CDP_PROFILE\" --remote-debugging-port=9222 &'"
    } >> "$SHELL_RC"
    echo "→ Added chrome-apply alias to $SHELL_RC (backup saved)"
  else
    echo "→ chrome-apply alias already present in $SHELL_RC"
  fi
else
  echo "→ No ~/.zshrc or ~/.bashrc found; add this alias manually:"
  echo "    alias chrome-apply='\"$CHROME_BIN\" --user-data-dir=\"$CDP_PROFILE\" --remote-debugging-port=9222 &'"
fi
echo ""

# 5. Config templates
mkdir -p config data
copied_any=0
copy_if_missing() {
  local src="$1" dst="$2"
  if [[ -f "$src" && ! -f "$dst" ]]; then
    cp "$src" "$dst"
    echo "  ✓ Created $dst"
    copied_any=1
  fi
}

copy_if_missing "templates/candidate-profile.example.yml" "config/candidate-profile.yml"
copy_if_missing "templates/cv.example.md"                  "config/cv.md"
copy_if_missing "templates/portals.example.yml"            "config/portals.yml"
copy_if_missing "templates/applications.example.md"        "data/applications.md"

if [[ $copied_any -eq 0 ]]; then
  echo "→ Config files already present, nothing to copy"
else
  echo "→ Example config copied — edit the files above with your own data"
fi
echo ""

cat <<'EOF'
Next steps:
  1. Edit config/candidate-profile.yml with your personal info
  2. Edit config/cv.md with your CV (markdown)
  3. Edit config/portals.yml with the companies to scan
  4. Reload your shell:      source ~/.zshrc   # or ~/.bashrc
  5. Launch Chrome with CDP: chrome-apply
  6. Install the claude-in-chrome extension in that Chrome window
  7. Try a dry run:          node src/scan/index.mjs --dry-run
  8. Inside Claude Code:     /apply <job_url>

Docs: see docs/for-agents.md, docs/apply-workflow.md, docs/cdp-setup.md
EOF
