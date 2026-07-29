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

// The Submit-review dropdown: approve/unapprove, request changes, and plain
// comment reviews, plus the approved-by-you badge state.
import { test, expect, seedToken } from "./fixtures";
import { mockGithubStateful, DIFF_URL } from "../fixtures/github";

async function openReview(context: any, page: any) {
  await mockGithubStateful(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });
  const dd = page.locator("#pt-review");
  await dd.locator("summary").click();
  return dd;
}

test("approving shows the approved badge and flips the action to Unapprove", async ({
  context,
  page,
}) => {
  const dd = await openReview(context, page);
  await dd.locator("input[value=approve]").check();
  await dd.locator("button.pt-primary").click();

  await expect(page.locator("#pt-approved")).toBeVisible();
  await expect(dd).toContainText("Unapprove");
  await expect(page.locator("#pt-status")).toContainText("approved");
});

test("requesting changes posts a review", async ({ context, page }) => {
  const dd = await openReview(context, page);
  await dd.locator("input[value=request]").check();
  await dd.locator("button.pt-primary").click();

  await expect(page.locator("#pt-status")).toContainText("changes requested");
});

test("a plain comment review posts general feedback", async ({ context, page }) => {
  const dd = await openReview(context, page);
  // the "comment" action is selected by default
  await dd.locator("textarea").fill("overall looks good");
  await dd.locator("button.pt-primary").click();

  await expect(page.locator("#pt-status")).toContainText("comment posted");
});
