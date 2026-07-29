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

// PR metadata (title, CI, blob links, permalinks) plus the no-token read-only
// mode and the do-nothing path for a page that only looks like a diff URL.
import { test, expect, seedToken } from "./fixtures";
import { mockGithub, DIFF_URL } from "../fixtures/github";

test("the PR title and CI status are surfaced", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  await expect.poll(() => page.title()).toContain("fix dra nil handling");
  const ci = page.locator("#pt-ci");
  await expect(ci).toContainText("success");
  await expect(ci).toHaveAttribute("href", /\/checks$/);
});

test("each file links to its head revision", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const link = page.locator("section.pt-file .pt-blob-link").first();
  await expect(link).toHaveAttribute("href", /github\.com\/.+\/blob\/.+\/pkg\/.+dra\.go$/, {
    timeout: 20000,
  });
});

test("alt-clicking a line number copies a permalink", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const noCell = page.locator(".pt-unified td.pt-no", { hasText: /\d/ }).first();
  await noCell.scrollIntoViewIfNeeded();
  await noCell.click({ modifiers: ["Alt"] });
  await expect(page.locator("#pt-status")).toContainText("line link copied");
});

test("without a token the diff renders read-only with a hint", async ({ context, page }) => {
  await mockGithub(context);
  await page.goto(DIFF_URL);
  await expect(page.locator(".pt-tree-file")).toHaveCount(2, { timeout: 20000 });

  // the token hint shows and the Submit-review dropdown is never built
  await expect(page.locator("#pt-hint")).toContainText(/no GitHub token/i);
  await expect(page.locator("#pt-review")).toHaveCount(0);
});

test("a URL that looks like a diff but isn't leaves the page untouched", async ({
  context,
  page,
}) => {
  await context.route(DIFF_URL, (route) =>
    route.fulfill({
      contentType: "text/plain; charset=utf-8",
      body: "This is a plain README, not a diff.\nNothing to render here.\n",
    })
  );
  await page.goto(DIFF_URL);
  // give the content script a beat to decide not to mount
  await expect(page.locator("#pt-root")).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveClass(/pt-on/);
});
