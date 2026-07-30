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

// highlight.js fallback: languages without a tree-sitter grammar still get
// syntax colors, and an extensionless file is auto-detected.
import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";

const diff = readFileSync(path.join(__dirname, "../fixtures/hljs.diff"), "utf8");
const URL = "https://example.com/hljs.patch";

test("a grammarless language falls back to highlight.js", async ({ context, page }) => {
  await context.route(URL, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: diff })
  );
  await page.goto(URL);

  const swift = page.locator("section.pt-file", { hasText: "Sources/App.swift" });
  await expect(swift.locator(".pt-keyword", { hasText: "func" }).first()).toBeVisible({
    timeout: 20000,
  });
  await expect(swift.locator(".pt-string").first()).toBeVisible();
});

test("an extensionless file is auto-detected", async ({ context, page }) => {
  await context.route(URL, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: diff })
  );
  await page.goto(URL);

  const sql = page.locator("section.pt-file", { hasText: "queries" });
  await expect(sql.locator(".pt-keyword", { hasText: "SELECT" }).first()).toBeVisible({
    timeout: 20000,
  });
});
