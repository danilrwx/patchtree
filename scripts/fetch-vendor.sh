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

# Fetch web-tree-sitter runtime and prebuilt grammar wasm binaries from npm.
# Every artifact comes from a pinned package version so builds are reproducible.
set -euo pipefail
cd "$(dirname "$0")/.."

WEB_TREE_SITTER=0.26.11
# go-template (Helm) and dockerfile grammars ship no wasm on npm — built from
# source below
GOTMPL_SHA=aa71f63de226c5592dfbfc1f29949522d7c95fac
# camdencheek/tree-sitter-dockerfile v0.2.0
DOCKERFILE_SHA=868e44ce378deb68aac902a9db68ff82d2299dd0
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
  "@tree-sitter-grammars/tree-sitter-zig@1.1.2 tree-sitter-zig.wasm"
  "tree-sitter-elixir@0.3.5 tree-sitter-elixir.wasm"
  "tree-sitter-scala@0.24.0 tree-sitter-scala.wasm"
  "tree-sitter-haskell@0.23.1 tree-sitter-haskell.wasm"
)

# grammars whose npm wasm is unusable (not an emscripten side module) or
# missing — built from pinned sources; their queries are pinned to the same
# revision in fetch-queries.sh
DART_NPM=tree-sitter-dart@1.0.0
GROOVY_SHA=deb0dcf8c4544f07564060f6e9b9f6e4b0bfc27d
KOTLIN_REF=0.3.8

if [ "${FORCE:-}" != "1" ]; then
  missing=0
  [ -s assets/vendor/web-tree-sitter.js ] && [ -s assets/vendor/web-tree-sitter.wasm ] || missing=1
  [ -s assets/vendor/wasm/tree-sitter-gotmpl.wasm ] || missing=1
  [ -s assets/vendor/wasm/tree-sitter-dockerfile.wasm ] || missing=1
  [ -s assets/vendor/wasm/tree-sitter-dart.wasm ] || missing=1
  [ -s assets/vendor/wasm/tree-sitter-groovy.wasm ] || missing=1
  [ -s assets/vendor/wasm/tree-sitter-kotlin.wasm ] || missing=1
  for entry in "${GRAMMARS[@]}"; do [ -s "assets/vendor/wasm/${entry#* }" ] || missing=1; done
  if [ "$missing" = 0 ]; then
    echo "assets/vendor/ up to date (FORCE=1 to refetch)"
    exit 0
  fi
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p assets/vendor/wasm

fetch_pkg() {
  rm -rf "$tmp/package"
  local tarball
  tarball=$(cd "$tmp" && npm pack --silent "$1")
  tar xzf "$tmp/$tarball" -C "$tmp"
  rm -f "$tmp/$tarball"
}

echo "web-tree-sitter@$WEB_TREE_SITTER"
fetch_pkg "web-tree-sitter@$WEB_TREE_SITTER"
cp "$tmp/package/web-tree-sitter.js" "$tmp/package/web-tree-sitter.wasm" assets/vendor/

for entry in "${GRAMMARS[@]}"; do
  pkg=${entry% *}
  wasm=${entry#* }
  echo "$pkg -> $wasm"
  fetch_pkg "$pkg"
  cp "$tmp/package/$wasm" assets/vendor/wasm/
done

build_from_source() {
  local repo=$1 sha=$2 out="$PWD/assets/vendor/wasm/$3"
  echo "$repo@$sha -> $3"
  curl -sfL "https://github.com/$repo/archive/$sha.tar.gz" | tar xz -C "$tmp"
  ( cd "$tmp/${repo#*/}-$sha" &&
    npx --yes tree-sitter-cli@$WEB_TREE_SITTER build --wasm -o "$out" . )
}

build_from_npm() {
  local pkg=$1 out="$PWD/assets/vendor/wasm/$2"
  echo "$pkg (source build) -> $2"
  fetch_pkg "$pkg"
  ( cd "$tmp/package" && npx --yes tree-sitter-cli@$WEB_TREE_SITTER build --wasm -o "$out" . )
}

build_from_source ngalaiko/tree-sitter-go-template "$GOTMPL_SHA" tree-sitter-gotmpl.wasm
build_from_source camdencheek/tree-sitter-dockerfile "$DOCKERFILE_SHA" tree-sitter-dockerfile.wasm
build_from_source murtaza64/tree-sitter-groovy "$GROOVY_SHA" tree-sitter-groovy.wasm
build_from_source fwcd/tree-sitter-kotlin "$KOTLIN_REF" tree-sitter-kotlin.wasm
build_from_npm "$DART_NPM" tree-sitter-dart.wasm

echo "assets/vendor/ done"
