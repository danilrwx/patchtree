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

test("the tree's viewed box folds the file and drives the header box", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-tree-file:visible")).toHaveCount(2);

  const row = page.locator(".pt-tree-row").first();
  const path = await row.locator(".pt-tree-file").getAttribute("data-path");
  await row.locator(".pt-tree-check").check();

  const section = page.locator(`section.pt-file[data-path="${path}"]`);
  await expect(section).toHaveClass(/pt-folded/);
  await expect(section.locator("label.pt-viewed:not(.pt-fullfile) input")).toBeChecked();
  await expect(page.locator("#pt-progress")).toHaveAttribute("title", /1 of 2 files viewed/);

  await row.locator(".pt-tree-check").uncheck();
  await expect(page.locator("section.pt-file.pt-folded")).toHaveCount(0);
});

test("a folder's box marks every file under it and collapses it", async ({
  context,
  page,
}) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-tree-file:visible")).toHaveCount(2);

  const dirBox = page.locator("#pt-tree-list summary .pt-tree-check").last();
  const fileBoxes = page.locator(".pt-tree-row .pt-tree-check");

  // one file viewed leaves the folder box in the mixed state
  await fileBoxes.first().check();
  await expect(dirBox).not.toBeChecked();
  expect(await dirBox.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true);

  await dirBox.click();
  await expect(fileBoxes.first()).toBeChecked();
  await expect(fileBoxes.last()).toBeChecked();
  await expect(dirBox).toBeChecked();
  await expect(page.locator("#pt-progress")).toHaveAttribute("title", /2 of 2 files viewed/);
  // a folder that is done collapses; unmarking it opens back up
  const details = page.locator("#pt-tree-list details").last();
  await expect(details).not.toHaveAttribute("open", "");

  // the viewed set is read from storage after the tree mounts, so a reload has
  // to fold the folder again on its own
  await page.reload();
  await expect(page.locator("#pt-tree-list details").last()).not.toHaveAttribute("open", "");

  await page.locator("#pt-tree-list summary .pt-tree-check").last().click();
  await expect(page.locator(".pt-tree-row .pt-tree-check").first()).not.toBeChecked();
  await expect(page.locator(".pt-tree-row .pt-tree-check").last()).not.toBeChecked();
  await expect(page.locator("#pt-progress")).toHaveAttribute("title", /0 of 2 files viewed/);
  await expect(page.locator("#pt-tree-list details").last()).toHaveAttribute("open", "");
});

test("the current file highlights across the row, with a guide for its folder", async ({
  context,
  page,
}) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");

  const row = page.locator(".pt-tree-row").first();
  await row.locator(".pt-tree-file").click();
  await expect(row.locator(".pt-tree-file")).toHaveClass(/pt-active/);
  // park the pointer away from the tree, otherwise the row's hover fill is
  // what gets measured
  await page.mouse.move(900, 600);

  const style = await row.evaluate((el) => {
    const row = getComputedStyle(el);
    const btn = getComputedStyle(el.querySelector(".pt-tree-file")!);
    const guide = getComputedStyle(el.closest(".pt-tree-kids")!);
    return {
      rowBg: row.backgroundColor,
      btnBg: btn.backgroundColor,
      // the accent bar that used to sit left of the name is gone
      btnShadow: btn.boxShadow,
      guide: guide.borderLeftWidth,
    };
  });
  expect(style.rowBg).not.toBe("rgba(0, 0, 0, 0)");
  expect(style.btnBg).toBe("rgba(0, 0, 0, 0)");
  expect(style.btnShadow).toBe("none");
  expect(style.guide).toBe("1px");
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
