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

// Pure renames (no line changes) — the case that kept regressing: the header
// stays on one line with a "renamed" badge, and the body shows the path change
// as a word-highlighted old−/new+ diff.
import { test, expect, seedToken } from "./fixtures";
import { mockGithubRename, DIFF_URL } from "../fixtures/github";

test("a pure rename: one-line header + path shown as a word diff", async ({ context, page }) => {
  await mockGithubRename(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  // narrow enough that the long paths must truncate in the header
  await page.setViewportSize({ width: 900, height: 700 });

  const first = page.locator("section.pt-file").first();
  const header = first.locator(".pt-file-header");
  await expect(header).toBeVisible({ timeout: 20000 });

  // one line (a wrapped header would be ~2× tall)
  const box = await header.boundingBox();
  expect(box!.height).toBeLessThan(48);
  await expect(header.locator(".pt-rename")).toHaveText("renamed");

  // body: the old (−) and new (+) paths as a diff, with the change highlighted
  const nd = first.locator("table.pt-namediff");
  await expect(nd.locator("tr.pt-del")).toContainText("Files.App/Assets");
  await expect(nd.locator("tr.pt-add")).toContainText("Package");
  await expect(nd.locator("tr.pt-add .pt-word-add").first()).toBeVisible();
});
