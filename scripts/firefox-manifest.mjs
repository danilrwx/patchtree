// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
// Rewrite manifest.json in place for the Firefox build:
// event-page background instead of a service worker, plus the gecko id.
import { readFileSync, writeFileSync } from "fs";

const path = process.argv[2];
const m = JSON.parse(readFileSync(path, "utf8"));

m.background = { scripts: ["background.js"], type: "module" };
m.browser_specific_settings = {
  gecko: { id: "patchtree@danilrwx.github.io", strict_min_version: "128.0" },
};

writeFileSync(path, JSON.stringify(m, null, 2) + "\n");
console.log(`firefox manifest written to ${path}`);