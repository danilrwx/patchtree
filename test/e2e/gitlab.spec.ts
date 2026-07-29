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
