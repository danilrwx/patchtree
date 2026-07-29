// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
// Same regression net as render.spec.ts, but for the GitLab adapter on a
// self-hosted host. Must stay green through the Solid rewrite.
import { test, expect, seedToken } from "./fixtures";
import { mockGitlab, DIFF_URL, TOKEN_HOST, COMMENT_BODY } from "../fixtures/gitlab";

test("renders a GitLab MR diff with tree, highlighting and a mocked thread", async ({
  context,
  page,
}) => {
  await mockGitlab(context);
  await seedToken(context, page, DIFF_URL, TOKEN_HOST);

  await expect(page.locator(".pt-tree-file")).toHaveCount(2);
  await expect(page.locator(".pt-tree-file", { hasText: "dra_test.go" })).toHaveCount(1);
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  // the inline thread row (not the toolbar's unresolved dropdown); lazily
  // rendered under content-visibility, so scroll it in to verify
  const comment = page.locator(".pt-comments-row", { hasText: COMMENT_BODY }).first();
  await expect(comment).toBeAttached({ timeout: 20000 });
  await comment.scrollIntoViewIfNeeded();
  await expect(comment).toBeVisible();

  // with a token seeded the "add a token" hint must be gone
  await expect(page.getByText(/no token for/i)).toHaveCount(0);
});
