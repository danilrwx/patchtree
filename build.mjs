// MIT License
//
// Copyright (c) 2026 Daniil Antoshin
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
// Bundles the extension sources into dist/ (the loadable/zippable root) and
// copies the pinned assets in verbatim. Each entry resolves to whichever of
// .tsx/.ts/.js exists, so the Solid+TS rewrite can flip files one at a time
// without touching this script.
import { build } from "esbuild";
import { solidPlugin } from "esbuild-plugin-solid";
import { cp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

const OUT = "dist";
const HEADER = [
  "MIT License",
  "",
  "Copyright (c) 2026 Daniil Antoshin",
  "",
  "Permission is hereby granted, free of charge, to any person obtaining a copy",
  'of this software and associated documentation files (the "Software"), to deal',
  "in the Software without restriction, including without limitation the rights",
  "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
  "copies of the Software, and to permit persons to whom the Software is",
  "furnished to do so, subject to the following conditions:",
  "",
  "The above copyright notice and this permission notice shall be included in all",
  "copies or substantial portions of the Software.",
  "",
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
  "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
  "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
  "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
  "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
  "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE",
  "SOFTWARE.",
].map((l) => `// ${l}`.trimEnd()).join("\n");

// One output .js per entry. The service worker is an ES module (it imports
// web-tree-sitter); the content/options scripts are classic scripts. Until the
// rewrite merges them, content/providers/review stay separate window-bridged
// files, so they are not bundled together — flip `bundle` when a Solid entry
// starts importing its own modules.
const ENTRIES = [
  { name: "content", bundle: true },
  { name: "providers", bundle: false },
  { name: "review", bundle: true },
  { name: "options", bundle: true },
  { name: "background", bundle: false, format: "esm" },
];

// copied into dist/ unchanged; paths in manifest.json stay valid because the
// layout is preserved.
const ASSETS = [
  "manifest.json",
  "options.html",
  "viewer.css",
  "icons",
  "fonts",
  "vendor",
  "queries",
  "themes.json",
];

function resolveEntry(name) {
  for (const p of [`src/${name}.tsx`, `src/${name}.ts`, `${name}.tsx`, `${name}.ts`, `${name}.js`]) {
    if (existsSync(p)) return p;
  }
  throw new Error(`no source found for entry "${name}"`);
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

await Promise.all(
  ENTRIES.map(({ name, bundle = true, format = "iife" }) =>
    build({
      entryPoints: [resolveEntry(name)],
      outfile: `${OUT}/${name}.js`,
      bundle,
      format,
      target: "chrome110",
      charset: "utf8",
      banner: { js: HEADER },
      plugins: [solidPlugin()],
    })
  )
);

for (const a of ASSETS) {
  if (existsSync(a)) await cp(a, `${OUT}/${a}`, { recursive: true });
}

console.log(`built ${ENTRIES.length} entries + ${ASSETS.length} assets → ${OUT}/`);
