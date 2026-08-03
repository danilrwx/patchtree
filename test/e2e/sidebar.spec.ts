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

// Sidebar: collapse toggle, extension filter, and per-status file styling.
import { test, expect, seedToken } from "./fixtures";
import { mockGithub, mockGithubRename, DIFF_URL } from "../fixtures/github";

test("collapse button toggles the file tree", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator("#pt-tree")).toBeVisible();

  await page.locator("#pt-collapse").click();
  await expect(page.locator("#pt-tree")).toBeHidden();

  await page.locator("#pt-collapse").click();
  await expect(page.locator("#pt-tree")).toBeVisible();

  // "e" hotkey toggles it too
  await page.locator("body").press("e");
  await expect(page.locator("#pt-tree")).toBeHidden();
  await page.locator("body").press("e");
  await expect(page.locator("#pt-tree")).toBeVisible();
});

test("the tree toggle is pinned far-left, ahead of the other bar controls", async ({
  context,
  page,
}) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");

  const bar = (await page.locator("#pt-bar").boundingBox())!;
  const toggle = (await page.locator("#pt-collapse").boundingBox())!;
  const commits = (await page.locator("#pt-commits").boundingBox())!;
  const seg = (await page.locator("#pt-bar .pt-seg").first().boundingBox())!;
  // toggle flush against the bar's left edge
  expect(toggle.x - bar.x).toBeLessThan(6);
  // review controls pack immediately after it — no big empty middle
  expect(commits.x - (toggle.x + toggle.width)).toBeLessThan(16);
  // adjacent controls sit one gap apart; order is commits → unresolved → branch
  const unresolved = (await page.locator("#pt-unresolved").boundingBox())!;
  expect(unresolved.x - (commits.x + commits.width)).toBeLessThan(12);
  const branches = (await page.locator("#pt-branches").boundingBox())!;
  expect(branches.x - (unresolved.x + unresolved.width)).toBeLessThan(12);
  // the diff summary + view-mode switch are pushed to the right
  expect(seg.x - (branches.x + branches.width)).toBeGreaterThan(40);
});

test("funnel menu filters the tree by extension", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-tree-file:visible")).toHaveCount(2);

  await page.locator(".pt-filter-dd > summary").click();
  await page.locator(".pt-filter-row", { hasText: ".go" }).locator("input").uncheck();
  await expect(page.locator(".pt-tree-file:visible")).toHaveCount(0);
});

test("renamed files carry the renamed status class", async ({ context, page }) => {
  await mockGithubRename(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-tree-file.pt-st-renamed").first()).toBeVisible();
});

test("the funnel can hide viewed files from the tree", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-tree-file:visible")).toHaveCount(2);

  // mark the first file viewed
  await page
    .locator("section.pt-file")
    .first()
    .locator("label.pt-viewed:not(.pt-fullfile) input[type=checkbox]")
    .check();

  await page.locator(".pt-filter-dd > summary").click();
  // the row sits at the bottom of a right-aligned menu that overlaps the diff
  // pane, so toggle the control directly and let its onChange drive the filter
  await page
    .locator(".pt-filter-row", { hasText: "Viewed files" })
    .locator("input")
    .evaluate((el: HTMLInputElement) => {
      el.checked = false;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  await expect(page.locator(".pt-tree-file:visible")).toHaveCount(1);
});

test("dragging the splitter resizes the file tree", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator("#pt-tree")).toBeVisible();

  const width = () => page.locator("#pt-tree").evaluate((el) => el.getBoundingClientRect().width);
  const before = await width();

  const sp = (await page.locator("#pt-splitter").boundingBox())!;
  await page.mouse.move(sp.x + sp.width / 2, sp.y + sp.height / 2);
  await page.mouse.down();
  await page.mouse.move(sp.x + 120, sp.y + sp.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect.poll(width).toBeGreaterThan(before + 60);
});
