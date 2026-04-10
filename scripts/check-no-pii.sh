#!/usr/bin/env bash
# check-no-pii.sh — Verify no personal data leaks into tracked files.
# Exits non-zero if any pattern from the blocklist is found.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

# Hardcoded patterns. Each entry: "pattern|allow_in_package_json"
# If allow_in_package_json=1, we skip package.json when scanning for this pattern.
HARDCODED=(
  'leo\.laborie|1'
  'leolaborie|1'
  '06[[:space:]]*49[[:space:]]*71[[:space:]]*45[[:space:]]*17|0'
  '0649714517|0'
  '3[[:space:]]juillet[[:space:]]2005|0'
  '2005-07-03|0'
)

# Dynamic patterns from .pii-blocklist
DYNAMIC_PATTERNS=()
if [[ -f .pii-blocklist ]]; then
  while IFS= read -r line; do
    # Strip leading/trailing whitespace
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -z "$line" || "${line:0:1}" == "#" ]] && continue
    DYNAMIC_PATTERNS+=("$line")
  done < .pii-blocklist
fi

# Get file list — tracked files if in git repo, else filesystem scan
if git rev-parse --git-dir >/dev/null 2>&1; then
  mapfile -t ALL_FILES < <(git ls-files)
else
  mapfile -t ALL_FILES < <(find . -type f \
    -not -path './node_modules/*' \
    -not -path './.git/*' \
    -not -name '.pii-blocklist' \
    -not -name '*.pdf' \
    | sed 's|^\./||')
fi

# Always exclude .pii-blocklist and this script itself from scanning
# (they legitimately contain the blocklisted patterns as code/configuration)
SCRIPT_REL="${BASH_SOURCE[0]#"$REPO_ROOT/"}"
FILTERED_FILES=()
for f in "${ALL_FILES[@]}"; do
  [[ "$f" == ".pii-blocklist" ]] && continue
  [[ "$f" == "$SCRIPT_REL" ]] && continue
  [[ "$f" == "tests/check-no-pii.test.mjs" ]] && continue
  FILTERED_FILES+=("$f")
done

FOUND=0

scan_pattern() {
  local pattern="$1"
  local exclude_pkg_json="$2"
  local files_to_scan=()
  for f in "${FILTERED_FILES[@]}"; do
    if [[ "$exclude_pkg_json" == "1" && "$f" == "package.json" ]]; then
      continue
    fi
    files_to_scan+=("$f")
  done
  [[ ${#files_to_scan[@]} -eq 0 ]] && return
  local matches
  matches=$(printf '%s\n' "${files_to_scan[@]}" | xargs -r grep -liE "$pattern" 2>/dev/null || true)
  if [[ -n "$matches" ]]; then
    echo "❌ PII LEAK: pattern '$pattern' found in:"
    echo "$matches" | sed 's/^/    /'
    FOUND=1
  fi
}

for entry in "${HARDCODED[@]}"; do
  pattern="${entry%|*}"
  exclude_pkg="${entry##*|}"
  scan_pattern "$pattern" "$exclude_pkg"
done

for p in "${DYNAMIC_PATTERNS[@]}"; do
  scan_pattern "$p" "0"
done

if [[ $FOUND -eq 0 ]]; then
  echo "✓ No PII detected in tracked files."
  exit 0
else
  echo ""
  echo "Fix: remove the offending content, or add the file to .gitignore if it shouldn't be tracked."
  exit 1
fi
