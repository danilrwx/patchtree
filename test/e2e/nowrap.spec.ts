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

// nowrap in split view: each pane scrolls its long lines horizontally, and the
// two panes stay in sync (driven by a per-pane sticky scrollbar).
import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";

const diff = readFileSync(path.join(__dirname, "../fixtures/longsplit.diff"), "utf8");
const URL = "https://example.com/longsplit.diff";

async function enableNowrapSplit(page: any) {
  await page.locator('button[title="Side-by-side"]').click();
  await page.locator('summary[title="Settings"]').click();
  await page.locator(".pt-set-row", { hasText: "Wrap long lines" }).locator("input[type=checkbox]").uncheck();
  await page.waitForTimeout(200);
}

test("split nowrap: panes scroll horizontally and in sync", async ({ context, page }) => {
  await context.route(URL, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: diff })
  );
  await page.setViewportSize({ width: 900, height: 500 });
  await page.goto(URL);
  await enableNowrapSplit(page);

  // the old pane's scrollbar rail spans the full (unwrapped) line width
  const railSp = await page.evaluate(
    () => (document.querySelector('.pt-rail[data-rail="old"] .pt-rail-sp') as HTMLElement).offsetWidth
  );
  expect(railSp).toBeGreaterThan(1000);

  // scrolling one long line pans the WHOLE pane (short lines too) and syncs the
  // other pane to the same offset — not just the couple of overflowing rows
  const r = await page.evaluate(() => {
    const olds = [...document.querySelectorAll('.pt-hs[data-hs="old"]:not(.pt-void)')] as HTMLElement[];
    const news = [...document.querySelectorAll('.pt-hs[data-hs="new"]')] as HTMLElement[];
    const long = olds.find((e) => e.scrollWidth > e.clientWidth)!;
    long.scrollLeft = 200;
    long.dispatchEvent(new Event("scroll"));
    const shortRow = olds.find((e) => e.textContent?.includes("package f"))!;
    const otherPane = news.find((e) => e.scrollWidth > e.clientWidth)!;
    return { long: long.scrollLeft, short: shortRow.scrollLeft, other: otherPane.scrollLeft };
  });
  // the short "package f" row was widened to the column max, so it pans too
  expect(r.short).toBe(200);
  expect(r.long).toBe(200);
  // and the new pane follows in sync
  expect(r.other).toBe(200);
});
