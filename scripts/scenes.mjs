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

// Regenerates every gallery frame for the README and the store listings. Each
// frame is a full 1280x800 window, so menus and dialogs are shown in place over
// the diff instead of cropped out of context. Shot twice from one run: at 2x
// into docs/screenshots/ (crisp on HiDPI, for the README) and at 1x into
// docs/store/ (exactly what the stores ask for). The 1x run stops after the
// five frames the Chrome Web Store allows; the rest are README-only.
// Usage: node scripts/scenes.mjs
import { chromium } from "@playwright/test";
import { execSync } from "node:child_process";
import path from "node:path";

const dist = path.resolve(import.meta.dirname, "../dist");
const root = path.resolve(import.meta.dirname, "..");
const url = "https://github.com/danilrwx/patchtree/pull/1.diff";
const token = process.env.GH_TOKEN || execSync("gh auth token").toString().trim();

// [output dir, device pixel ratio]
const TARGETS = [
  ["docs/screenshots", 2],
  ["docs/store", 1],
];

for (const [dir, scale] of TARGETS) await shootScenes(path.join(root, dir), scale);

async function shootScenes(out, deviceScaleFactor) {
  const storeRun = deviceScaleFactor === 1;
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor,
    // relative dates in the bar follow the browser locale — pin it so the
    // gallery doesn't come out half-translated on a non-English machine
    locale: "en-US",
    // new headless still loads MV3 extensions and renders the same pixels, so
    // shooting no longer takes over the screen (PT_HEADED=1 to watch it)
    args: [
      ...(process.env.PT_HEADED ? [] : ["--headless=new"]),
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
    ],
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
  await sw.evaluate(
    (t) => chrome.storage.local.set({ gitlabs: { "github.com": { token: t } } }),
    token
  );

  const load = async () => {
    await page.reload();
    await page.locator(".pt-keyword").first().waitFor({ timeout: 30000 });
    await page.locator(".pt-comments-row").first().waitFor({ state: "attached", timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
  };

  const shot = async (name) => {
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    console.log(`${path.basename(out)}/${name}.png @${deviceScaleFactor}x`);
  };

  // <details> menus toggle, so always close what's open before opening the
  // next one — otherwise a second "open" click closes the menu instead
  const closeMenus = () =>
    page.evaluate(() => {
      for (const d of document.querySelectorAll("#pt-bar details[open]"))
        d.removeAttribute("open");
    });

  const dropdown = async (sel) => {
    await closeMenus();
    await page.evaluate(() => window.scrollTo(0, 0));
    const dd = page.locator(sel);
    await dd.locator("summary").first().click();
    // "> .pt-dd-menu": the gear menu nests <Select> menus of its own
    await dd.locator("> .pt-dd-menu").waitFor();
    await page.waitForTimeout(200);
  };

  // open the gear menu at the top of the page, optionally picking an item
  const gear = async (item) => {
    await dropdown("#pt-settings");
    if (item) await page.locator("#pt-settings .pt-dd-item", { hasText: item }).click();
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
  await gear("Theme gallery");
  await page.locator("#pt-themes-dialog").waitFor();
  await page.waitForTimeout(800);
  await shot("05-themes");
  await page.keyboard.press("Escape");
  await settings({ theme: "" });

  if (storeRun) {
    await context.close();
    return;
  }

  // README-only frames: every menu and dialog in place over the diff
  await load();

  await gear();
  await shot("06-settings");

  await gear("Keyboard shortcuts");
  await page.locator("#pt-keymap-dialog").waitFor();
  await page.waitForTimeout(300);
  await shot("07-shortcuts");
  await page.keyboard.press("Escape");

  await dropdown("#pt-unresolved");
  await shot("08-unresolved");

  await dropdown("#pt-commits");
  await shot("09-commits");

  await dropdown(".pt-filter-dd");
  await shot("10-file-filter");
  await closeMenus();

  await gear("Access tokens");
  await page.locator("#pt-tokens-dialog").waitFor();
  await shot("11-tokens");
  await page.keyboard.press("Escape");

  // the pipeline chip and its jobs — only there when the host reports CI
  if (await page.locator("#pt-ci").count()) {
    await dropdown("#pt-ci");
    await page.locator("#pt-ci .pt-job").first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(300);
    await shot("12-ci-jobs");
    await closeMenus();
  } else console.log("no CI on this request — skipping 12-ci-jobs");

  // the review panel, with the red-pipeline warning under Approve. Its body is
  // a .pt-review-panel, not one of the shared dropdown menus
  await closeMenus();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("#pt-review > summary").click();
  await page.locator("#pt-review .pt-review-panel").waitFor();
  await page.waitForTimeout(400);
  await shot("13-submit-review");
  await closeMenus();

  // the tree tracking progress: some files done, the folder box part-way. Every
  // file here lives in one folder, so marking the folder would fold the tree
  // into a single row and show nothing
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".pt-tree-row .pt-tree-check")];
    for (const b of rows.slice(0, 3)) b.click();
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await shot("14-tree-viewed");

  await context.close();
}
