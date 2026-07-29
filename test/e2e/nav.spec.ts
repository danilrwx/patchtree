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

// Keyboard shortcuts (j/k/n/x/v/e//) and outside-click dropdown dismissal —
// the whole vim-style navigation surface a user drives without the mouse.
import { test, expect, seedToken } from "./fixtures";
import { mockGithub, DIFF_URL } from "../fixtures/github";

async function open(context: any, page: any) {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });
}

const toTop = (page: any) => page.evaluate(() => window.scrollTo(0, 0));

test("j and k scroll between files", async ({ context, page }) => {
  await open(context, page);
  await toTop(page);

  await page.keyboard.press("j");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

  const afterJ = await page.evaluate(() => window.scrollY);
  await page.keyboard.press("k");
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeLessThan(afterJ);
});

test("n centers the next thread", async ({ context, page }) => {
  await open(context, page);
  const row = page.locator(".pt-comments-row").first();
  // the review layer loads threads a macrotask after paint; scroll the row in so
  // content-visibility lays it out (offscreen threads are skipped by design)
  await expect(row).toBeAttached({ timeout: 20000 });
  await row.scrollIntoViewIfNeeded();
  await page.keyboard.press("n");
  // goCenter() flashes the thread it jumps to (transient .pt-flash class)
  await expect(page.locator(".pt-comments-row.pt-flash")).toBeVisible();
});

test("x folds and unfolds the current file", async ({ context, page }) => {
  await open(context, page);
  await toTop(page);
  const first = page.locator("section.pt-file").first();

  await page.keyboard.press("x");
  await expect(first).toHaveClass(/pt-folded/);
  await page.keyboard.press("x");
  await expect(first).not.toHaveClass(/pt-folded/);
});

test("v marks the current file viewed", async ({ context, page }) => {
  await open(context, page);
  await toTop(page);

  await page.keyboard.press("v");
  await expect(page.locator("section.pt-file").first()).toHaveClass(/pt-folded/);
  await expect(page.locator("#pt-progress")).toContainText("1/2 viewed");
});

test("e toggles the tree and / focuses the filter", async ({ context, page }) => {
  await open(context, page);
  const root = page.locator("#pt-root");

  await page.keyboard.press("e");
  await expect(root).toHaveClass(/pt-tree-hidden/);
  await page.keyboard.press("e");
  await expect(root).not.toHaveClass(/pt-tree-hidden/);

  await page.keyboard.press("/");
  await expect(page.locator("#pt-filter")).toBeFocused();
});

test("clicking outside an open dropdown closes it", async ({ context, page }) => {
  await open(context, page);
  const gearSummary = page.locator('summary[title="Settings"]');
  const gear = page.locator("details.pt-dd").filter({ has: gearSummary });
  await gearSummary.click();
  await expect(gear).toHaveJSProperty("open", true);

  await page.mouse.click(5, 400);
  await expect(gear).toHaveJSProperty("open", false);
});
