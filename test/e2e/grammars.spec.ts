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

// Every added grammar must actually produce tokens: a query referencing node
// types the wasm doesn't have throws at load and silently renders plain text,
// which nothing else would catch.
import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";

const diff = readFileSync(path.join(__dirname, "../fixtures/grammars.diff"), "utf8");
const URL = "https://example.com/grammars.patch";

const CASES: [file: string, keyword: string][] = [
  ["app/main.dart", "class"],
  ["Jenkinsfile.groovy", "def"],
  ["src/main.zig", "const"],
  ["lib/inventory.ex", "defmodule"],
  ["app/Main.kt", "fun"],
  ["src/Main.scala", "object"],
  ["src/Main.hs", "module"],
];

test("added tree-sitter grammars and the markdown fallback produce tokens", async ({
  context,
  page,
}) => {
  await context.route(URL, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: diff })
  );
  await page.goto(URL);
  await expect(page.locator("section.pt-file")).toHaveCount(8);

  for (const [file, keyword] of CASES) {
    const section = page.locator("section.pt-file", { hasText: file });
    await expect(
      section.locator(".pt-keyword", { hasText: keyword }).first(),
      `${file}: keyword "${keyword}"`
    ).toBeVisible({ timeout: 20000 });
  }

  // markdown goes through the hljs fallback; the heading maps to a keyword
  const md = page.locator("section.pt-file", { hasText: "NOTES.md" });
  await expect(md.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });
});
