#!/usr/bin/env bash
# Fetch web-tree-sitter runtime and prebuilt grammar wasm binaries from npm.
# Every artifact comes from a pinned package version so builds are reproducible.
set -euo pipefail
cd "$(dirname "$0")/.."

WEB_TREE_SITTER=0.26.11
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

echo "vendor/ done"
