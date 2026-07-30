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

// File-level and gear-menu actions: full-file expansion, fold-by-header-click,
// raw view, clear viewed, and jumping to files/comments from the tree.
import { test, expect, seedToken } from "./fixtures";
import { mockGithub, DIFF_URL } from "../fixtures/github";

async function open(context: any, page: any) {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });
}

// open the gear dropdown and return a locator for a menu item by its label
async function menu(page: any, label: string) {
  const summary = page.locator('summary[title="Settings"]');
  const gear = page.locator("details.pt-dd").filter({ has: summary });
  if (!(await gear.evaluate((el: HTMLDetailsElement) => el.open))) await summary.click();
  return gear.locator(".pt-dd-item", { hasText: label });
}

test("full file view hides hunks and expands the whole file", async ({ context, page }) => {
  await open(context, page);
  const first = page.locator("section.pt-file").first();

  await first.locator("label.pt-fullfile input[type=checkbox]").check();
  await expect(first).toHaveClass(/pt-hunks-hidden/);
  // the between-hunks gaps get filled with fetched context rows
  await expect(first.locator("tr.pt-exp").first()).toBeAttached({ timeout: 20000 });
});

test("clicking the file header folds and unfolds the file", async ({ context, page }) => {
  await open(context, page);
  const first = page.locator("section.pt-file").first();

  await first.locator(".pt-path-text").click();
  await expect(first).toHaveClass(/pt-folded/);
  await first.locator(".pt-path-text").click();
  await expect(first).not.toHaveClass(/pt-folded/);
});

test("raw view shows the unprocessed diff", async ({ context, page }) => {
  await open(context, page);
  await (await menu(page, "Raw view")).click();

  const raw = page.locator("#pt-raw");
  await expect(raw).toBeVisible();
  await expect(raw).toContainText("diff --git");
});

test("clear viewed unchecks every viewed file", async ({ context, page }) => {
  await open(context, page);
  const first = page.locator("section.pt-file").first();

  await first.locator("label.pt-viewed:not(.pt-fullfile) input[type=checkbox]").check();
  await expect(page.locator("#pt-progress")).toContainText("1/2 viewed");

  await (await menu(page, "Clear viewed")).click();
  await expect(page.locator("#pt-progress")).toContainText("0/2 viewed");
});

test("clicking a file in the tree scrolls to it", async ({ context, page }) => {
  await open(context, page);
  await page.evaluate(() => window.scrollTo(0, 0));

  await page.locator(".pt-tree-file", { hasText: "dra_test.go" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = document.querySelector('section[data-path*="dra_test.go"]');
        return s ? Math.abs(s.getBoundingClientRect().top) : 9999;
      })
    )
    .toBeLessThan(200);
});

test("clicking a file's comment badge jumps to the comment", async ({ context, page }) => {
  await open(context, page);
  // the badge only appears once threads load and markCommented runs
  const badge = page
    .locator(".pt-tree-file", { hasText: "dra.go" })
    .locator(".pt-tree-cmt");
  await expect(badge).toContainText("1", { timeout: 20000 });
  await badge.click();
  await expect(page.locator(".pt-comments-row.pt-flash")).toBeVisible();
});

test("collapse all / expand all folds every file", async ({ context, page }) => {
  await open(context, page);
  const files = page.locator("section.pt-file");
  const n = await files.count();

  await (await menu(page, "Collapse all files")).click();
  await expect(page.locator("section.pt-file.pt-folded")).toHaveCount(n);

  await (await menu(page, "Expand all files")).click();
  await expect(page.locator("section.pt-file.pt-folded")).toHaveCount(0);
});
