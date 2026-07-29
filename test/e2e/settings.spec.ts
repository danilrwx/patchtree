// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
// Settings controls in the gear menu must map to the CSS variables the diff
// renders with. Asserting the vars on <html> pins the control → apply path
// through the Solid rewrite regardless of internal wiring.
import { test, expect } from "./fixtures";
import { mockGithub, DIFF_URL } from "../fixtures/github";

test("gear settings apply to the rendered CSS variables", async ({ context, page }) => {
  await mockGithub(context);
  await page.goto(DIFF_URL);
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const html = page.locator("html");
  const gearSummary = page.locator('summary[title="Settings"]');
  const gear = page.locator("details.pt-dd").filter({ has: gearSummary });
  const row = (label: string) => gear.locator(".pt-set-row", { hasText: label });
  const ensureOpen = async () => {
    if (!(await gear.evaluate((el: HTMLDetailsElement) => el.open))) await gearSummary.click();
  };

  // tab width is a nested select → open it, then pick 8 → --pt-tab
  await ensureOpen();
  await row("Tab width").locator("summary").click();
  await gear.locator(".pt-dd-item", { hasText: /^8$/ }).click();
  await expect(html).toHaveAttribute("style", /--pt-tab:\s*8\b/);

  // code / UI font sizes → --pt-size / --pt-ui-size
  await ensureOpen();
  const code = row("Code font size").locator("input[type=number]");
  await code.fill("18");
  await code.blur();
  await expect(html).toHaveAttribute("style", /--pt-size:\s*18px/);

  await ensureOpen();
  const ui = row("UI font size").locator("input[type=number]");
  await ui.fill("12");
  await ui.blur();
  await expect(html).toHaveAttribute("style", /--pt-ui-size:\s*12px/);

  // italic comments toggle → --pt-comment-style
  await ensureOpen();
  await row("Italic comments").locator("input[type=checkbox]").uncheck();
  await expect(html).toHaveAttribute("style", /--pt-comment-style:\s*normal/);

  // ligatures toggle flips --pt-liga to something other than its initial value
  await ensureOpen();
  const before = await html.getAttribute("style");
  await row("Ligatures").locator("input[type=checkbox]").click();
  await expect(html).not.toHaveAttribute("style", before ?? "");
});

test("picking a theme applies its color variables", async ({ context, page }) => {
  await mockGithub(context);
  await page.goto(DIFF_URL);
  await expect(page.locator(".pt-keyword").first()).toBeVisible({ timeout: 20000 });

  const html = page.locator("html");
  const gearSummary = page.locator('summary[title="Settings"]');
  await gearSummary.click();
  const gear = page.locator("details.pt-dd").filter({ has: gearSummary });

  const before = (await html.getAttribute("style")) ?? "";
  // the theme select is the first custom dropdown in the gear menu
  const themeSel = gear.locator(".pt-set-row", { hasText: "Theme" }).locator("summary").first();
  await themeSel.click();
  // pick the first non-active theme option
  await gear.locator(".pt-dd-item:not(.pt-active)").first().click();

  // a theme adds color vars, so the inline style grows / changes
  await expect(html).not.toHaveAttribute("style", before);
  await expect(html).toHaveAttribute("style", /--pt-/);
});
