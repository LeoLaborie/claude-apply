#!/usr/bin/env bash
set -uo pipefail

OK=0
FAIL=0

check() {
  local name="$1"
  local cmd="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    local version
    version=$("$cmd" --version 2>&1 | head -1 || echo "unknown")
    echo "  ✓ $name ($version)"
    OK=$((OK+1))
    return 0
  else
    echo "  ✗ $name NOT FOUND"
    FAIL=$((FAIL+1))
    return 1
  fi
}

check_either() {
  local name="$1"; shift
  for cmd in "$@"; do
    if command -v "$cmd" >/dev/null 2>&1; then
      local version
      version=$("$cmd" --version 2>&1 | head -1 || echo "unknown")
      echo "  ✓ $name ($version)"
      OK=$((OK+1))
      return 0
    fi
  done
  echo "  ✗ $name NOT FOUND (tried: $*)"
  FAIL=$((FAIL+1))
}

echo "Checking prerequisites..."
check "Node.js" node
check "npm" npm
check "git" git
check_either "Google Chrome / Chromium" google-chrome google-chrome-stable chromium chromium-browser

if command -v pdflatex >/dev/null 2>&1; then
  echo "  ✓ pdflatex (optional, for cover letters)"
else
  echo "  — pdflatex not found (optional, skip if you don't need LaTeX cover letters)"
fi

if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
  if [[ "$NODE_MAJOR" -lt 20 ]]; then
    echo "  ✗ Node.js version too old: $NODE_MAJOR (need ≥20)"
    FAIL=$((FAIL+1))
  fi
fi

echo ""
echo "Result: $OK OK, $FAIL missing"
[[ $FAIL -eq 0 ]] && exit 0 || exit 1
