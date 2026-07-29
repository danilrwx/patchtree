#!/usr/bin/env bash
# MIT License
#
# Copyright (c) 2026 Daniil Antoshin
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
# Render a grouped Markdown changelog from conventional commits.
#
# Usage:
#   scripts/changelog.sh                 # previous tag .. HEAD (or full history)
#   scripts/changelog.sh v1.2.0          # the range that tag closes (prevTag..v1.2.0)
#   scripts/changelog.sh v1.0.0..v1.1.0  # an explicit range
set -euo pipefail
cd "$(dirname "$0")/.."

arg="${1:-}"
if [ -z "$arg" ]; then
  last=$(git describe --tags --abbrev=0 2>/dev/null || true)
  range="${last:+$last..}HEAD"
elif [[ "$arg" == *..* ]]; then
  range="$arg"
else
  prev=$(git describe --tags --abbrev=0 "$arg^" 2>/dev/null || true)
  range="${prev:+$prev..}$arg"
fi

# type -> section heading; order here is the order in the output
sections=(
  "feat|### 🚀 Features"
  "fix|### 🐛 Fixes"
  "perf|### ⚡ Performance"
  "refactor|### ♻️ Refactoring"
  "docs|### 📖 Documentation"
  "test|### ✅ Tests"
  "build|### 👷 Build & CI"
  "ci|### 👷 Build & CI"
  "style|### 💅 Style"
  "chore|### 🔧 Chores"
)

log=$(git log --no-merges --pretty=format:'%h%x09%s' "$range" 2>/dev/null || true)

emitted=0
seen_heading=""
for pair in "${sections[@]}"; do
  type=${pair%%|*}
  heading=${pair#*|}
  # avoid printing the shared "Build & CI" heading twice
  [ "$heading" = "$seen_heading" ] && heading=""
  body=$(awk -F'\t' -v t="$type" '
    {
      s=$2
      # match "type" or "type(scope)" optionally with a "!" breaking marker
      if (match(s, "^" t "(\\([^)]*\\))?!?: ")) {
        desc=substr(s, RLENGTH+1)
        scope=""
        if (match(s, "^" t "\\(([^)]*)\\)")) {
          scope=substr(s, index(s,"(")+1)
          scope=substr(scope, 1, index(scope,")")-1)
        }
        if (scope != "") printf "- **%s:** %s (`%s`)\n", scope, desc, $1
        else printf "- %s (`%s`)\n", desc, $1
      }
    }' <<<"$log")
  if [ -n "$body" ]; then
    [ -n "$heading" ] && { printf '%s\n\n' "$heading"; seen_heading="$heading"; }
    printf '%s\n\n' "$body"
    emitted=1
  fi
done

if [ "$emitted" = 0 ]; then echo "_No notable changes._"; fi
