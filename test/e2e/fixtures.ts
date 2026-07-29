// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
// Playwright fixture that launches Chromium with the built dist/ extension
// loaded, exposing the MV3 background service worker (used to seed a token).
import { test as base, chromium, type BrowserContext } from "@playwright/test";
import path from "node:path";

const dist = path.resolve(__dirname, "../../dist");

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
