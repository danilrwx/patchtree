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

// A ```suggestion``` comment renders as a widget showing the replaced (−) and
// proposed (+) lines, with an Apply button when a token is present.
import { test, expect, seedToken } from "./fixtures";
import {
  mockGithubSuggestion,
  mockGithubMultiSuggestion,
  DIFF_URL,
  SUGGESTION_TEXT,
} from "../fixtures/github";

test("a suggestion renders replaced and proposed lines", async ({ context, page }) => {
  await mockGithubSuggestion(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const sug = page.locator(".pt-sug").first();
  await expect(sug).toBeAttached({ timeout: 20000 });
  // proposed (+) line from the suggestion block
  await expect(sug.locator(".pt-sug-table tr.pt-add", { hasText: SUGGESTION_TEXT })).toHaveCount(1);
  // at least one replaced (−) line, reconstructed from the diff's new side
  await expect(sug.locator(".pt-sug-table tr.pt-del").first()).toBeVisible();
  // token present → Apply offered
  await expect(sug.locator("button", { hasText: "Apply suggestion" })).toBeVisible();
});

test("suggestion rows are code-height, not inflated by comment-cell padding", async ({
  context,
  page,
}) => {
  await mockGithubSuggestion(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  // each row is a single code line (~22px), not the ~40-76px the inherited
  // comment-cell padding produced — checked in both inline and side-by-side,
  // since split view has its own higher-specificity .pt-comments-row td padding
  const check = async () => {
    const rows = page.locator(".pt-sug:visible .pt-sug-table tr:visible");
    await expect(rows.first()).toBeVisible({ timeout: 20000 });
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const box = await rows.nth(i).boundingBox();
      expect(box!.height, `row ${i} height`).toBeLessThan(30);
    }
  };
  await check();
  await page.locator('button[title="Side-by-side"]').click();
  await check();
});

test("a GitHub multi-line suggestion replaces the whole comment range", async ({
  context,
  page,
}) => {
  await mockGithubMultiSuggestion(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const sug = page.locator(".pt-sug").first();
  await expect(sug).toBeAttached({ timeout: 20000 });
  // the range is startLine..line (62..63) from the comment, not the fence — so
  // two removed lines, not one
  await expect(sug.locator(".pt-sug-table tr.pt-del")).toHaveCount(2);
  await expect(sug.locator(".pt-sug-table tr.pt-add")).toHaveCount(2);
});

test("applying a suggestion commits it and marks the button Applied", async ({ context, page }) => {
  await mockGithubSuggestion(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const sug = page.locator(".pt-sug").first();
  await expect(sug).toBeAttached({ timeout: 20000 });
  await sug.scrollIntoViewIfNeeded();
  await sug.locator("button", { hasText: "Apply suggestion" }).click();

  await expect(sug.locator("button", { hasText: "Applied" })).toBeVisible();
  await expect(page.locator("#pt-status")).toContainText("suggestion applied");
});

test("dismissing a suggestion resolves the thread", async ({ context, page }) => {
  await mockGithubSuggestion(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const sug = page.locator(".pt-sug").first();
  await expect(sug).toBeAttached({ timeout: 20000 });
  await sug.scrollIntoViewIfNeeded();
  await sug.locator("button", { hasText: "Dismiss" }).click();

  await expect(page.locator("#pt-status")).toContainText("suggestion dismissed");
  await expect(sug.locator("button", { hasText: "Dismiss" })).toHaveCount(0);
});
