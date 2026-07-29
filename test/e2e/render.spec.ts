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

// Regression net for the diff-rendering + review path. Runs against the built
// extension with the GitHub adapter mocked; must stay green through the Solid
// rewrite of content.js/review.js.
import { test, expect, seedToken } from "./fixtures";
import { mockGithub, DIFF_URL, COMMENT_BODY } from "../fixtures/github";

test("renders the PR diff with tree, highlighting and a mocked thread", async ({
  context,
  page,
}) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");

  // file tree lists both files of the patch
  await expect(page.locator(".pt-tree-file")).toHaveCount(2);
  await expect(page.locator(".pt-tree-file", { hasText: "dra_test.go" })).toHaveCount(1);

  // syntax highlighting is applied by the background worker (async)
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  // the inline thread row; lazily rendered under content-visibility, so
  // scroll it in to verify
  const comment = page.locator(".pt-comments-row", { hasText: COMMENT_BODY }).first();
  await expect(comment).toBeAttached({ timeout: 20000 });
  await comment.scrollIntoViewIfNeeded();
  await expect(comment).toBeVisible();

  // with a token seeded the "add a token" hint must be gone
  await expect(page.getByText(/no GitHub token/i)).toHaveCount(0);
});

test("file tree filters by name", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-tree-file")).toHaveCount(2);

  await page.locator("#pt-filter").fill("dra_test");
  await expect(page.locator(".pt-tree-file:visible")).toHaveCount(1);
  await expect(page.locator(".pt-tree-file:visible")).toContainText("dra_test.go");

  await page.locator("#pt-filter").fill("");
  await expect(page.locator(".pt-tree-file:visible")).toHaveCount(2);
});

test("file header renders controls and the viewed checkbox folds the file", async ({
  context,
  page,
}) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  const first = page.locator("section.pt-file").first();

  await expect(first.locator(".pt-file-header button.pt-hbtn")).toBeVisible();
  await expect(first.locator(".pt-file-header .pt-stats")).toContainText("+");

  await expect(page.locator("#pt-progress")).toContainText("0/2 viewed");
  const viewedCb = first.locator("label.pt-viewed:not(.pt-fullfile) input[type=checkbox]");
  await viewedCb.check();
  await expect(first).toHaveClass(/pt-folded/);
  await expect(page.locator("#pt-progress")).toContainText("1/2 viewed");
});

test("expander loads hidden context lines", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const exp = page.locator(".pt-unified .pt-expander").first();
  await exp.scrollIntoViewIfNeeded();
  await exp.click();
  await expect(page.locator(".pt-unified tr.pt-exp").first()).toBeVisible({ timeout: 10000 });
});

test("shows word-diff marks and toggles to side-by-side", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  // intra-line word diff on the modified line pairs
  expect(await page.locator(".pt-word-add").count()).toBeGreaterThan(0);
  expect(await page.locator(".pt-word-del").count()).toBeGreaterThan(0);

  // inline by default, then switch to split
  await expect(page.locator(".pt-mode-unified")).toHaveCount(1);
  await page.locator('button[title="Side-by-side"]').click();
  await expect(page.locator(".pt-mode-split")).toHaveCount(1);
  await expect(page.locator(".pt-mode-unified")).toHaveCount(0);
});
