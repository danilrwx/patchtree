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

# Fetch tree-sitter highlight queries from the grammar repositories, pinned
# to the tags matching the wasm versions in fetch-vendor.sh, and verify every
# file against its pinned sha256 — tags are mutable, hashes are not. After a
# version bump, PRINT_SUMS=1 FORCE=1 prints the new pins.
set -euo pipefail
cd "$(dirname "$0")/.."

RAW=https://raw.githubusercontent.com
SOURCES=(
  "go $RAW/tree-sitter/tree-sitter-go/v0.25.0/queries/highlights.scm 81182c986547eba7fa6316e82dfd621fb13b8fc89efac85432aee51a48ed0896"
  "javascript $RAW/tree-sitter/tree-sitter-javascript/v0.25.0/queries/highlights.scm d3630ae6dc9b2b27b230b5f8bb92b05cd491fb12bff353dae62a0a6d780461ee"
  "python $RAW/tree-sitter/tree-sitter-python/v0.25.0/queries/highlights.scm a6708f209381618e2b398972c8f1ccd892f0c064eab35a2a3f911c3e22e79a7e"
  "bash $RAW/tree-sitter/tree-sitter-bash/v0.25.1/queries/highlights.scm b74220d954f485b7626d2b2b61f37b522e12eb1830803e388e57dd797dc99f11"
  "json $RAW/tree-sitter/tree-sitter-json/v0.24.8/queries/highlights.scm 0511524465b56aed122580792254e68b6abbbfde7119f1d02b135acbe278233f"
  "rust $RAW/tree-sitter/tree-sitter-rust/v0.24.0/queries/highlights.scm 0f0343107f14a7690157f51090a979eb8f8bfe4eada7c61763ddb4c54b1311d1"
  "c $RAW/tree-sitter/tree-sitter-c/v0.24.1/queries/highlights.scm 3378d854dda695b2b282b9468247524ed4271ef74af691033d2e36883379409c"
  "css $RAW/tree-sitter/tree-sitter-css/v0.25.0/queries/highlights.scm 23f7948a3817a0d06d7120158c3bee4ec5b58daa77e524985a4738b364db17b2"
  "html $RAW/tree-sitter/tree-sitter-html/v0.23.2/queries/highlights.scm 1ebb3811a8cdc054385b847a3aac6fbf7079faefd5b3dfab5bbad256cd5afdcf"
  "typescript $RAW/tree-sitter/tree-sitter-typescript/v0.23.2/queries/highlights.scm e0c35adb819127bfd4f853fac5419e7d8ba44760246201d04a4a5ce0228a10c5"
  "yaml $RAW/helix-editor/helix/25.07.1/runtime/queries/yaml/highlights.scm db263ad9ae8ea8a7d1b0f1733bf184d96b3f80494b78a57e696c34bb0aafc8fb"
  "cpp $RAW/tree-sitter/tree-sitter-cpp/v0.23.4/queries/highlights.scm 52136576a9a9dacd9e95a8de0f351689bf46140738572ab4e9f24c9278e6b458"
  "java $RAW/tree-sitter/tree-sitter-java/v0.23.5/queries/highlights.scm 576c0df8df0b116cd642140ddc508c01f9d3283582afd8581c1f35caf4d71386"
  "ruby $RAW/tree-sitter/tree-sitter-ruby/v0.23.1/queries/highlights.scm 0858de9feece6dcd3408a541f995a34918d587ac2c552096026b0e47e2b332e6"
  "php $RAW/tree-sitter/tree-sitter-php/v0.24.2/queries/highlights.scm a2a7367659cff3b4be09961c8117d69a9b8703bfc266f8092e089b1760f197e9"
  "c_sharp $RAW/tree-sitter/tree-sitter-c-sharp/v0.23.5/queries/highlights.scm ab8a9930aeeee70fa2dbfde82e4763170b7e826bc642338ad0683772c20c060f"
  "lua $RAW/tree-sitter-grammars/tree-sitter-lua/v0.4.1/queries/highlights.scm 0ddb74b9e476d0b183a39a275dc9a6a370a69fb94bc9f7e6fac4c2cbe64f7b75"
  "toml $RAW/tree-sitter-grammars/tree-sitter-toml/v0.7.0/queries/highlights.scm 2fb5c61d33a70389312254c9c392e2c5dd6313d958d6e5f8f74cadd5e0811707"
  "hcl $RAW/helix-editor/helix/25.07.1/runtime/queries/hcl/highlights.scm cc077664af0244b3cf23e54f4878d1e6f1e9f5e73756fa304dba1e1be29ea859"
  "gotmpl $RAW/ngalaiko/tree-sitter-go-template/aa71f63de226c5592dfbfc1f29949522d7c95fac/queries/highlights.scm c2a819acc029dfa7cfb97d18137fd47dd4c2e691def5e5a16413c3b5ab57f02c"
  "dockerfile $RAW/camdencheek/tree-sitter-dockerfile/v0.2.0/queries/highlights.scm 665444fb7c8099602c78f9563525dedc23bb227fb0a6323820eb10be2592b318"
  "markdown $RAW/tree-sitter-grammars/tree-sitter-markdown/v0.5.3/tree-sitter-markdown/queries/highlights.scm 2eb06e766ccd672d49599d14f398f07f4f5f7f2208262993d3cd9207c1078e2f"
  "markdown_inline $RAW/tree-sitter-grammars/tree-sitter-markdown/v0.5.3/tree-sitter-markdown-inline/queries/highlights.scm 9a88072f0ce54972c32fe7952ccb2d29254b6a7228bda1c7babc18df15cba797"
  "zig $RAW/tree-sitter-grammars/tree-sitter-zig/v1.1.2/queries/highlights.scm 27a7ffc77086ec6394c04e59b42f0da4c9d3c294a0225bc155c80305ee54ca86"
  "elixir $RAW/elixir-lang/tree-sitter-elixir/v0.3.5/queries/highlights.scm 5ee9952a99ce2f0c3dcdf4478daf38f259dd8df4e7f9a892e9f1c03ccdf61ea6"
  "scala $RAW/tree-sitter/tree-sitter-scala/v0.24.0/queries/highlights.scm 8b3dc3bd20e05112854d3f4bd9a564fe53b762db89db9760d83d4f8e3828d0ab"
  "haskell $RAW/tree-sitter/tree-sitter-haskell/v0.23.1/queries/highlights.scm f8232b2c9b79ca3038c08c0b13602776019039d8e7668c60c18dcbc373c32e16"
  "kotlin $RAW/fwcd/tree-sitter-kotlin/0.3.8/queries/highlights.scm 2d74bb308bc589c2dadd9a599613f750f51470a8974190e09e24ec4786bab987"
  "dart https://unpkg.com/tree-sitter-dart@1.0.0/queries/highlights.scm 3c7a544590b20f73a485d63aa51d01692c1886800b21d3f9c071e95fffb9c809"
  "groovy $RAW/helix-editor/helix/25.07.1/runtime/queries/groovy/highlights.scm 18e12cd7b66a2070e426b372657a617f55e0abf4fe8ca8263dabbea60fdeaacd"
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
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for entry in "${SOURCES[@]}"; do
  read -r lang url want <<<"$entry"
  echo "$lang"
  curl -sfL "$url" -o "$tmp/$lang.scm"
  got=$(shasum -a 256 "$tmp/$lang.scm" | awk '{print $1}')
  if [ "${PRINT_SUMS:-}" = 1 ]; then
    echo "  $lang $got"
    continue
  fi
  if [ "$got" != "$want" ]; then
    echo "sha256 mismatch for $lang: expected $want, got $got" >&2
    exit 1
  fi
  mv "$tmp/$lang.scm" "assets/queries/$lang.scm"
done
echo "assets/queries/ done"
