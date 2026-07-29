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
// Thread interactions (reply, resolve) against a stateful mock. Nets these
// paths before the review layer is ported to Solid.
import { test, expect, seedToken } from "./fixtures";
import { mockGithubThreads, DIFF_URL, COMMENT_BODY } from "../fixtures/github";

async function openThread(context: any, page: any) {
  await mockGithubThreads(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });
  const thread = page.locator(".pt-comments-row", { hasText: COMMENT_BODY }).first();
  await expect(thread).toBeAttached({ timeout: 20000 });
  await thread.scrollIntoViewIfNeeded();
  return thread;
}

test("replying to a thread renders the reply", async ({ context, page }) => {
  const thread = await openThread(context, page);
  const reply = "e2e: a reply to the thread";

  await thread.locator(".pt-reply-btn", { hasText: "Reply" }).click();
  const ta = thread.locator(".pt-comment-form textarea").first();
  await expect(ta).toBeVisible();
  await ta.fill(reply);
  await thread.locator(".pt-comment-form button.pt-primary").first().click();

  await expect(page.locator(".pt-comments-row", { hasText: reply }).first()).toBeVisible({
    timeout: 10000,
  });
});

test("resolving a thread marks its notes resolved", async ({ context, page }) => {
  const thread = await openThread(context, page);
  await thread.locator(".pt-reply-btn", { hasText: "Resolve" }).click();
  await expect(page.locator(".pt-reply-btn", { hasText: "Unresolve" }).first()).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator(".pt-note.pt-resolved").first()).toBeVisible({ timeout: 10000 });
});
