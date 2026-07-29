// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
// Regression net for the diff-rendering + review path. Runs against the built
// extension with the GitHub adapter mocked; must stay green through the Solid
// rewrite of content.js/review.js.
import { test, expect } from "./fixtures";
import { mockGithub, DIFF_URL, COMMENT_BODY } from "../fixtures/github";

test("renders the PR diff with tree, highlighting and a mocked thread", async ({
  context,
  page,
}) => {
  await mockGithub(context);
  await page.goto(DIFF_URL);

  // file tree lists both files of the patch
  await expect(page.locator(".pt-tree-file")).toHaveCount(2);
  await expect(page.locator(".pt-tree-file", { hasText: "dra_test.go" })).toHaveCount(1);

  // syntax highlighting is applied by the background worker (async)
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  // the mocked review thread renders inline
  await expect(page.getByText(COMMENT_BODY).first()).toBeVisible({ timeout: 20000 });
});
