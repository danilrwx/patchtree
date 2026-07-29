// MIT License
//
// Copyright (c) 2026 Daniil Antoshin
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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
