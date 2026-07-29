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
# Fetch web-tree-sitter runtime and prebuilt grammar wasm binaries from npm.
# Every artifact comes from a pinned package version so builds are reproducible.
set -euo pipefail
cd "$(dirname "$0")/.."

WEB_TREE_SITTER=0.26.11
# go-template (Helm) grammar ships no wasm on npm — built from source below
GOTMPL_SHA=aa71f63de226c5592dfbfc1f29949522d7c95fac
GRAMMARS=(
  "tree-sitter-go@0.25.0 tree-sitter-go.wasm"
  "tree-sitter-javascript@0.25.0 tree-sitter-javascript.wasm"
  "tree-sitter-python@0.25.0 tree-sitter-python.wasm"
  "tree-sitter-bash@0.25.1 tree-sitter-bash.wasm"
  "tree-sitter-json@0.24.8 tree-sitter-json.wasm"
  "tree-sitter-rust@0.24.0 tree-sitter-rust.wasm"
  "tree-sitter-c@0.24.1 tree-sitter-c.wasm"
  "tree-sitter-css@0.25.0 tree-sitter-css.wasm"
  "tree-sitter-html@0.23.2 tree-sitter-html.wasm"
  "tree-sitter-typescript@0.23.2 tree-sitter-tsx.wasm"
  "@tree-sitter-grammars/tree-sitter-yaml@0.7.1 tree-sitter-yaml.wasm"
  "tree-sitter-cpp@0.23.4 tree-sitter-cpp.wasm"
  "tree-sitter-java@0.23.5 tree-sitter-java.wasm"
  "tree-sitter-ruby@0.23.1 tree-sitter-ruby.wasm"
  "tree-sitter-php@0.24.2 tree-sitter-php.wasm"
  "tree-sitter-c-sharp@0.23.5 tree-sitter-c_sharp.wasm"
  "@tree-sitter-grammars/tree-sitter-lua@0.4.1 tree-sitter-lua.wasm"
  "@tree-sitter-grammars/tree-sitter-toml@0.7.0 tree-sitter-toml.wasm"
  "@tree-sitter-grammars/tree-sitter-hcl@1.2.0 tree-sitter-hcl.wasm"
)

if [ "${FORCE:-}" != "1" ]; then
  missing=0
  [ -s vendor/web-tree-sitter.js ] && [ -s vendor/web-tree-sitter.wasm ] || missing=1
  [ -s vendor/wasm/tree-sitter-gotmpl.wasm ] || missing=1
  for entry in "${GRAMMARS[@]}"; do [ -s "vendor/wasm/${entry#* }" ] || missing=1; done
  if [ "$missing" = 0 ]; then
    echo "vendor/ up to date (FORCE=1 to refetch)"
    exit 0
  fi
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p vendor/wasm

fetch_pkg() {
  rm -rf "$tmp/package"
  local tarball
  tarball=$(cd "$tmp" && npm pack --silent "$1")
  tar xzf "$tmp/$tarball" -C "$tmp"
  rm -f "$tmp/$tarball"
}

echo "web-tree-sitter@$WEB_TREE_SITTER"
fetch_pkg "web-tree-sitter@$WEB_TREE_SITTER"
cp "$tmp/package/web-tree-sitter.js" "$tmp/package/web-tree-sitter.wasm" vendor/

for entry in "${GRAMMARS[@]}"; do
  pkg=${entry% *}
  wasm=${entry#* }
  echo "$pkg -> $wasm"
  fetch_pkg "$pkg"
  cp "$tmp/package/$wasm" vendor/wasm/
done

echo "ngalaiko/tree-sitter-go-template@$GOTMPL_SHA -> tree-sitter-gotmpl.wasm"
out="$PWD/vendor/wasm/tree-sitter-gotmpl.wasm"
curl -sfL "https://github.com/ngalaiko/tree-sitter-go-template/archive/$GOTMPL_SHA.tar.gz" | tar xz -C "$tmp"
( cd "$tmp/tree-sitter-go-template-$GOTMPL_SHA" &&
  npx --yes tree-sitter-cli@$WEB_TREE_SITTER build --wasm -o "$out" . )

echo "vendor/ done"
