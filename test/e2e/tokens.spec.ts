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

// The ⚙ → Access tokens overlay loads the stored token, edits and closes.
import { test, expect, seedToken } from "./fixtures";
import { mockGithub, DIFF_URL } from "../fixtures/github";

test("access tokens dialog loads and closes", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  await page.locator("#pt-settings > summary").click();
  await page.locator("#pt-settings .pt-dd-item", { hasText: "Access tokens" }).click();

  const dialog = page.locator("#pt-tokens-dialog");
  await expect(dialog).toBeVisible();
  // visible is not enough: without its fixed-overlay CSS the dialog rendered
  // in-flow at the very bottom of the page, off-screen
  await expect(dialog.locator(".pt-dialog")).toBeInViewport();
  const overlay = await dialog.evaluate((el) => getComputedStyle(el).position);
  expect(overlay).toBe("fixed");
  // the GitHub token seeded into storage is loaded back into the form
  await expect(dialog.locator(".pt-tokens input[type=password]").last()).toHaveValue("e2e-token");

  // add a GitLab instance row, then close
  await dialog.locator(".pt-token-add").click();
  await expect(dialog.locator(".pt-tokens-table tr")).toHaveCount(2);
  await dialog.locator("button.pt-primary", { hasText: "Done" }).click();
  await expect(dialog).toBeHidden();
});
