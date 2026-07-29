// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
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
