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

// General (non-line) discussion block and the unresolved-threads dropdown that
// lets a reviewer jump between open threads.
import { test, expect, seedToken } from "./fixtures";
import { mockGithub, mockGithubDiscussion, DIFF_URL, DISCUSSION_BODY } from "../fixtures/github";

test("the unresolved dropdown lists open threads and jumps to one", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const dd = page.locator("#pt-unresolved");
  await expect(dd).toContainText("1 unresolved", { timeout: 20000 });
  await dd.locator("summary").click();
  await dd.locator(".pt-dd-item").first().click();

  // jumping to the thread flashes its row
  await expect(page.locator(".pt-comments-row.pt-flash")).toBeVisible();
});

test("the general discussion block renders and accepts a reply", async ({ context, page }) => {
  await mockGithubDiscussion(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const block = page.locator("#pt-mr-threads");
  await expect(block).toContainText("Discussion (1)", { timeout: 20000 });
  await expect(block).toContainText(DISCUSSION_BODY);

  await block.locator(".pt-reply-btn", { hasText: "Reply" }).click();
  const reply = "e2e: replying to the general discussion";
  await block.locator(".pt-comment-form textarea").fill(reply);
  await block.locator(".pt-comment-form button.pt-primary").click();

  await expect(block).toContainText(reply, { timeout: 10000 });
});
