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
