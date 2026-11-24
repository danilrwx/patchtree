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

set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
work=${PATCHTREE_INDEX_BUILD_DIR:-"${XDG_CACHE_HOME:-$HOME/.cache}/patchtree-build"}
mkdir -p "$work"
work=$(cd "$work" && pwd)
llvm_revision=2078da43e25a4623cab2d0d60decddf709aaea28
ts_revision=c63de15a992d37f0d6cec03ac7631872838602cb
emsdk_revision=389a68bc35dcff7ebae4614e1615099dafda00d1
emsdk_version=4.0.15
package="$root/build/indexers"
mkdir -p "$package"

extract_source() {
  local directory=$1 repo=$2 revision=$3
  if [[ ! -f "$directory/.patchtree-source-$revision" ]]; then
    mkdir -p "$directory"
    curl --retry 4 -fsSL "https://codeload.github.com/$repo/tar.gz/$revision" |
      tar -xz --strip-components=1 -C "$directory"
    touch "$directory/.patchtree-source-$revision"
  fi
}

build_typescript() {
  local source="$work/typescript-$ts_revision"
  extract_source "$source" microsoft/TypeScript "$ts_revision"
  if [[ ! -s "$source/built/local/typescript.d.ts" ]]; then
    cd "$source"
    npm ci --ignore-scripts --no-audit --no-fund
    npm run build:compiler
  fi
  cd "$root"
  node_modules/.bin/esbuild "$source/built/local/typescript.js" \
    --bundle --platform=browser --format=esm --minify --define:process=undefined --legal-comments=linked \
    --outfile="$package/typescript.js"
  tar --sort=name --mtime=@0 -czf "$package/typescript-libs.tar.gz" -C "$source/built/local" \
    $(cd "$source/built/local" && printf '%s\n' lib.*.d.ts)
  cp "$source/LICENSE.txt" "$package/LICENSE-TypeScript.txt"
  cp "$source/ThirdPartyNoticeText.txt" "$package/NOTICE-TypeScript.txt"
}

build_clang() {
  local fingerprint
  fingerprint=$(sha256sum "$0" "$root/tools/clang-index/"* | cut -d' ' -f1 | sha256sum | cut -d' ' -f1)
  if [[ -s "$package/clang-version" && $(cat "$package/clang-version") == "$fingerprint" &&
    -s "$package/patchtree-clang.wasm" && -s "$package/patchtree-clang.js" &&
    -s "$package/clang-headers.tar.gz" && -s "$package/LICENSE-LLVM.txt" &&
    -s "$package/LICENSE-Emscripten.txt" ]]; then
    return
  fi
  local sdk="$work/emsdk-$emsdk_revision" source="$work/llvm-${llvm_revision:0:8}"
  extract_source "$sdk" emscripten-core/emsdk "$emsdk_revision"
  if [[ ! -f "$sdk/.emscripten" ]]; then
    "$sdk/emsdk" install "$emsdk_version"
    "$sdk/emsdk" activate "$emsdk_version"
  fi
  source "$sdk/emsdk_env.sh"

  extract_source "$source" llvm/llvm-project "$llvm_revision"
  # Register the small frontend inside Clang so it inherits generated headers.
  local tools="$source/clang/tools/CMakeLists.txt"
  if ! grep -Fxq 'add_subdirectory("$ENV{PATCHTREE_CLANG_SOURCE}" patchtree-clang)' "$tools"; then
    printf '\nadd_subdirectory("$ENV{PATCHTREE_CLANG_SOURCE}" patchtree-clang)\n' >> "$tools"
  fi
  export PATCHTREE_CLANG_SOURCE="$root/tools/clang-index"
  local out="$work/clang"
  emcmake cmake -S "$source/llvm" -B "$out" -G Ninja \
    -DCMAKE_BUILD_TYPE=MinSizeRel \
    -DCMAKE_C_FLAGS=-mbulk-memory -DCMAKE_CXX_FLAGS=-mbulk-memory \
    -DLLVM_ENABLE_PROJECTS=clang -DLLVM_TARGETS_TO_BUILD=WebAssembly \
    -DLLVM_HOST_TRIPLE=wasm32-unknown-emscripten \
    -DLLVM_DEFAULT_TARGET_TRIPLE=x86_64-unknown-linux-gnu \
    -DLLVM_ENABLE_THREADS=OFF -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_ZSTD=OFF \
    -DLLVM_BUILD_TOOLS=OFF -DLLVM_INCLUDE_TESTS=OFF \
    -DCLANG_ENABLE_ARCMT=OFF -DCLANG_ENABLE_STATIC_ANALYZER=OFF
  ninja -C "$out" -j "${PATCHTREE_BUILD_JOBS:-4}" patchtree-clang clang-resource-headers
  cp "$out/bin/patchtree-clang.js" "$out/bin/patchtree-clang.wasm" "$package/"
  tar --sort=name --mtime=@0 -czf "$package/clang-headers.tar.gz" -C "$out/lib/clang/21/include" .
  cp "$source/llvm/LICENSE.TXT" "$package/LICENSE-LLVM.txt"
  cp "$sdk/upstream/emscripten/LICENSE" "$package/LICENSE-Emscripten.txt"
  printf '%s\n' "$fingerprint" > "$package/clang-version"
}

case "${1:-all}" in
  typescript) build_typescript ;;
  clang) build_clang ;;
  all) (build_typescript); build_clang ;;
  *) exit 2 ;;
esac
