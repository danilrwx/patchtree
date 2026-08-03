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

// Regenerates docs/store/ — the Chrome Web Store / AMO listing gallery.
// Shots are taken at a native 1280x800 with deviceScaleFactor 1, which is
// exactly what both stores want, so nothing is ever rescaled or cropped.
// Files are numbered in upload order. Usage: node scripts/store-shots.mjs
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import path from "node:path";

const dist = path.resolve(import.meta.dirname, "../dist");
const out = path.resolve(import.meta.dirname, "../docs/store");
const url = "https://github.com/danilrwx/patchtree/pull/1.diff";
const token = process.env.GH_TOKEN || execSync("gh auth token").toString().trim();

const context = await chromium.launchPersistentContext("", {
  headless: false,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});
const page = context.pages()[0] ?? (await context.newPage());
const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));

const settings = (s) =>
  sw.evaluate(
    (v) =>
      new Promise((res) =>
        chrome.storage.sync.get("settings", (o) =>
          chrome.storage.sync.set({ settings: { ...(o.settings || {}), ...v } }, res)
        )
      ),
    s
  );

await page.goto(url);
await sw.evaluate((t) => chrome.storage.local.set({ gitlabs: { "github.com": { token: t } } }), token);

async function load() {
  await page.reload();
  await page.locator(".pt-keyword").first().waitFor({ timeout: 30000 });
  await page.locator(".pt-comments-row").first().waitFor({ state: "attached", timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
}

const shot = async (name) => {
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(`${name}.png`);
};

await load();

// 1 — the whole thing at a glance: tree, toolbar, highlighted diff
await page.evaluate(() => window.scrollTo(0, 0));
await shot("01-overview");

// 2 — review: a thread with a suggestion, centred in the viewport
const sug = page.locator(".pt-comments-row:visible", { has: page.locator(".pt-sug") }).first();
await sug.scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -160));
await page.waitForTimeout(400);
await shot("02-review-threads");

// 3 — side-by-side view
await page.locator("#pt-view-toggle").click();
await page.waitForTimeout(600);
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(400);
await shot("03-side-by-side");
await page.locator("#pt-view-toggle").click();

// 4 — commenting: a multi-line range with the markdown editor open
const cells = page.locator(".pt-unified tr.pt-add td.pt-no:visible", { hasText: /\d/ });
await cells.nth(2).scrollIntoViewIfNeeded();
await cells.nth(2).click();
await cells.nth(4).click({ modifiers: ["Shift"] });
const form = page.locator(".pt-comment-form").first();
await form.locator("textarea").fill("Extract this into a helper — it repeats in the watcher too.");
await form.scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -220));
await page.waitForTimeout(400);
await shot("04-inline-comments");
await form.locator("button", { hasText: "Cancel" }).click();

// 5 — the theme gallery over a dark scheme, so both are on show at once
await settings({ theme: "Dracula" });
await load();
await page.locator("#pt-settings > summary").click();
await page.locator("#pt-settings .pt-dd-item", { hasText: "Theme gallery" }).click();
await page.locator("#pt-themes-dialog").waitFor();
await page.waitForTimeout(800);
await shot("05-themes");

await settings({ theme: "" });
await context.close();
