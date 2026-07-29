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

// Write path: opening the inline comment form on a line, submitting it, and
// seeing the posted comment render. Pins comment creation before the review
// layer is ported to Solid.
import { test, expect, seedToken } from "./fixtures";
import { mockGithubStateful, DIFF_URL, OWNER, REPO, NUM } from "../fixtures/github";

test("posting a line comment renders it inline", async ({ context, page }) => {
  await mockGithubStateful(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const body = "e2e: comment posted through the inline form";

  // click a new-side line number to open the form
  const noCell = page.locator(".pt-unified tr.pt-add td.pt-no", { hasText: /\d/ }).first();
  await noCell.scrollIntoViewIfNeeded();
  await noCell.click();

  const ta = page.locator(".pt-comment-form textarea").first();
  await expect(ta).toBeVisible();
  await ta.fill(body);
  await page.locator(".pt-comment-form button.pt-primary").first().click();

  const comment = page.locator(".pt-comments-row", { hasText: body }).first();
  await expect(comment).toBeAttached({ timeout: 10000 });
  await comment.scrollIntoViewIfNeeded();
  await expect(comment).toBeVisible();
});

test("posting a comment shows a spinner while waiting for the server", async ({
  context,
  page,
}) => {
  await mockGithubStateful(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  // delay the create request so the in-flight spinner is observable
  await page.route(
    `https://api.github.com/repos/${OWNER}/${REPO}/pulls/${NUM}/comments`,
    async (route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 800));
      await route.fallback();
    }
  );

  const noCell = page.locator(".pt-unified tr.pt-add td.pt-no", { hasText: /\d/ }).first();
  await noCell.scrollIntoViewIfNeeded();
  await noCell.click();
  const ta = page.locator(".pt-comment-form textarea").first();
  await ta.fill("e2e: spinner while posting");
  await page.locator(".pt-comment-form button.pt-primary").first().click();

  await expect(page.locator(".pt-comment-form button.pt-primary .pt-spin")).toBeVisible();
});

test("shift-click extends the comment range across lines", async ({ context, page }) => {
  await mockGithubStateful(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const cells = page.locator(".pt-unified tr.pt-add td.pt-no", { hasText: /\d/ });
  await cells.nth(0).scrollIntoViewIfNeeded();
  await cells.nth(0).click();
  await cells.nth(1).click({ modifiers: ["Shift"] });

  await expect(page.locator(".pt-inline-form .pt-comment-lines").first()).toContainText(
    "Comment on lines 63–64"
  );
  expect(await page.locator(".pt-unified tr.pt-range").count()).toBeGreaterThan(1);
});

test("dragging across line numbers selects a range", async ({ context, page }) => {
  await mockGithubStateful(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const cells = page.locator(".pt-unified tr.pt-add td.pt-no", { hasText: /\d/ });
  await cells.nth(0).scrollIntoViewIfNeeded();
  const a = (await cells.nth(0).boundingBox())!;
  const b = (await cells.nth(1).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();

  await expect(page.locator(".pt-inline-form .pt-comment-lines").first()).toContainText(
    "Comment on lines 63–64"
  );
  expect(await page.locator(".pt-unified tr.pt-range").count()).toBeGreaterThan(1);
});

test("the inline form offers a suggestion prefilled with the line", async ({ context, page }) => {
  await mockGithubStateful(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const noCell = page.locator(".pt-unified tr.pt-add td.pt-no", { hasText: /\d/ }).first();
  await noCell.scrollIntoViewIfNeeded();
  await noCell.click();

  const sug = page.locator(".pt-comment-form .pt-md-sug").first();
  await expect(sug).toBeVisible();
  await sug.click();
  const ta = page.locator(".pt-comment-form textarea").first();
  // GitHub uses a plain ```suggestion fence, NOT GitLab's ```suggestion:-N+0
  // (the :-N+0 header makes GitHub render it as a plain code block, not a suggestion)
  await expect(ta).toHaveValue(/```suggestion\n/);
  await expect(ta).not.toHaveValue(/suggestion:-/);
});

async function openForm(context: any, page: any) {
  await mockGithubStateful(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });
  const noCell = page.locator(".pt-unified tr.pt-add td.pt-no", { hasText: /\d/ }).first();
  await noCell.scrollIntoViewIfNeeded();
  await noCell.click();
  return page.locator(".pt-comment-form").first();
}

test("the Bold toolbar button wraps the selection", async ({ context, page }) => {
  const form = await openForm(context, page);
  const ta = form.locator("textarea");
  await ta.fill("abc");
  await ta.selectText();
  await form.locator(".pt-md-b").click();
  await expect(ta).toHaveValue("**abc**");
});

test("the Preview tab renders the markdown body", async ({ context, page }) => {
  const form = await openForm(context, page);
  await form.locator("textarea").fill("hello preview");
  await form.locator(".pt-form-tabs button", { hasText: "Preview" }).click();
  // the mocked /markdown endpoint wraps the text in <p>…</p>
  await expect(form.locator(".pt-form-preview")).toContainText("hello preview");
});

test("Cancel closes the inline form without posting", async ({ context, page }) => {
  const form = await openForm(context, page);
  await form.locator("button", { hasText: "Cancel" }).click();
  await expect(page.locator(".pt-comment-form")).toHaveCount(0);
});

test("a failed comment post surfaces an error and keeps the form open", async ({
  context,
  page,
}) => {
  const form = await openForm(context, page);
  // make the create request fail
  await page.route(
    `https://api.github.com/repos/${OWNER}/${REPO}/pulls/${NUM}/comments`,
    (route) =>
      route.request().method() === "POST"
        ? route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"boom"}' })
        : route.fallback()
  );

  await form.locator("textarea").fill("this will fail");
  await form.locator("button.pt-primary").click();

  const status = page.locator("#pt-status");
  await expect(status).toContainText(/comment failed/i);
  await expect(status).toHaveClass(/pt-error/);
  // the form stays open so the user doesn't lose their text
  await expect(form).toBeVisible();
});
