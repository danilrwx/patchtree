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

// Fails if any source file is missing the Apache 2.0 license header. Keeps the
// per-file notice in sync with LICENSE without a heavyweight lint plugin.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";

const MARKER = "Licensed under the Apache License, Version 2.0";
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "vendor", "fonts", "queries", ".git"]);
const EXTS = new Set([".ts", ".tsx", ".js", ".mjs", ".css", ".html", ".sh"]);

function wanted(path) {
  return EXTS.has(extname(path)) || basename(path) === "Makefile";
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (wanted(p)) out.push(p);
  }
  return out;
}

const missing = walk(".").filter((p) => !readFileSync(p, "utf8").slice(0, 800).includes(MARKER));

if (missing.length) {
  console.error("Missing Apache 2.0 license header:");
  for (const p of missing) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`license headers ok (${walk(".").length} files)`);
