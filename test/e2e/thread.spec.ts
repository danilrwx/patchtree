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

test("an open reply form doesn't stretch the Resolve button beside it", async ({
  context,
  page,
}) => {
  const thread = await openThread(context, page);
  await thread.locator(".pt-reply-btn", { hasText: "Reply" }).click();

  const form = thread.locator(".pt-comment-form");
  await expect(form).toBeVisible();
  const resolve = thread.locator(".pt-reply-btn", { hasText: "Resolve" });
  const rb = (await resolve.boundingBox())!;
  const fb = (await form.boundingBox())!;
  // Resolve stays a normal-height button (the flex row used to stretch it to
  // the form's height), and wraps below the full-width form rather than beside it
  expect(rb.height).toBeLessThan(50);
  expect(rb.y).toBeGreaterThan(fb.y + fb.height - 24);
});

test("resolving a thread collapses it, and its notes are marked resolved", async ({
  context,
  page,
}) => {
  const thread = await openThread(context, page);
  await thread.locator(".pt-reply-btn", { hasText: "Resolve" }).click();

  // a resolved thread collapses to a one-line summary; expand it to review
  const collapsed = page.locator(".pt-thread-collapsed").first();
  await expect(collapsed).toBeVisible({ timeout: 10000 });
  await collapsed.click();

  await expect(page.locator(".pt-reply-btn", { hasText: "Unresolve" }).first()).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator(".pt-note.pt-resolved").first()).toBeVisible({ timeout: 10000 });
});

test("editing a note updates its body", async ({ context, page }) => {
  const thread = await openThread(context, page);
  const edited = "e2e: edited note body";

  await thread.locator('.pt-note-actions button[title="Edit"]').first().click();
  // entering edit mode swaps the note body for the form, so the body text (and
  // thus the COMMENT_BODY-filtered `thread` locator) is gone — target the note's
  // own edit form directly
  const ta = page.locator(".pt-note .pt-comment-form textarea").first();
  await expect(ta).toBeVisible();
  await ta.fill(edited);
  await page.locator(".pt-note .pt-comment-form button.pt-primary").first().click();

  await expect(page.locator(".pt-comments-row", { hasText: edited }).first()).toBeVisible({
    timeout: 10000,
  });
  await expect(page.locator(".pt-note-body", { hasText: COMMENT_BODY })).toHaveCount(0);
});

test("deleting a note removes it (arm then confirm)", async ({ context, page }) => {
  const thread = await openThread(context, page);
  await expect(page.locator(".pt-note-body", { hasText: COMMENT_BODY }).first()).toBeVisible();

  const del = thread.locator(".pt-note-actions button").nth(1); // edit, then delete
  await del.click(); // arm
  await del.click(); // confirm

  await expect(page.locator(".pt-note-body", { hasText: COMMENT_BODY })).toHaveCount(0, {
    timeout: 10000,
  });
});
