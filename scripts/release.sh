#!/usr/bin/env bash
# Copyright 2026 Daniil Antoshin
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Cuts the release PR: bumps package.json and manifest.json, prepends the new
# CHANGELOG.md section rendered from conventional commits, opens the PR with
# auto-merge armed. After it merges, publish by tagging the squash commit:
#
#   git checkout main && git pull
#   git tag -s vX.Y.Z -m vX.Y.Z && git push origin vX.Y.Z
#
# Usage: scripts/release.sh 1.4.0
set -euo pipefail
cd "$(dirname "$0")/.."

v="${1:?usage: scripts/release.sh <version>}"
v="${v#v}"
[[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "not a semver: $v" >&2; exit 1; }

git diff --quiet && git diff --cached --quiet || { echo "working tree not clean" >&2; exit 1; }
[ "$(git branch --show-current)" = main ] || { echo "run from main" >&2; exit 1; }
git pull --ff-only

notes=$(scripts/changelog.sh)
git checkout -b "chore/release-v$v"

npm version --no-git-tag-version "$v" >/dev/null
node -e '
  const fs = require("fs");
  const m = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
  m.version = process.argv[1];
  fs.writeFileSync("manifest.json", JSON.stringify(m, null, 2) + "\n");
' "$v"

tmp=$(mktemp)
{
  awk '/^## /{exit} {print}' CHANGELOG.md
  printf '## v%s\n\n%s\n\n' "$v" "$notes"
  awk '/^## /{f=1} f' CHANGELOG.md
} > "$tmp"
mv "$tmp" CHANGELOG.md

git add package.json package-lock.json manifest.json CHANGELOG.md
git commit -s -m "chore(release): v$v"
git push -u origin "chore/release-v$v"
gh pr create --title "chore(release): v$v" \
  --body "Version bump and changelog. After merge: pull main, \`git tag -s v$v -m v$v && git push origin v$v\`."
gh pr merge --auto --squash
git checkout main

echo
echo "Release PR is up and will auto-merge on green CI."
echo "Then: git pull && git tag -s v$v -m v$v && git push origin v$v"
