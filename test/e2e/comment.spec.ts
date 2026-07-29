// MIT License
//
// Copyright (c) 2026 Daniil Antoshin
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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
