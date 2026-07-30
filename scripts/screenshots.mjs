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

// Regenerates docs/screenshots/ against the live showcase PR
// (danilrwx/patchtree#1) with the built dist/ extension loaded.
// All frames share one viewport and deviceScaleFactor so the gallery
// keeps a uniform scale. Usage: node scripts/screenshots.mjs
// (needs `make` beforehand and a GitHub token via GH_TOKEN or `gh auth token`).
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import path from "node:path";

const dist = path.resolve(import.meta.dirname, "../dist");
const out = path.resolve(import.meta.dirname, "../docs/screenshots");
const url = "https://github.com/danilrwx/patchtree/pull/1.diff";
const token = process.env.GH_TOKEN || execSync("gh auth token").toString().trim();

const context = await chromium.launchPersistentContext("", {
  headless: false,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(url);
const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
await sw.evaluate(
  (t) => chrome.storage.local.set({ gitlabs: { "github.com": { token: t } } }),
  token
);
await page.reload();

await page.locator(".pt-keyword").first().waitFor({ timeout: 30000 });
await page.locator(".pt-comments-row").first().waitFor({ state: "attached", timeout: 30000 });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1000);

const file = (name) => path.join(out, `${name}.png`);

function union(boxes, pad = 8) {
  const x = Math.min(...boxes.map((b) => b.x)) - pad;
  const y = Math.min(...boxes.map((b) => b.y)) - pad;
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) + pad - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) + pad - y,
  };
}

async function clipShot(name, locators, pad = 8) {
  const boxes = [];
  for (const l of locators) boxes.push(await l.boundingBox());
  await page.screenshot({ path: file(name), clip: union(boxes.filter(Boolean), pad) });
  console.log(name);
}

async function elementShot(name, locator) {
  await locator.screenshot({ path: file(name) });
  console.log(name);
}

async function dropdownShot(name, dd) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await dd.locator("summary").first().click();
  const menu = dd.locator(".pt-dd-menu");
  await menu.waitFor();
  await clipShot(name, [dd, menu]);
  await page.keyboard.press("Escape");
}

await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: file("overview") });
console.log("overview");

await clipShot("toolbar", [page.locator("#pt-bar")], 0);

const tree = page.locator("#pt-tree");
const lastRow = page.locator(".pt-tree-file:visible").last();
await clipShot("tree", [tree, lastRow], 0);

await dropdownShot("commits", page.locator("#pt-commits"));
await dropdownShot("unresolved", page.locator("#pt-unresolved"));

const review = page.locator("#pt-review");
await review.locator("summary").click();
await review.locator("textarea").fill("Solid work overall — a couple of small comments inline.");
await clipShot("submit-review", [review, review.locator(".pt-review-panel")]);
await review.locator("summary").click();
await page.waitForTimeout(300);

const sugThread = page
  .locator(".pt-comments-row:visible", { has: page.locator(".pt-sug") })
  .first();
await sugThread.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
await elementShot("thread", sugThread);

const cells = page.locator(".pt-unified tr.pt-add td.pt-no:visible", { hasText: /\d/ });
await cells.nth(2).scrollIntoViewIfNeeded();
await cells.nth(2).click();
const form = page.locator(".pt-comment-form").first();
await form
  .locator("textarea")
  .fill("This lock is held across the whole loop — consider copying the slice first.\n\n");
await elementShot("comment-form", form);

await form.locator('button[title="Insert suggestion"]').click();
await form
  .locator("textarea")
  .evaluate((ta) => (ta.style.height = `${ta.scrollHeight + 4}px`));
await elementShot("suggestion-editor", form);
await form.locator("button", { hasText: "Cancel" }).click();

const uiFile = page.locator("section.pt-file", { hasText: "demo/ui.tsx" });
const uiCells = uiFile.locator(".pt-unified tr.pt-add td.pt-no:visible", { hasText: /\d/ });
await uiCells.nth(27).scrollIntoViewIfNeeded();
await uiCells.nth(27).click();
await uiCells.nth(29).click({ modifiers: ["Shift"] });
const ranges = uiFile.locator("tr.pt-range:visible");
await ranges.first().waitFor();
const mlForm = uiFile.locator(".pt-comment-form").first();
await mlForm.locator("textarea").fill("These three lines can be replaced by a single helper call.");
await clipShot("multiline", [ranges.first(), ranges.last(), mlForm]);
await mlForm.locator("button", { hasText: "Cancel" }).click();

await page.evaluate(() => window.scrollTo(0, 0));
// the gear menu is taller than the shared viewport and scrolls inside it;
// raise the window for this one frame so the shot isn't cut mid-item
await page.setViewportSize({ width: 1440, height: 1200 });
const settings = page.locator("#pt-settings");
await settings.locator('summary[title="Settings"]').click();
const menu = settings.locator("> .pt-dd-menu");
await menu.waitFor();
await elementShot("settings", menu);
await page.setViewportSize({ width: 1440, height: 900 });

await settings.locator(".pt-dd-item", { hasText: "Theme gallery" }).click();
const gallery = page.locator("#pt-themes-dialog .pt-dialog");
await gallery.waitFor();
await page.waitForTimeout(500);
await elementShot("theme-gallery", gallery);
await page.keyboard.press("Escape");

await settings.locator('summary[title="Settings"]').click();
await settings.locator(".pt-dd-item", { hasText: "Access tokens" }).click();
const tokens = page.locator("#pt-tokens-dialog .pt-dialog");
await tokens.waitFor();
await elementShot("tokens", tokens);
await page.keyboard.press("Escape");

await context.close();
