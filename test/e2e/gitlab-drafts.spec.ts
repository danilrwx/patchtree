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

// GitLab-only pending-review drafts: add to review, discard, and publish via
// Submit review. GitHub has no draft-notes API, so this path is GitLab-specific.
import { test, expect, seedToken } from "./fixtures";
import { mockGitlabStateful, DIFF_URL, TOKEN_HOST, DRAFT_BODY } from "../fixtures/gitlab";

test("Add to review creates a draft and bumps the review count", async ({ context, page }) => {
  await mockGitlabStateful(context);
  await seedToken(context, page, DIFF_URL, TOKEN_HOST);
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const noCell = page.locator(".pt-unified tr.pt-add td.pt-no", { hasText: /\d/ }).first();
  await noCell.scrollIntoViewIfNeeded();
  await noCell.click();

  const form = page.locator(".pt-comment-form").first();
  await form.locator("textarea").fill("draft feedback");
  await form.locator("button", { hasText: "Add to review" }).click();

  await expect(page.locator("#pt-review summary")).toContainText("1");
});

test("a pending draft renders and can be discarded", async ({ context, page }) => {
  await mockGitlabStateful(context, { seedDraft: true });
  await seedToken(context, page, DIFF_URL, TOKEN_HOST);
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const draft = page.locator(".pt-comments-row", { hasText: DRAFT_BODY }).first();
  await expect(draft).toBeAttached({ timeout: 20000 });
  await draft.scrollIntoViewIfNeeded();
  await expect(draft.locator(".pt-badge-pending")).toBeVisible();
  await expect(page.locator("#pt-review summary")).toContainText("1");

  await draft.locator(".pt-draft-del").click();
  await expect(page.locator(".pt-comments-row", { hasText: DRAFT_BODY })).toHaveCount(0, {
    timeout: 10000,
  });
});

test("submitting the review publishes pending drafts", async ({ context, page }) => {
  await mockGitlabStateful(context, { seedDraft: true });
  await seedToken(context, page, DIFF_URL, TOKEN_HOST);
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator(".pt-comments-row", { hasText: DRAFT_BODY }).first()).toBeAttached({
    timeout: 20000,
  });

  const dd = page.locator("#pt-review");
  await dd.locator("summary").click();
  await dd.locator("button.pt-primary").click();

  // publishing clears the drafts, so the pending note is gone after refresh
  await expect(page.locator(".pt-comments-row", { hasText: DRAFT_BODY })).toHaveCount(0, {
    timeout: 10000,
  });
});
