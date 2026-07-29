// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
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
