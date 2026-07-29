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

// The ⚙ → Theme gallery overlay renders scheme previews, filters them and
// applies one on click.
import { test, expect, seedToken } from "./fixtures";
import { mockGithub, DIFF_URL } from "../fixtures/github";

test("theme gallery opens, filters and applies", async ({ context, page }) => {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  await page.locator("#pt-settings > summary").click();
  await page.locator("#pt-settings .pt-dd-item", { hasText: "Theme gallery" }).click();

  const dialog = page.locator("#pt-themes-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".pt-theme-card").first()).toBeVisible();
  const before = await dialog.locator(".pt-theme-card").count();

  await dialog.locator('input[type="search"]').fill("gruvbox");
  await expect(dialog.locator(".pt-theme-card").first()).toBeVisible();
  expect(await dialog.locator(".pt-theme-card").count()).toBeLessThan(before);

  await dialog.locator(".pt-theme-card").first().click();
  await expect(dialog.locator(".pt-theme-card.pt-active").first()).toBeVisible();
});

const VALID_SCHEME = [
  'name: "E2E Custom"',
  ...Array.from({ length: 16 }, (_, i) => {
    const k = i.toString(16).toUpperCase();
    const hex = `${k}${k}1122`.slice(0, 6);
    return `base0${k}: "${hex}"`;
  }),
].join("\n");

async function openGallery(context: any, page: any) {
  await mockGithub(context);
  await seedToken(context, page, DIFF_URL, "github.com");
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });
  await page.locator("#pt-settings > summary").click();
  await page.locator("#pt-settings .pt-dd-item", { hasText: "Theme gallery" }).click();
  const dialog = page.locator("#pt-themes-dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator(".pt-gallery-custom > summary").click();
  return dialog;
}

test("pasting a valid base16 scheme applies it", async ({ context, page }) => {
  const dialog = await openGallery(context, page);
  await dialog.locator(".pt-gallery-custom textarea").fill(VALID_SCHEME);
  await dialog.locator(".pt-gallery-custom button", { hasText: "Add and apply" }).click();

  await expect(dialog.locator(".pt-dialog-err")).toHaveCount(0);
  // base00 ("001122") becomes the --pt-bg background variable
  await expect(page.locator("html")).toHaveAttribute("style", /--pt-bg:\s*#001122/i);
});

test("pasting an invalid scheme shows an error", async ({ context, page }) => {
  const dialog = await openGallery(context, page);
  await dialog.locator(".pt-gallery-custom textarea").fill("this is not a scheme");
  await dialog.locator(".pt-gallery-custom button", { hasText: "Add and apply" }).click();

  await expect(dialog.locator(".pt-dialog-err")).toContainText(/base00/i);
});
