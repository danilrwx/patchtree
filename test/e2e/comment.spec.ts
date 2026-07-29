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

// Write path: opening the inline comment form on a line, submitting it, and
// seeing the posted comment render. Pins comment creation before the review
// layer is ported to Solid.
import { test, expect, seedToken } from "./fixtures";
import { mockGithubStateful, DIFF_URL } from "../fixtures/github";

test("posting a line comment renders it inline", async ({ context, page }) => {
  await mockGithubStateful(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const body = "e2e: comment posted through the inline form";

  // click a new-side line number to open the form
  const noCell = page.locator(".pt-unified tr.pt-add td.pt-no", { hasText: /\d/ }).first();
  await noCell.scrollIntoViewIfNeeded();
  await noCell.click();

  const ta = page.locator(".pt-comment-form textarea").first();
  await expect(ta).toBeVisible();
  await ta.fill(body);
  await page.locator(".pt-comment-form button.pt-primary").first().click();

  const comment = page.locator(".pt-comments-row", { hasText: body }).first();
  await expect(comment).toBeAttached({ timeout: 10000 });
  await comment.scrollIntoViewIfNeeded();
  await expect(comment).toBeVisible();
});

test("shift-click extends the comment range across lines", async ({ context, page }) => {
  await mockGithubStateful(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const cells = page.locator(".pt-unified tr.pt-add td.pt-no", { hasText: /\d/ });
  await cells.nth(0).scrollIntoViewIfNeeded();
  await cells.nth(0).click();
  await cells.nth(1).click({ modifiers: ["Shift"] });

  await expect(page.locator(".pt-inline-form .pt-comment-lines").first()).toContainText(
    "Comment on lines 63–64"
  );
  expect(await page.locator(".pt-unified tr.pt-range").count()).toBeGreaterThan(1);
});
