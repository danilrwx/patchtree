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

# Build every grammar wasm from pinned, sha256-verified sources — one uniform
# path: fetch archive -> verify -> `tree-sitter build --wasm`. Only the
# web-tree-sitter runtime ships prebuilt (building it means an emscripten
# build of tree-sitter itself), and it is verified the same way.
#
# Grammars whose wasm already exists are skipped; FORCE=1 rebuilds everything.
# After a version bump, PRINT_SUMS=1 FORCE=1 prints fresh sha256 pins.
set -euo pipefail
cd "$(dirname "$0")/.."

WEB_TREE_SITTER=0.26.11
WEB_TREE_SITTER_SHA=18b61b4d1a4036f53523e92d294c1e07cea5150be316b654e76a496ca518f211
CLI="tree-sitter-cli@$WEB_TREE_SITTER"

# name  repo  ref  subdir  sha256-of-archive
# `npm:<pkg>` fetches the registry tarball instead of a GitHub archive (dart
# publishes generated sources only there). Query pins in fetch-queries.sh
# track the same refs.
SOURCES=(
  "go tree-sitter/tree-sitter-go v0.25.0 . 2dc241b97872c53195e01b86542b411a3c1a6201d9c946c78d5c60c063bba1ef"
  "javascript tree-sitter/tree-sitter-javascript v0.25.0 . 9712fc283d3dc01d996d20b6392143445d05867a7aad76fdd723824468428b86"
  "python tree-sitter/tree-sitter-python v0.25.0 . 4609a3665a620e117acf795ff01b9e965880f81745f287a16336f4ca86cf270c"
  "bash tree-sitter/tree-sitter-bash v0.25.1 . 2e785a761225b6c433410ef9c7b63cfb0a4e83a35a19e0f2aec140b42c06b52d"
  "json tree-sitter/tree-sitter-json v0.24.8 . acf6e8362457e819ed8b613f2ad9a0e1b621a77556c296f3abea58f7880a9213"
  "rust tree-sitter/tree-sitter-rust v0.24.0 . 79c9eb05af4ebcce8c40760fc65405e0255e2d562702314b813a5dec1273b9a2"
  "c tree-sitter/tree-sitter-c v0.24.1 . 25dd4bb3dec770769a407e0fc803f424ce02c494a56ce95fedc525316dcf9b48"
  "css tree-sitter/tree-sitter-css v0.25.0 . 03965344d8c0435dc54fb45b281578420bb7db8b99df4d34e7e74105a274cb79"
  "html tree-sitter/tree-sitter-html v0.23.2 . 21fa4f2d4dcb890ef12d09f4979a0007814f67f1c7294a9b17b0108a09e45ef7"
  "tsx tree-sitter/tree-sitter-typescript v0.23.2 tsx 2c4ce711ae8d1218a3b2f899189298159d672870b5b34dff5d937bed2f3e8983"
  "yaml tree-sitter-grammars/tree-sitter-yaml v0.7.1 . 0626a1d89d713a46acd0581b745d3dcfe0b3714279eb6cf858fe78ff850a5a2b"
  "cpp tree-sitter/tree-sitter-cpp v0.23.4 . 7a2c55afe3028f4105f25762ea58cc16537d1f5a1dcd9cca90410b3cd5d46051"
  "java tree-sitter/tree-sitter-java v0.23.5 . cb199e0faae4b2c08425f88cbb51c1a9319612e7b96315a174a624db9bf3d9f0"
  "ruby tree-sitter/tree-sitter-ruby v0.23.1 . e7e49577ddc1f2de8e42d42353b477e338c15bbb95b2558e123ddc13d88789f0"
  "php tree-sitter/tree-sitter-php v0.24.2 php 0e73ad63dda67ac12c0e012726a4e1a9811c26b020a0a2dea3e889f8246d9cf4"
  "c_sharp tree-sitter/tree-sitter-c-sharp v0.23.5 . 9628b164369071019368618bdefa446f0aab8acaac47b75d5dfb209e93b8903b"
  "lua tree-sitter-grammars/tree-sitter-lua v0.4.1 . cef44b8773bde69d427b5e50ca95e417c86c0be91caa37a6782c90d6f529da70"
  "toml tree-sitter-grammars/tree-sitter-toml v0.7.0 . 7d52a7d4884f307aabc872867c69084d94456d8afcdc63b0a73031a8b29036dc"
  "hcl tree-sitter-grammars/tree-sitter-hcl v1.2.0 . a95bc6b00271e08dee9e63b895b2563dac802db0015fdf5a24a1b0244f2cb560"
  "zig tree-sitter-grammars/tree-sitter-zig v1.1.2 . 612d67059faa90ec7691e5d786d70d8f7c2c8b15b83de901b9b801122ad4cf25"
  "elixir elixir-lang/tree-sitter-elixir v0.3.5 . 7d8bf37949e2bea75a19d38491d7680ed1c9f0f5a41a5235832d718ec174c7c4"
  "scala tree-sitter/tree-sitter-scala v0.24.0 . 6ba17e09ba035a4a1b19db7906b87ec2c56cf400073e8e7272e8bdc9413921f8"
  "haskell tree-sitter/tree-sitter-haskell v0.23.1 . bac7d0a37730af62d883e2bdbafb68f47e7ab4f5e744c7586bffc589906a8cc2"
  "gotmpl ngalaiko/tree-sitter-go-template aa71f63de226c5592dfbfc1f29949522d7c95fac . 86bcd2cd462a2fdd94a60bb44b6f15e99b3d02177c5d631cbf45761bae482458"
  "dockerfile camdencheek/tree-sitter-dockerfile 868e44ce378deb68aac902a9db68ff82d2299dd0 . 57edd2a3973e3f9534a9512f0608b7ac4820fc77839a6105f03ff25507292c7c"
  "groovy murtaza64/tree-sitter-groovy deb0dcf8c4544f07564060f6e9b9f6e4b0bfc27d . c0e121b50e4513bab3c0e646696de643e3b2ec992409f8bf104b4e70e7d4f778"
  "kotlin fwcd/tree-sitter-kotlin 0.3.8 . 7dd60975786bf9cb4be6a5176f5ccb5fed505f9929a012da30762505b1015669"
  "markdown tree-sitter-grammars/tree-sitter-markdown f969cd3ae3f9fbd4e43205431d0ae286014c05b5 tree-sitter-markdown 45ec28324b75ec80788775a6aed26888f55b306981fede9cbe35d7348ae80469"
  "markdown_inline tree-sitter-grammars/tree-sitter-markdown f969cd3ae3f9fbd4e43205431d0ae286014c05b5 tree-sitter-markdown-inline 45ec28324b75ec80788775a6aed26888f55b306981fede9cbe35d7348ae80469"
  "dart npm:tree-sitter-dart 1.0.0 . dccd1db8d5514ffe26f5d7a03f40f61c0245b1fcfd6a83af99143a04f5e0b505"
)

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
mkdir -p assets/vendor/wasm

# download $1 into $tmp/$2 and require sha256 $3
fetch_checked() {
  local url=$1 name=$2 want=$3 got
  curl -sfL "$url" -o "$tmp/$name"
  got=$(shasum -a 256 "$tmp/$name" | awk '{print $1}')
  if [ "${PRINT_SUMS:-}" = 1 ]; then
    echo "  $name $got"
    return
  fi
  if [ "$got" != "$want" ]; then
    echo "sha256 mismatch for $name: expected $want, got $got" >&2
    exit 1
  fi
}

runtime_done=0
if [ "${FORCE:-}" != 1 ] && [ -s assets/vendor/web-tree-sitter.js ] && [ -s assets/vendor/web-tree-sitter.wasm ]; then
  runtime_done=1
fi
if [ "$runtime_done" = 0 ]; then
  echo "web-tree-sitter@$WEB_TREE_SITTER"
  fetch_checked "https://registry.npmjs.org/web-tree-sitter/-/web-tree-sitter-$WEB_TREE_SITTER.tgz" \
    web-tree-sitter.tgz "$WEB_TREE_SITTER_SHA"
  if [ "${PRINT_SUMS:-}" != 1 ]; then
    tar xzf "$tmp/web-tree-sitter.tgz" -C "$tmp"
    cp "$tmp/package/web-tree-sitter.js" "$tmp/package/web-tree-sitter.wasm" assets/vendor/
  fi
fi

build_one() {
  local name=$1 repo=$2 ref=$3 sub=$4 sha=$5
  local out="$PWD/assets/vendor/wasm/tree-sitter-$name.wasm"
  if [ "${FORCE:-}" != 1 ] && [ -s "$out" ]; then return; fi
  echo "$name <- $repo@$ref"
  local dir
  if [ "${repo#npm:}" != "$repo" ]; then
    local pkg=${repo#npm:}
    fetch_checked "https://registry.npmjs.org/$pkg/-/$pkg-$ref.tgz" "$name.tgz" "$sha"
    [ "${PRINT_SUMS:-}" = 1 ] && return
    rm -rf "$tmp/package"
    tar xzf "$tmp/$name.tgz" -C "$tmp"
    dir="$tmp/package"
  else
    fetch_checked "https://github.com/$repo/archive/$ref.tar.gz" "$name.tar.gz" "$sha"
    [ "${PRINT_SUMS:-}" = 1 ] && return
    tar xzf "$tmp/$name.tar.gz" -C "$tmp"
    dir="$tmp/${repo#*/}-${ref#v}"
  fi
  [ "$sub" = . ] || dir="$dir/$sub"
  ( cd "$dir" && npx --yes "$CLI" build --wasm -o "$out" . )
}

for entry in "${SOURCES[@]}"; do
  # shellcheck disable=SC2086
  build_one $entry
done

echo "assets/vendor/ done"
