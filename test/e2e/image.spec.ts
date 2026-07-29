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

// A binary image change renders old/new previews instead of "binary file".
import { test, expect, seedToken } from "./fixtures";
import { mockGithubImage, mockGithubAddedImage, DIFF_URL } from "../fixtures/github";

test("a binary image file shows old and new previews", async ({ context, page }) => {
  await mockGithubImage(context);
  await seedToken(context, page, DIFF_URL, "github.com");

  const preview = page.locator(".pt-img-diff");
  await expect(preview).toBeAttached({ timeout: 20000 });
  // both revisions load as data: URLs (modified file → old + new)
  const imgs = preview.locator("img");
  await expect(imgs).toHaveCount(2);
  await expect(imgs.first()).toHaveAttribute("src", /^data:image\/png;base64,/);
  await expect(page.locator(".pt-binary")).toHaveCount(0);
});

test("an added binary image shows only the new preview", async ({ context, page }) => {
  await mockGithubAddedImage(context);
  await seedToken(context, page, DIFF_URL, "github.com");

  const preview = page.locator(".pt-img-diff");
  await expect(preview).toBeAttached({ timeout: 20000 });
  await expect(preview.locator(".pt-img-new img")).toHaveCount(1);
  await expect(preview.locator(".pt-img-old")).toHaveCount(0);
});
