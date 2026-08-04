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

// A request's title and description occupy the slot a git-format patch uses for
// its commit message: what the change is about, above the diff.
import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, seedToken } from "./fixtures";
import { mockGithub, DIFF_URL } from "../fixtures/github";

test("the request title and description head the diff", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");

  const desc = page.locator("#pt-desc");
  const title = desc.locator(".pt-desc-title");
  await expect(title).toContainText("fix dra nil handling", { timeout: 20000 });
  await expect(title).toHaveAttribute("href", /\/pull\/\d+$/);

  // the body goes through the platform's markdown API, so it arrives as html
  const body = desc.locator(".pt-desc-body");
  await expect(body).toContainText("nil claim");
  await expect(await body.innerHTML()).toContain("<p>");

  // it sits above the first file, not somewhere below it
  const descBox = (await desc.boundingBox())!;
  const firstFile = (await page.locator("section.pt-file").first().boundingBox())!;
  expect(descBox.y).toBeLessThan(firstFile.y);
});

test("a patch without a provider still shows its own preamble", async ({ context, page }) => {
  const diff = readFileSync(path.join(__dirname, "../fixtures/plain.diff"), "utf8");
  const url = "https://example.com/plain.patch";
  await context.route(url, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: diff })
  );
  await page.goto(url);

  await expect(page.locator(".pt-file-header").first()).toBeVisible({ timeout: 20000 });
  // no request, so no request header — and the box must not leave an empty frame
  await expect(page.locator("#pt-desc .pt-desc-title")).toHaveCount(0);
  await expect(page.locator("#pt-desc")).toBeHidden();
});

test("a patch preamble is highlighted: headers, diffstat, links", async ({ context, page }) => {
  const patch = readFileSync(path.join(__dirname, "../fixtures/mbox.patch"), "utf8");
  const url = "https://example.com/mbox.patch";
  await context.route(url, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: patch })
  );
  await page.goto(url);

  const pre = page.locator("#pt-preamble");
  await expect(pre).toBeVisible({ timeout: 20000 });
  // header keys, the subject, the diffstat runs and the link all get their own
  // treatment instead of one grey block
  await expect(pre.locator(".pt-keyword", { hasText: "Subject:" })).toBeAttached();
  await expect(pre.locator(".pt-strong")).toContainText("[PATCH] Add support");
  await expect(pre.locator(".pt-property", { hasText: "config.def.h" })).toBeAttached();
  await expect(pre.locator(".pt-adds").first()).toBeAttached();
  await expect(pre.locator(".pt-dels").first()).toBeAttached();
  await expect(pre.locator("a")).toHaveAttribute("href", "https://github.com/mihirlad55/dwm-anybar");
});
