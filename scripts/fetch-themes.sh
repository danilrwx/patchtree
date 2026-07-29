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
# Build themes.json from the tinted-theming schemes collection (MIT licensed),
# pinned to a commit. Both base16 and base24 schemes are included; patchtree
# uses the base00–base0F part of the palette.
set -euo pipefail
cd "$(dirname "$0")/.."

REF=9bd28ed313560db3c5b605c63bc4e309e78e3fc8

if [ "${FORCE:-}" != "1" ] && [ -s themes.json ]; then
  echo "themes.json up to date (FORCE=1 to refetch)"
  exit 0
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -sfL "https://github.com/tinted-theming/schemes/archive/$REF.tar.gz" | tar xz -C "$tmp"
src="$tmp/schemes-$REF"

node - "$src" > themes.json <<'EOF'
const { readdirSync, readFileSync } = require("fs");
const src = process.argv[2];
const out = [];
for (const system of ["base16", "base24"]) {
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

node -e "const t=require('./themes.json'); console.log(t.length, 'themes,', JSON.stringify(t[0]).length, 'bytes first')"
