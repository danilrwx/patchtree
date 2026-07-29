// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
import { defineConfig } from "@playwright/test";

// Extensions require a persistent context, so run serially in one worker.
export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  reporter: "list",
  use: { actionTimeout: 15_000 },
});
