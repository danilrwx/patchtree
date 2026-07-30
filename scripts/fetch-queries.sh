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

# Fetch tree-sitter highlight queries from the grammar repositories,
# pinned to the tags matching the wasm versions in fetch-vendor.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

RAW=https://raw.githubusercontent.com
SOURCES=(
  "go $RAW/tree-sitter/tree-sitter-go/v0.25.0/queries/highlights.scm"
  "javascript $RAW/tree-sitter/tree-sitter-javascript/v0.25.0/queries/highlights.scm"
  "python $RAW/tree-sitter/tree-sitter-python/v0.25.0/queries/highlights.scm"
  "bash $RAW/tree-sitter/tree-sitter-bash/v0.25.1/queries/highlights.scm"
  "json $RAW/tree-sitter/tree-sitter-json/v0.24.8/queries/highlights.scm"
  "rust $RAW/tree-sitter/tree-sitter-rust/v0.24.0/queries/highlights.scm"
  "c $RAW/tree-sitter/tree-sitter-c/v0.24.1/queries/highlights.scm"
  "css $RAW/tree-sitter/tree-sitter-css/v0.25.0/queries/highlights.scm"
  "html $RAW/tree-sitter/tree-sitter-html/v0.23.2/queries/highlights.scm"
  "typescript $RAW/tree-sitter/tree-sitter-typescript/v0.23.2/queries/highlights.scm"
  "yaml $RAW/helix-editor/helix/25.07.1/runtime/queries/yaml/highlights.scm"
  "cpp $RAW/tree-sitter/tree-sitter-cpp/v0.23.4/queries/highlights.scm"
  "java $RAW/tree-sitter/tree-sitter-java/v0.23.5/queries/highlights.scm"
  "ruby $RAW/tree-sitter/tree-sitter-ruby/v0.23.1/queries/highlights.scm"
  "php $RAW/tree-sitter/tree-sitter-php/v0.24.2/queries/highlights.scm"
  "c_sharp $RAW/tree-sitter/tree-sitter-c-sharp/v0.23.5/queries/highlights.scm"
  "lua $RAW/tree-sitter-grammars/tree-sitter-lua/v0.4.1/queries/highlights.scm"
  "toml $RAW/tree-sitter-grammars/tree-sitter-toml/v0.7.0/queries/highlights.scm"
  "hcl $RAW/helix-editor/helix/25.07.1/runtime/queries/hcl/highlights.scm"
  "gotmpl $RAW/ngalaiko/tree-sitter-go-template/aa71f63de226c5592dfbfc1f29949522d7c95fac/queries/highlights.scm"
  "dockerfile $RAW/camdencheek/tree-sitter-dockerfile/v0.2.0/queries/highlights.scm"
  "zig $RAW/tree-sitter-grammars/tree-sitter-zig/v1.1.2/queries/highlights.scm"
  "elixir $RAW/elixir-lang/tree-sitter-elixir/v0.3.5/queries/highlights.scm"
  "scala $RAW/tree-sitter/tree-sitter-scala/v0.24.0/queries/highlights.scm"
  "haskell $RAW/tree-sitter/tree-sitter-haskell/v0.23.1/queries/highlights.scm"
  "kotlin $RAW/fwcd/tree-sitter-kotlin/0.3.8/queries/highlights.scm"
  "dart https://unpkg.com/tree-sitter-dart@1.0.0/queries/highlights.scm"
  "groovy $RAW/helix-editor/helix/25.07.1/runtime/queries/groovy/highlights.scm"
)

if [ "${FORCE:-}" != "1" ]; then
  missing=0
  for entry in "${SOURCES[@]}"; do [ -s "assets/queries/${entry%% *}.scm" ] || missing=1; done
  if [ "$missing" = 0 ]; then
    echo "assets/queries/ up to date (FORCE=1 to refetch)"
    exit 0
  fi
fi

mkdir -p assets/queries
for entry in "${SOURCES[@]}"; do
  lang=${entry%% *}
  url=${entry#* }
  echo "$lang"
  curl -sfL "$url" -o "assets/queries/$lang.scm"
done
echo "assets/queries/ done"
