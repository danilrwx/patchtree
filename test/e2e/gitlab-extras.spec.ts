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

// GitLab-specific toolbar features: the per-commit diff selector and the
// ignore-whitespace toggle (GitHub exposes neither).
import { test, expect, seedToken } from "./fixtures";
import { mockGitlabExtras, DIFF_URL, TOKEN_HOST } from "../fixtures/gitlab";

test("picking a commit renders that commit's diff", async ({ context, page }) => {
  await mockGitlabExtras(context);
  await seedToken(context, page, DIFF_URL, TOKEN_HOST);
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const dd = page.locator("#pt-commits");
  await dd.locator("summary").click();
  await dd.locator(".pt-dd-item", { hasText: "isolated commit change" }).click();

  await expect(page.locator(".pt-tree-file", { hasText: "commit_only.go" })).toBeVisible({
    timeout: 10000,
  });
});

test("the ignore-whitespace toggle re-renders the diff", async ({ context, page }) => {
  await mockGitlabExtras(context);
  await seedToken(context, page, DIFF_URL, TOKEN_HOST);
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const gearSummary = page.locator('summary[title="Settings"]');
  const gear = page.locator("details.pt-dd").filter({ has: gearSummary });
  await gearSummary.click();
  await gear
    .locator(".pt-set-row", { hasText: "Ignore whitespace" })
    .locator("input[type=checkbox]")
    .evaluate((el: HTMLInputElement) => {
      el.checked = true;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });

  await expect(page.locator(".pt-tree-file", { hasText: "whitespace_clean.go" })).toBeVisible({
    timeout: 10000,
  });
});
