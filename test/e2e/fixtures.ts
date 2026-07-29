// MIT License
//
// Copyright (c) 2026 Daniil Antoshin
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
// Playwright fixture that launches Chromium with the built dist/ extension
// loaded, exposing the MV3 background service worker (used to seed a token).
import { test as base, chromium, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";

const dist = path.resolve(__dirname, "../../dist");

// Seed an access token so the provider runs authenticated (as it would for a
// real user). The MV3 service worker starts lazily, so wake it with the first
// navigation, write storage through it, then reload to pick the token up.
export async function seedToken(
  context: BrowserContext,
  page: Page,
  url: string,
  host: string,
  token = "e2e-token"
): Promise<void> {
  await page.goto(url);
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  await sw.evaluate(
    ({ h, t }) => chrome.storage.local.set({ gitlabs: { [h]: { token: t } } }),
    { h: host, t: token }
  );
  await page.reload();
}

export const test = base.extend<{ context: BrowserContext }>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext("", {
      // MV3 extensions (service worker + content scripts) load only in headed
      // Chromium; CI runs this under xvfb.
      headless: false,
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    });
    await use(context);
    await context.close();
  },
  page: async ({ context }, use) => {
    const page = context.pages()[0] ?? (await context.newPage());
    await use(page);
  },
});

export const expect = test.expect;
