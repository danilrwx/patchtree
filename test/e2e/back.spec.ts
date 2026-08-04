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

// The way back from a raw diff to the request it belongs to: a real link in the
// toolbar carrying the request title.
import { test, expect, seedToken } from "./fixtures";
import { mockGithub, DIFF_URL, OWNER, REPO, NUM } from "../fixtures/github";
import {
  mockGitlab,
  DIFF_URL as GL_DIFF_URL,
  TOKEN_HOST as GL_HOST,
  HOST,
  PROJECT,
  IID,
} from "../fixtures/gitlab";
import { readFileSync } from "node:fs";
import path from "node:path";

test("the state chip links back to the pull request", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");

  const back = page.locator("#pt-branches .pt-state");
  await expect(back).toBeVisible({ timeout: 20000 });
  await expect(back).toHaveAttribute(
    "href",
    `https://github.com/${OWNER}/${REPO}/pull/${NUM}`
  );
  await expect(back).toHaveText("Open");
  await expect(back).toHaveAttribute("title", /Back to the pull request/);
});

test("on GitLab the state chip links to the merge request", async ({ context, page }) => {
  await mockGitlab(context);
  await seedToken(context, page, GL_DIFF_URL, GL_HOST);

  const back = page.locator("#pt-branches .pt-state");
  await expect(back).toBeVisible({ timeout: 20000 });
  await expect(back).toHaveAttribute("href", `${HOST}/${PROJECT}/-/merge_requests/${IID}`);
  await expect(back).toHaveAttribute("title", /Back to the merge request/);
});

test("a plain patch with no provider has no request summary", async ({ context, page }) => {
  const diff = readFileSync(path.join(__dirname, "../fixtures/plain.diff"), "utf8");
  const url = "https://example.com/plain.patch";
  await context.route(url, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: diff })
  );
  await page.goto(url);

  await expect(page.locator(".pt-file-header").first()).toBeVisible({ timeout: 20000 });
  await expect(page.locator("#pt-branches")).toHaveCount(0);
});
