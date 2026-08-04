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

// Markdown is highlighted by three grammars at once: the block structure, the
// inline grammar injected into prose, and the language each fenced block names.
import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";

const diff = readFileSync(path.join(__dirname, "../fixtures/markdown.diff"), "utf8");
const URL = "https://example.com/markdown.patch";

test.beforeEach(async ({ context }) => {
  await context.route(URL, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: diff })
  );
});

// [class, text] pairs that only exist if the right grammar ran
const CASES: [what: string, cls: string, text: string][] = [
  ["heading", ".pt-keyword", "patchtree"],
  ["bold prose", ".pt-strong", "**raw diffs**"],
  ["italic prose", ".pt-em", "*emphasis*"],
  ["inline code", ".pt-string", "`tree-sitter`"],
  ["go keyword inside a fence", ".pt-keyword", "func"],
  ["go string inside a fence", ".pt-string", '"hello"'],
  ["yaml key inside a fence", ".pt-property", "replicas"],
  ["bash command inside a fence", ".pt-function", "make"],
];

test("markdown highlights prose and injects the fenced block's own language", async ({ page }) => {
  await page.goto(URL);
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  for (const [what, cls, text] of CASES)
    await expect(page.locator(`${cls}`, { hasText: text }).first(), what).toBeAttached({
      timeout: 20000,
    });
});

test("a fenced block is not smothered by the markdown block colour", async ({ page }) => {
  await page.goto(URL);
  const goLine = page.locator("tr.pt-add", { hasText: "const greeting" });
  await expect(goLine.locator(".pt-keyword", { hasText: "const" })).toBeAttached({
    timeout: 20000,
  });
  // the whole line must not be one span: the injection produced several
  await expect(goLine.locator("td.pt-code span[class^=pt-]")).not.toHaveCount(1);
});
