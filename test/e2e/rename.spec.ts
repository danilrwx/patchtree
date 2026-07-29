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
// must stay on one line, show a "renamed" badge, and the hover tooltip must be
// visible with the old→new paths and the changed segment highlighted.
import { test, expect, seedToken } from "./fixtures";
import { mockGithubRename, DIFF_URL } from "../fixtures/github";

test("a pure rename stays on one line with a highlighted tooltip", async ({ context, page }) => {
  await mockGithubRename(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  // narrow enough that the long paths must truncate
  await page.setViewportSize({ width: 900, height: 700 });

  const header = page.locator("section.pt-file .pt-file-header").first();
  await expect(header).toBeVisible({ timeout: 20000 });

  // one line (a wrapped header would be ~2× tall)
  const box = await header.boundingBox();
  expect(box!.height).toBeLessThan(48);

  // rename badge, no wrapping old path on the row
  await expect(header.locator(".pt-rename")).toHaveText("renamed");

  // tooltip: hidden until hover, then the old→new with the change highlighted
  const tip = header.locator(".pt-tip");
  await expect(tip).toBeHidden();
  await header.hover();
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("Package");
  await expect(tip.locator("mark").first()).toBeVisible();
});
