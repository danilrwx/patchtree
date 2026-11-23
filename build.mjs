// Copyright 2026 Daniil Antoshin
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Bundles the extension sources into dist/ (the loadable/zippable root) and
// copies the pinned assets in verbatim. Each entry resolves to whichever of
// .tsx/.ts/.js exists, so the Solid+TS rewrite can flip files one at a time
// without touching this script.
import { build } from "esbuild";
import { solidPlugin } from "esbuild-plugin-solid";
import { cp, rm, mkdir, readdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const OUT = "dist";
const HEADER = [
  "Copyright 2026 Daniil Antoshin",
  "",
  'Licensed under the Apache License, Version 2.0 (the "License");',
  "you may not use this file except in compliance with the License.",
  "You may obtain a copy of the License at",
  "",
  "    http://www.apache.org/licenses/LICENSE-2.0",
  "",
  "Unless required by applicable law or agreed to in writing, software",
  'distributed under the License is distributed on an "AS IS" BASIS,',
  "WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.",
  "See the License for the specific language governing permissions and",
  "limitations under the License.",
].map((l) => `// ${l}`.trimEnd()).join("\n");

// One output .js per entry. content bundles the whole extension UI (providers
// and the review controller are now imported, not separate window-bridged
// scripts); the service worker bundles too (highlight.js), keeping the
// vendored web-tree-sitter loader external so its runtime-relative path in
// dist/ survives.
const ENTRIES = [
  { name: "content", bundle: true },
  { name: "oauth-page", bundle: true },
  { name: "background", bundle: true, format: "esm", external: ["./assets/vendor/web-tree-sitter.js"] },
  { name: "index-worker", bundle: true, format: "esm", external: ["./assets/code-index/wasm_exec.js"] },
  { name: "index-offscreen", bundle: true, format: "esm" },
];

// copied into dist/ unchanged; paths in manifest.json stay valid because the
// layout is preserved.
// only the manifest sits at the dist root; everything else (fetched deps,
// icons, viewer.css, options.html) lives under assets/, mirrored to dist/assets/
const ASSETS = ["manifest.json", "oauth.html", "index-offscreen.html", "assets"];

function resolveEntry(name) {
  for (const p of [`src/${name}.tsx`, `src/${name}.ts`, `${name}.tsx`, `${name}.ts`, `${name}.js`]) {
    if (existsSync(p)) return p;
  }
  throw new Error(`no source found for entry "${name}"`);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const a of ASSETS) {
  if (existsSync(a)) await cp(a, `${OUT}/${a}`, { recursive: true });
}

const wasmDir = resolve(OUT, "assets/code-index");
await mkdir(wasmDir, { recursive: true });
for (const name of await readdir("build/indexers")) {
  if (name !== "clang-version") await cp(`build/indexers/${name}`, resolve(wasmDir, name));
}
const codeIndexDir = process.env.PATCHTREE_CODE_INDEX_DIR || "tools/code-index";
execFileSync("go", ["build", "-C", codeIndexDir, "-trimpath", "-ldflags=-s -w", "-o", resolve(wasmDir, "code-index.wasm"), "."], {
  env: { ...process.env, GOOS: "js", GOARCH: "wasm", CGO_ENABLED: "0", GOWORK: "off" },
  stdio: "inherit",
});
const goRoot = execFileSync("go", ["env", "GOROOT"], { encoding: "utf8" }).trim();
await cp(resolve(goRoot, "lib/wasm/wasm_exec.js"), resolve(wasmDir, "wasm_exec.js"));

const version = createHash("sha256");
for (const name of (await readdir(wasmDir)).sort()) version.update(readFileSync(resolve(wasmDir, name)));
for (const name of ["index-worker", "index-language", "clang-index", "typescript-index", "snapshot", "navigation-map"])
  version.update(readFileSync(`src/${name}.ts`));
const indexVersion = version.digest("hex");

await Promise.all(
  ENTRIES.map(({ name, bundle = true, format = "iife", external = [] }) =>
    build({
      entryPoints: [resolveEntry(name)],
      outfile: `${OUT}/${name}.js`,
      bundle,
      format,
      external,
      target: "chrome110",
      charset: "utf8",
      define: {
        PATCHTREE_INDEX_VERSION: JSON.stringify(indexVersion),
        PATCHTREE_GITHUB_CLIENT_ID: JSON.stringify(process.env.PATCHTREE_GITHUB_CLIENT_ID ?? ""),
        PATCHTREE_GITLAB_CLIENT_ID: JSON.stringify(process.env.PATCHTREE_GITLAB_CLIENT_ID ?? ""),
      },
      banner: { js: HEADER },
      plugins: [solidPlugin()],
    })
  )
);

console.log(`built ${ENTRIES.length} entries + ${ASSETS.length} assets → ${OUT}/`);
