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

// The shortcuts overlay ("?" and the gear item), the "s" view-mode hotkey and
// the sidebar toggle's on/off state.
import { test, expect, seedToken } from "./fixtures";
import { mockGithub, DIFF_URL } from "../fixtures/github";

async function key(page: import("@playwright/test").Page, init: KeyboardEventInit) {
  await page.evaluate(
    (k) => document.body.dispatchEvent(new KeyboardEvent("keydown", { ...k, bubbles: true })),
    init
  );
}

test("? opens the shortcuts overlay, Escape closes it", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  await key(page, { code: "Slash", key: "?", shiftKey: true });
  const dialog = page.locator("#pt-keymap-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".pt-dialog")).toBeInViewport();
  await expect(dialog.locator("kbd", { hasText: "j" }).first()).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the gear menu opens the shortcuts overlay", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  await page.locator("#pt-settings > summary").click();
  await page.locator("#pt-settings .pt-dd-item", { hasText: "Keyboard shortcuts" }).click();
  await expect(page.locator("#pt-keymap-dialog")).toBeVisible();
});

test("s toggles inline and side-by-side", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const root = page.locator("#pt-root");
  await expect(root).toHaveClass(/pt-mode-unified/);
  await key(page, { code: "KeyS", key: "s" });
  await expect(root).toHaveClass(/pt-mode-split/);
  await key(page, { code: "KeyS", key: "s" });
  await expect(root).toHaveClass(/pt-mode-unified/);
});

test("the sidebar toggle shows its on/off state", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const btn = page.locator("#pt-collapse");
  await expect(btn).toHaveClass(/pt-active/);
  await btn.click();
  await expect(btn).not.toHaveClass(/pt-active/);
  await expect(page.locator("#pt-tree")).toBeHidden();
  await btn.click();
  await expect(btn).toHaveClass(/pt-active/);
});
