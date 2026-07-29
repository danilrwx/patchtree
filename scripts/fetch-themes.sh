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

# Build assets/themes.json from the tinted-theming schemes collection (MIT licensed),
# pinned to a commit. Only base24 schemes are included; patchtree uses the
# base00–base0F part of the palette.
set -euo pipefail
cd "$(dirname "$0")/.."

REF=9bd28ed313560db3c5b605c63bc4e309e78e3fc8

if [ "${FORCE:-}" != "1" ] && [ -s assets/themes.json ]; then
  echo "assets/themes.json up to date (FORCE=1 to refetch)"
  exit 0
fi

mkdir -p assets
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -sfL "https://github.com/tinted-theming/schemes/archive/$REF.tar.gz" | tar xz -C "$tmp"
src="$tmp/schemes-$REF"

node - "$src" > assets/themes.json <<'EOF'
const { readdirSync, readFileSync } = require("fs");
const src = process.argv[2];
const out = [];
for (const system of ["base24"]) {
  for (const file of readdirSync(`${src}/${system}`).sort()) {
    if (!file.endsWith(".yaml")) continue;
    const text = readFileSync(`${src}/${system}/${file}`, "utf8");
    const colors = [];
    for (let i = 0; i < 16; i++) {
      const key = `base0${i.toString(16).toUpperCase()}`;
      const m = new RegExp(`${key}:\\s*["']?#?([0-9a-fA-F]{6})`).exec(text);
      if (!m) { colors.length = 0; break; }
      colors.push(m[1].toLowerCase());
    }
    if (!colors.length) continue;
    const name = /name:\s*["']?([^"'\n]+)/.exec(text)?.[1]?.trim() || file.replace(".yaml", "");
    const variant = /variant:\s*["']?(\w+)/.exec(text)?.[1] || "dark";
    out.push({ name, system, variant, palette: colors.join(" ") });
  }
}
process.stdout.write(JSON.stringify(out));
EOF

node -e "const t=require('./assets/themes.json'); console.log(t.length, 'themes,', JSON.stringify(t[0]).length, 'bytes first')"
