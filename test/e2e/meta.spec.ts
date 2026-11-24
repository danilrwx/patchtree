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
import { mockGithub, mockGithubRedCi, DIFF_URL } from "../fixtures/github";

test("the PR title and CI status are surfaced", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  await expect.poll(() => page.title()).toContain("fix dra nil handling");

  const ci = page.locator("#pt-ci");
  await expect(ci).toContainText("success");
  await expect(ci).toHaveAttribute("data-state", "success");
});

test("the CI badge opens into the jobs behind it", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");

  const ci = page.locator("#pt-ci");
  await expect(ci).toBeVisible({ timeout: 20000 });
  await ci.locator("summary").click();

  // check runs and the older commit statuses both show up, each with its state
  const jobs = ci.locator(".pt-job");
  await expect(jobs.filter({ hasText: "build" })).toContainText("success");
  await expect(jobs.filter({ hasText: "lint" })).toContainText("success");
  await expect(jobs.filter({ hasText: "legacy-ci" })).toBeAttached();
  await expect(ci.locator(".pt-job-all")).toContainText("full pipeline");
});

test("a red pipeline is called out where the approval is chosen", async ({ context, page }) => {
  await mockGithubRedCi(context);
  await seedToken(context, page, DIFF_URL, "github.com");

  const ci = page.locator("#pt-ci");
  await expect(ci).toHaveAttribute("data-state", "failed", { timeout: 20000 });

  const dd = page.locator("#pt-review");
  await dd.locator("summary").click();
  const approve = dd.locator("label.pt-radio", { has: page.locator("input[value=approve]") });
  await expect(approve.locator(".pt-ci-warn")).toContainText("failing");
  // warned, not blocked — the failure may be unrelated to the change
  await expect(dd.locator("input[value=approve]")).toBeEnabled();

  // the note must survive the approval state arriving, which rewrites the prose
  await page.waitForTimeout(1500);
  await expect(approve.locator(".pt-ci-warn")).toBeVisible();

  // and the failing job is marked in the badge's own list
  await ci.locator("summary").click();
  await expect(ci.locator('.pt-job-dot[data-state="failed"]')).toHaveCount(1);
});

test("the bar summarises who is merging what into where, and when", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const row = page.locator("#pt-branches");
  // the state chip is also the way back to the request
  const chip = row.locator(".pt-state");
  await expect(chip).toHaveText("Open");
  await expect(chip).toHaveAttribute("href", /\/pull\/\d+$/);

  await expect(row.locator(".pt-branch-author")).toHaveText("octocat");
  await expect(row.locator(".pt-branch-src")).toHaveText("feature");
  await expect(row.locator(".pt-branch-tgt")).toHaveText("main");
  // Intl wording varies by locale, so the timestamp tooltip is what we pin
  await expect(row.locator(".pt-branch-dim[title]")).toHaveAttribute("title", /2026/);

  await row.locator(".pt-branch-copy").click();
  await expect(page.locator("#pt-status")).toContainText("branch name copied");
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

test("public GitHub commits use raw diffs and a failed load keeps the displayed selection", async ({ context, page }) => {
  await mockGithub(context);
  const good = "a".repeat(40);
  const bad = "b".repeat(40);
  await context.route("https://api.github.com/repos/**/pulls/*/commits?**", (route) => route.fulfill({ json: [
    { sha: good, commit: { message: "Available commit" } },
    { sha: bad, commit: { message: "Unavailable commit" } },
  ] }));
  let apiAttempts = 0;
  await context.route("https://api.github.com/repos/**/commits/*", (route) => {
    apiAttempts++;
    return route.fulfill({ status: 403 });
  });
  await page.goto(DIFF_URL);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const commitBase = DIFF_URL.split("/pull/")[0];
  await worker.evaluate(({ commitBase, good, bad }) => {
    const get = globalThis.fetch.bind(globalThis);
    const diff = "diff --git a/commit.go b/commit.go\n--- a/commit.go\n+++ b/commit.go\n@@ -1 +1 @@\n-package old\n+package updated\n";
    globalThis.fetch = (input, init) => {
      if (String(input) === `${commitBase}/commit/${good}.diff`) return Promise.resolve(new Response(diff));
      if (String(input) === `${commitBase}/commit/${bad}.diff`) return Promise.resolve(new Response(null, { status: 404 }));
      return get(input, init);
    };
  }, { commitBase, good, bad });
  const menu = page.locator("#pt-commits");
  const selected = menu.locator("summary");
  await selected.click();
  await menu.getByText("Available commit", { exact: true }).click();
  await expect(page.locator("section.pt-file")).toHaveAttribute("data-path", "commit.go");
  await expect(selected).toContainText(good.slice(0, 8));
  await selected.click();
  await menu.getByText("Unavailable commit", { exact: true }).click();
  await expect(page.locator("#pt-status")).toContainText("HTTP 404");
  await expect(selected).toContainText(good.slice(0, 8));
  await expect(page.locator("section.pt-file")).toHaveAttribute("data-path", "commit.go");
  expect(apiAttempts).toBe(0);
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
