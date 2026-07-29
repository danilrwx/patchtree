// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
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
