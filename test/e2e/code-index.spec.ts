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

import type { Locator } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { gzipSync } from "node:zlib";
import { test, expect, seedToken } from "./fixtures";
import { DIFF_URL, mockGithub, OWNER, REPO } from "../fixtures/github";
import { DIFF_URL as GITLAB_DIFF, HOST, PROJECT, TOKEN_HOST, mockGitlab } from "../fixtures/gitlab";

test("code navigation matches the revision, side and UTF-8 token range", async ({ context, page }) => {
  await mockGithub(context);
  const repository = `https://github.com/${OWNER}/${REPO}`;
  const head = "1".repeat(40);
  const code = 'var label = "é" + Worker{}.Label()';
  const diff = [
    "diff --git a/use.go b/use.go",
    "--- a/use.go",
    "+++ b/use.go",
    "@@ -1,2 +1,2 @@",
    " package sample",
    "-var label = Worker{}.Label()",
    `+${code}`,
    "",
  ].join("\n");
  await context.route(DIFF_URL, (route) => route.fulfill({ body: diff, contentType: "text/plain; charset=utf-8" }));
  const destination = `${repository}/blob/${head}/impl/worker.go#L7`;
  await context.route(`${repository}/blob/**`, (route) => route.fulfill({ body: "definition" }));

  await page.goto(DIFF_URL);
  const status = page.locator(".pt-set-row").filter({ hasText: "Code index" }).getByRole("status", { includeHidden: true });
  await expect(status).toHaveText("Sign in to build a code index.");
  await expect(page.getByRole("button", { name: "Index Go sources", includeHidden: true })).toHaveCount(0);
  await caretOn(page.locator('tr.pt-add[data-new="2"] .pt-code'), "Label");
  await page.keyboard.press("Control+Enter");
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  expect(await worker.evaluate(() => caches.has("patchtree-index-v4"))).toBe(false);
  const index = {
    version: 1,
    repository,
    revision: head,
    files: {
      "use.go": {
        2: {
          text: code,
          spans: [{
            start: Buffer.byteLength(code.slice(0, code.indexOf("Label"))),
            end: Buffer.byteLength(code.slice(0, code.indexOf("Label"))) + 5,
            targets: [{ path: "impl/worker.go", line: 7, column: 5 }],
          }],
        },
      },
    },
  };
  const load = async (revision: string, data = index) => {
    const settings = page.locator("#pt-settings");
    await settings.locator("summary").first().click();
    const [picker] = await Promise.all([
      page.waitForEvent("filechooser"),
      settings.getByRole("button", { name: "Import code index" }).click(),
    ]);
    await picker.setFiles({
      name: "code-index.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...data, revision })),
    });
    await settings.locator("summary").first().click();
  };
  await load("2".repeat(40));
  await expect(status).toHaveText(/different repository or revision/);
  await page.getByRole("button", { name: "Switch to side-by-side" }).click();
  const oldCell = page.locator('tr.pt-srow[data-new="2"] .pt-code:nth-child(2)');
  const newCell = page.locator('tr.pt-srow[data-new="2"] .pt-code:nth-child(4)');
  const clickLabel = async (cell: Locator, direct = false) => {
    await cell.scrollIntoViewIfNeeded();
    const point = await cell.evaluate((element) => {
      const label = element.textContent!.indexOf("Label") + 4;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let offset = 0;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const size = node.textContent!.length;
        if (label < offset + size) {
          const range = document.createRange();
          range.setStart(node, label - offset);
          range.setEnd(node, label - offset + 1);
          const box = range.getBoundingClientRect();
          return { x: box.left + box.width * 0.8, y: box.top + box.height / 2 };
        }
        offset += size;
      }
      throw new Error("token was not rendered");
    });
    await page.mouse.move(point.x, point.y);
    if (direct) await page.keyboard.down("Control");
    try {
      await page.mouse.click(point.x, point.y);
    } finally {
      if (direct) await page.keyboard.up("Control");
    }
  };

  const ambiguous = structuredClone(index);
  ambiguous.files["use.go"][2].spans[0].targets.push({ path: "impl/manager.go", line: 9, column: 5 });
  await load(head, ambiguous);
  await expect(status).toHaveText(/Indexed 11111111/);
  const dialog = page.getByRole("dialog", { name: "Go to definition" });
  await clickLabel(oldCell);
  await expect(dialog).toHaveCount(0);
  await clickLabel(newCell);
  await expect(newCell).toHaveClass(/pt-definition-hit/);
  await expect(dialog.getByRole("button", { name: "impl/manager.go:9" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Open impl/worker.go:7 on GitHub" })).toHaveAttribute("href", destination);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await load("2".repeat(40));
  await expect(status).toHaveText(/different repository or revision/);
  await load(head);
  await expect(status).toHaveText(/Indexed 11111111/);
  const [popup] = await Promise.all([context.waitForEvent("page"), clickLabel(newCell, true)]);
  await expect(popup).toHaveURL(destination);
  await popup.close();

  const many = {
    ...index,
    files: {
      ...index.files,
      "many.go": Object.fromEntries(Array.from({ length: 150 }, (_, i) => [i + 1, index.files["use.go"][2]])),
    },
  };
  await load(head, many);
  await clickLabel(newCell);
  await dialog.getByRole("button", { name: "Find references" }).click();
  const references = page.getByRole("dialog", { name: "Find references" });
  await expect(references.getByRole("status")).toHaveText("151 references");
  await expect(references.locator(".pt-reference-row")).toHaveCount(100);
  await references.getByRole("button", { name: "Show more references" }).click();
  await expect(references.locator(".pt-reference-row")).toHaveCount(151);
  await page.keyboard.press("Escape");
  await clickLabel(newCell);
  await dialog.getByRole("button", { name: "Find references" }).click();
  await expect(references.locator(".pt-reference-row")).toHaveCount(100);
  await page.keyboard.press("Escape");
  await load(head);
  await clickLabel(newCell);
  await dialog.getByRole("button", { name: "Find references" }).click();
  await expect(references.getByRole("status")).toHaveText("1 reference");
});

function tarGzip(files: Record<string, string | Buffer>) {
  const blocks: Buffer[] = [];
  for (const [name, source] of Object.entries(files)) {
    const data = typeof source === "string" ? Buffer.from(source) : source;
    const header = Buffer.alloc(512);
    header.write(`snapshot/${name}`);
    header.write("0000644", 100);
    header.write(data.length.toString(8).padStart(11, "0"), 124);
    header.write("        ", 148);
    header.write("0", 156);
    header.write("ustar\0", 257);
    const sum = header.reduce((acc, byte) => acc + byte, 0);
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

test("builds and reuses a large Go index with cross-package navigation", async ({ context, page }) => {
  await mockGitlab(context);
  const sha = "1".repeat(40);
  const call = "var result = shared.Value";
  const sources = {
    "use.go": `package demo\nimport "example.com/demo/shared"\n${call}\n`,
    "shared/def.go": "package shared\nconst Value = 42\n",
    "other/use.go": 'package other\nimport "example.com/demo/shared"\nvar other = shared.Value\n',
  };
  const archive = tarGzip({ ...sources, "go.mod": "module example.com/demo\n", "padding.bin": randomBytes(8 * 1024 * 1024) });
  await context.route(GITLAB_DIFF, (route) => route.fulfill({
    contentType: "text/plain",
    body: `diff --git a/use.go b/use.go\n--- a/use.go\n+++ b/use.go\n@@ -1,2 +1,3 @@\n package demo\n import "example.com/demo/shared"\n+${call}\n`,
  }));
  let downloads = 0;
  await context.route(`${HOST}/api/v4/projects/**/repository/archive.tar.gz?**`, (route) => {
    downloads++;
    return route.fulfill({ body: archive, contentType: "application/gzip" });
  });
  await context.route(`${HOST}/api/v4/projects/**/repository/files/**`, (route) => {
    const url = new URL(route.request().url());
    const path = decodeURIComponent(url.pathname.split("/files/")[1].replace(/\/raw$/, ""));
    expect(url.searchParams.get("ref")).toBe(sha);
    return route.fulfill({ contentType: "text/plain", body: sources[path as keyof typeof sources] });
  });
  await seedToken(context, page, GITLAB_DIFF, TOKEN_HOST);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const storedChunks = () => worker.evaluate(async () => {
    const name = (await caches.keys()).find((name) => name.startsWith("patchtree-index-chunks-v1-"));
    return name ? (await (await caches.open(name)).keys()).length : 0;
  });
  const status = page.locator(".pt-code-index-row [role=status]");
  const findDefinition = async () => {
    await caretOn(page.locator('.pt-unified tr[data-new="3"] .pt-code'), "Value");
    await page.keyboard.press("Control+Enter");
    const card = page.getByRole("dialog", { name: "Go to definition" });
    await expect(card.getByRole("button", { name: "shared/def.go:2" })).toBeVisible({ timeout: 30_000 });
    return card;
  };
  await expect(status).toBeAttached();
  const card = await findDefinition();
  await expect.poll(storedChunks).toBe(3);
  await card.getByRole("button", { name: "shared/def.go:2" }).click();
  const viewer = page.getByRole("dialog", { name: "shared/def.go" });
  await caretOn(viewer.locator('[aria-current="location"] code'), "Value");
  await page.keyboard.press("Shift+F12");
  const refs = viewer.getByRole("region", { name: "References for Value" });
  await expect(refs.getByRole("status")).toHaveText("2 references");
  await expect(refs.getByRole("button", { name: /^other\/use.go:3/ })).toBeVisible();
  await page.reload();
  await expect(status).toHaveText(/Indexed/);
  await findDefinition();
  expect(downloads).toBe(1);

  await page.keyboard.press("Escape");
  await page.locator("#pt-settings > summary").click();
  await page.getByText("Cache storage", { exact: true }).click();
  await page.getByRole("button", { name: "Clear indexes" }).click();
  await expect(status).toBeEmpty();
  await expect.poll(storedChunks).toBe(0);
  await page.getByRole("button", { name: "Index Go sources" }).click();
  await expect(status).toHaveText(/Indexed/);
  await expect.poll(storedChunks).toBe(3);
  expect(downloads).toBe(1);
});

test("shows and clears index caches independently and rebuilds in the open diff", async ({ context, page }) => {
  await mockGitlab(context);
  await context.route(GITLAB_DIFF, (route) => route.fulfill({
    contentType: "text/plain",
    body: "diff --git a/use.go b/use.go\n--- a/use.go\n+++ b/use.go\n@@ -1 +1,2 @@\n package demo\n+var x = value\n",
  }));
  const archive = tarGzip({ "go.mod": "module example.com/demo\n", "use.go": "package demo\nvar x = value\n",
    "value.go": "package demo\nconst value = 1\n" });
  let downloads = 0;
  await context.route(`${HOST}/api/v4/projects/**/repository/archive.tar.gz?**`, (route) => {
    downloads++;
    return route.fulfill({ body: archive, contentType: "application/gzip" });
  });
  await seedToken(context, page, GITLAB_DIFF, TOKEN_HOST);
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(() => chrome.storage.sync.set({ settings: { fontSize: 15 } }));
  const settings = page.locator("#pt-settings");
  const cache = settings.locator(".pt-index-cache");
  const readouts = cache.locator("dd");
  const empty = "0 entries (0.00 MiB)";
  const stored = "1 entry (<0.01 MiB)";
  const index = settings.getByRole("button", { name: "Index Go sources" });
  const status = settings.locator(".pt-code-index-row [role=status]");
  const clearIndexes = cache.getByRole("button", { name: "Clear indexes" });
  const clearSources = cache.getByRole("button", { name: "Clear source snapshots" });
  const clearBoth = cache.getByRole("button", { name: "Clear both caches" });

  await settings.locator(":scope > summary").click();
  await cache.getByText("Cache storage", { exact: true }).click();
  await expect(cache.getByText("Stored entry size in MiB")).toBeVisible();
  await expect(readouts).toHaveText([empty, empty]);
  await expect(clearBoth).toBeDisabled();
  expect(downloads).toBe(0);

  await worker.evaluate(async () => {
    const cache = await caches.open("patchtree-index-v4");
    await cache.put("https://example.com/legacy-index", new Response(new Uint8Array(1024 * 1024), {
      headers: { "X-Patchtree-Expires": String(Date.now() + 60_000) },
    }));
  });
  await cache.getByText("Cache storage", { exact: true }).click();
  await cache.getByText("Cache storage", { exact: true }).click();
  await expect(readouts).toHaveText(["1 entry (1.00 MiB)", empty]);
  await clearIndexes.click();
  await expect(readouts).toHaveText([empty, empty]);

  await index.click();
  await expect(readouts).toHaveText([stored, stored]);
  expect(downloads).toBe(1);
  const other = await context.newPage();
  await other.goto(GITLAB_DIFF);
  const otherStatus = other.locator(".pt-code-index-row [role=status]");
  await expect(otherStatus).toHaveText(/Indexed/);
  await page.bringToFront();

  await clearIndexes.click();
  await expect(readouts).toHaveText([empty, stored]);
  await expect(status).toBeEmpty();
  await expect(otherStatus).toBeEmpty();
  await index.click();
  await expect(readouts).toHaveText([stored, stored]);
  await expect(status).toHaveText(/Indexed/);
  expect(downloads).toBe(1);

  await clearSources.click();
  await expect(readouts).toHaveText([stored, empty]);
  await expect(status).toHaveText(/Indexed/);
  await index.click();
  await expect(status).toHaveText(/Indexed/);
  expect(downloads).toBe(1);

  await clearIndexes.click();
  await expect(readouts).toHaveText([empty, empty]);
  await index.click();
  await expect(readouts).toHaveText([stored, stored]);
  expect(downloads).toBe(2);
  await clearBoth.click();
  await expect(readouts).toHaveText([empty, empty]);
  await index.click();
  await expect(readouts).toHaveText([stored, stored]);
  expect(downloads).toBe(3);
  expect(await worker.evaluate(async (host) => ({
    token: (await chrome.storage.local.get("gitlabs")).gitlabs[host].token,
    font: (await chrome.storage.sync.get("settings")).settings.fontSize,
  }), TOKEN_HOST)).toEqual({ token: "e2e-token", font: 15 });
});

test("indexes a test-file symbol on first click and reuses the result after reload", async ({ context, page }) => {
  await mockGithub(context);
  const head = "1".repeat(40);
  const repository = `https://github.com/${OWNER}/${REPO}`;
  const code = "var result = worker.Worker{}.Label()";
  const from = "package demo_test\nimport \"example.com/demo/worker\"\n";
  const workerCode = 'package worker\ntype Worker struct{}\nfunc (Worker) Label() string { return "worker" }\nvar _ = helper\n';
  const managerCode = 'package worker\ntype Manager struct{}\nfunc (Manager) Label() string { return "manager" }\nconst helper = 42\nvar _ = Manager{}.Label()\n';
  const consumerCode = 'package consumer\nimport "example.com/demo/worker"\nvar _ = worker.Worker{}.Label() + worker.Worker{}.Label()\n';
  await context.route(DIFF_URL, (route) => route.fulfill({
    contentType: "text/plain; charset=utf-8",
    body: [
      "diff --git a/use_test.go b/use_test.go",
      "--- a/use_test.go", "+++ b/use_test.go",
      "@@ -1,2 +1,3 @@",
      " package demo_test", ' import "example.com/demo/worker"', `+${code}`, "",
    ].join("\n"),
  }));
  const snapshot = tarGzip({
    "go.mod": "module example.com/demo\n",
    "use_test.go": `${from}${code}\n`,
    "worker/worker.go": workerCode,
    "worker/manager.go": managerCode,
    "consumer/use.go": consumerCode,
  });
  await context.route(`${repository}/blob/**`, (route) => route.fulfill({ body: "definition" }));
  for (const [file, body] of [["worker/worker.go", workerCode], ["worker/manager.go", managerCode], ["consumer/use.go", consumerCode]]) {
    const fileURL = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${file}?ref=${head}`;
    await context.route(fileURL, (route) => route.fulfill({ contentType: "text/plain", body }));
  }
  const settings = page.locator("#pt-settings");
  const status = settings.locator(".pt-set-row").filter({ hasText: "Code index" })
    .getByRole("status", { includeHidden: true });
  await seedToken(context, page, DIFF_URL, "github.com");
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(({ endpoint, bytes }) => {
    const scope = globalThis as typeof globalThis & { archiveDownloads: number; releaseArchive?: () => void };
    scope.archiveDownloads = 0;
    const fetchArchive = fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      if (input !== endpoint) return fetchArchive(input, init);
      scope.archiveDownloads++;
      return new Promise((resolve) => {
        scope.releaseArchive = () => resolve(new Response(new Uint8Array(bytes)));
      });
    };
  }, { endpoint: `https://api.github.com/repos/${OWNER}/${REPO}/tarball/${head}`, bytes: [...snapshot] });
  const downloads = () => worker.evaluate(() => (globalThis as typeof globalThis & {
    archiveDownloads: number;
  }).archiveDownloads);
  await expect(status).toBeAttached();
  const cell = page.locator('tr.pt-add[data-new="3"] .pt-code');
  const clickSymbol = async (name: string, button: "left" | "right" = "left") => {
    await cell.scrollIntoViewIfNeeded();
    const point = await cell.evaluate((element, name) => {
      const target = element.textContent!.indexOf(name) + 2;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let offset = target;
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const length = node.textContent!.length;
        if (offset < length) {
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          const box = range.getBoundingClientRect();
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        }
        offset -= length;
      }
      throw new Error("Missing token");
    }, name);
    await page.mouse.click(point.x, point.y, { button });
  };
  const putCaret = (target: Locator, name: string) => target.evaluate((element, name) => {
    let offset = element.textContent!.indexOf(name) + 2;
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent!.length;
      if (offset < length) {
        getSelection()!.collapse(node, offset);
        return;
      }
      offset -= length;
    }
    throw new Error("Missing token");
  }, name);
  await clickSymbol("Label");
  const dialog = page.getByRole("dialog", { name: "Go to definition" });
  await expect(page.locator(".pt-code-feedback")).toHaveText("Indexing Go…");
  await expect.poll(downloads).toBe(1);
  await page.evaluate(() => document.dispatchEvent(new Event("scroll")));
  await worker.evaluate(() => (globalThis as typeof globalThis & { releaseArchive: () => void }).releaseArchive());
  await expect(status).toHaveText(/Indexed 11111111/);
  await expect(dialog.getByRole("button", { name: "worker/worker.go:3" })).toBeVisible();
  await dialog.getByRole("button", { name: "Find references" }).click();
  const references = page.getByRole("dialog", { name: "Find references" });
  await expect(references.getByText("3 references", { exact: true })).toBeVisible();
  await expect(references.getByRole("button", { name: /^consumer\/use\.go:3:/ })).toHaveCount(2);
  await expect(references.getByRole("button", { name: /^worker\// })).toHaveCount(0);
  await expect(references.locator("mark")).toHaveText(["Label", "Label", "Label"]);
  await references.getByRole("button", { name: /^use_test\.go:3:/ }).click();
  await expect(page.locator('.pt-unified tr[data-new="3"].pt-flash')).toBeVisible();
  await expect(references).toHaveCount(0);
  await clickSymbol("worker");
  await expect(page.locator(".pt-code-feedback")).toHaveText("No indexed definition for this symbol");

  await page.reload();
  await expect(status).toHaveText(/Indexed 11111111/);
  expect(await downloads()).toBe(1);
  await clickSymbol("Label", "right");
  await expect(references.getByText("3 references", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await clickSymbol("Label");
  await expect(dialog.locator("header strong")).toHaveText("Label");
  await expect(dialog.locator("pre")).toHaveText('func (Worker) Label() string { return "worker" }');
  await expect(dialog.locator("pre .pt-keyword").first()).toHaveText("func");
  await dialog.getByRole("button", { name: "Close" }).click();
  await putCaret(cell, "Label");
  await page.keyboard.press("Control+Enter");
  const fileButton = dialog.getByRole("button", { name: "worker/worker.go:3" });
  await expect(fileButton).toBeFocused();
  const before = await page.evaluate(() => window.scrollY);
  await fileButton.press("Enter");
  const file = page.getByRole("dialog", { name: "worker/worker.go" });
  await expect(file.locator('[aria-current="location"] code')).toHaveText('func (Worker) Label() string { return "worker" }');
  await expect(file.locator('[aria-current="location"] .pt-keyword').first()).toHaveText("func");
  await expect(file.getByRole("link", { name: "Open on GitHub" }))
    .toHaveAttribute("href", `${repository}/blob/${head}/worker/worker.go#L3`);
  await putCaret(file.locator('[aria-current="location"] code'), "Label");
  await page.keyboard.press("Shift+F12");
  const fileReferences = file.getByRole("region", { name: "References for Label" });
  await expect(fileReferences.getByText("3 references", { exact: true })).toBeVisible();
  await fileReferences.getByRole("button", { name: /^consumer\/use\.go:3:/ }).last().click();
  const consumer = page.getByRole("dialog", { name: "consumer/use.go" });
  await expect(consumer.locator('[aria-current="location"] code')).toHaveText(/Worker\{\}\.Label/);
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(file.locator('[aria-current="location"] code')).toHaveText(/func \(Worker\) Label/);
  const helper = file.locator('code[data-line="4"]');
  const point = await helper.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let offset = element.textContent!.indexOf("helper") + 2;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent!.length;
      if (offset < length) {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const box = range.getBoundingClientRect();
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      }
      offset -= length;
    }
    throw new Error("Missing token");
  });
  await page.mouse.click(point.x, point.y);
  const manager = page.getByRole("dialog", { name: "worker/manager.go" });
  await expect(manager.locator('[aria-current="location"] code')).toHaveText("const helper = 42");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(file.locator('[aria-current="location"] code')).toHaveText(/func \(Worker\) Label/);
  await expect(page).toHaveURL(DIFF_URL);
  await page.keyboard.press("Escape");
  await expect(file).toHaveCount(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(before);

  await worker.evaluate(async (repository) => {
    const cache = await caches.open("patchtree-index-v4");
    const key = (await cache.keys()).find((request) => request.url.startsWith(repository) && request.url.endsWith("&language=go"));
    if (!key) throw new Error("Missing cached index key");
    const saved = await cache.match(key);
    if (!saved) throw new Error("Missing cached index");
    const expires = Number(saved.headers.get("X-Patchtree-Expires"));
    if (expires - Date.now() < 29 * 24 * 60 * 60 * 1000) throw new Error("Index TTL is too short");
    await cache.put(key, new Response(saved.body, { headers: { "X-Patchtree-Expires": "1" } }));
  }, repository);
  await page.reload();
  await expect(status).not.toHaveText(/Indexed/);
  expect(await downloads()).toBe(1);
  await clickSymbol("Label");
  await expect(dialog.locator("pre .pt-keyword").first()).toHaveText("func");
  expect(await downloads()).toBe(1);
});

test("jumps within the same diff file and reveals hidden definitions", async ({ context, page }) => {
  const repository = `https://github.com/${OWNER}/${REPO}`;
  const sha = "3".repeat(40);
  const url = `${repository}/commit/${sha}.diff`;
  const call = "\tEarlier(); Later(); Visible()";
  const source = [
    "package demo", "func Earlier() {}", "func Use() {", call, "}", "func Visible() {}", "func Later() {}", "",
  ].join("\n");
  await context.route(url, (route) => route.fulfill({
    contentType: "text/plain",
    body: [
      "diff --git a/use.go b/use.go", "--- a/use.go", "+++ b/use.go",
      "@@ -3,4 +3,4 @@", " func Use() {", "-\tEarlier()", `+${call}`, " }", " func Visible() {}", "",
    ].join("\n"),
  }));
  const sourceURL = `https://api.github.com/repos/${OWNER}/${REPO}/contents/use.go?ref=${sha}`;
  await context.route(sourceURL, (route) => route.fulfill({ contentType: "text/plain", body: source }));
  const snapshot = tarGzip({ "go.mod": "module example.com/demo\n", "use.go": source });
  await seedToken(context, page, url, "github.com");
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(({ endpoint, bytes }) => {
    const get = fetch.bind(globalThis);
    globalThis.fetch = (input, init) => input === endpoint
      ? Promise.resolve(new Response(new Uint8Array(bytes))) : get(input, init);
  }, { endpoint: `https://api.github.com/repos/${OWNER}/${REPO}/tarball/${sha}`, bytes: [...snapshot] });
  const jump = async (symbol: string, split = false) => {
    const cell = page.locator(split
      ? 'tr.pt-srow[data-new="4"] .pt-code:nth-child(4)' : 'tr.pt-add[data-new="4"] .pt-code');
    await cell.scrollIntoViewIfNeeded();
    const point = await cell.evaluate((element, symbol) => {
      let offset = element.textContent!.indexOf(symbol) + 1;
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (offset < node.textContent!.length) {
          const range = document.createRange();
          range.setStart(node, offset);
          range.setEnd(node, offset + 1);
          const box = range.getBoundingClientRect();
          return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        }
        offset -= node.textContent!.length;
      }
      throw new Error("Missing token");
    }, symbol);
    await page.mouse.click(point.x, point.y);
  };
  await expect(page.getByRole("button", { name: "Index Go sources", includeHidden: true })).toBeAttached();
  await jump("Earlier");
  await expect(page.locator('.pt-unified tr[data-new="2"].pt-flash')).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Go to definition" })).toHaveCount(0);
  await jump("Visible");
  await expect(page.locator('.pt-unified tr[data-new="6"].pt-flash')).toBeVisible();
  await page.getByRole("button", { name: "Switch to side-by-side" }).click();
  await jump("Later", true);
  await expect(page.locator('.pt-split tr[data-new="7"].pt-flash')).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Go to definition" })).toHaveCount(0);
  expect(context.pages()).toHaveLength(1);
});

test("indexes the workspace at a standalone GitHub commit", async ({ context, page }) => {
  const repository = `https://github.com/${OWNER}/${REPO}`;
  const sha = "2".repeat(40);
  const diffURL = `${repository}/commit/${sha}.diff`;
  await context.route(diffURL, (route) => route.fulfill({
    contentType: "text/plain",
    body: [
      "diff --git a/app/use.go b/app/use.go", "--- a/app/use.go", "+++ b/app/use.go",
      "@@ -1,2 +1,3 @@", " package app", ' import "example.com/lib"', "+var _ = lib.Value", "",
    ].join("\n"),
  }));
  const snapshot = tarGzip({
    "go.work": "go 1.26\nuse (\n ./app\n ./lib\n)\n",
    "app/go.mod": "module example.com/app\n",
    "app/use.go": 'package app\nimport "example.com/lib"\nvar _ = lib.Value\n',
    "app/large.go": 'package app\nimport "example.com/lib"\n' +
      (`var _ = lib.Value // ${"x".repeat(8192)}\n`).repeat(520),
    "lib/go.mod": "module example.com/lib\n",
    "lib/def.go": "package lib\nconst Value = 42\n",
  });
  await seedToken(context, page, diffURL, "github.com");
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(({ endpoint, bytes }) => {
    const realFetch = fetch.bind(globalThis);
    globalThis.fetch = (input, init) => input === endpoint
      ? Promise.resolve(new Response(new Uint8Array(bytes))) : realFetch(input, init);
  }, { endpoint: `https://api.github.com/repos/${OWNER}/${REPO}/tarball/${sha}`, bytes: [...snapshot] });
  await expect(page.getByRole("button", { name: "Index Go sources", includeHidden: true })).toBeAttached();
  await page.locator("#pt-settings > summary").click();
  await page.getByRole("button", { name: "Index Go sources" }).click();
  const status = page.locator(".pt-set-row").filter({ hasText: "Code index" }).getByRole("status");
  await expect(status).toHaveText(/Indexed 22222222/);
  const chunk = await worker.evaluate(async (repository) => {
    const cache = await caches.open("patchtree-index-v4");
    const key = (await cache.keys()).find((request) => request.url.startsWith(repository) && request.url.endsWith("&language=go"));
    const name = key && (await cache.match(key))?.headers.get("X-Patchtree-Chunk-Cache");
    if (!name) return;
    const part = await caches.match("https://patchtree.invalid/index/1", { cacheName: name });
    return part && [...new Uint8Array(await part.arrayBuffer()).subarray(0, 2)];
  }, repository);
  expect(chunk).toEqual([31, 139]); // gzip header
  await page.locator("#pt-settings > summary").click();
  await page.locator('tr.pt-add[data-new="3"] .pt-code').evaluate((cell) => {
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    let offset = cell.textContent!.indexOf("Value") + 1;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent!.length;
      if (offset < length) {
        getSelection()!.collapse(node, offset);
        return;
      }
      offset -= length;
    }
  });
  await page.keyboard.press("Control+Enter");
  const dialog = page.getByRole("dialog", { name: "Go to definition" });
  await expect(dialog.getByRole("button", { name: "lib/def.go:2" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Open lib/def.go:2 on GitHub" }))
    .toHaveAttribute("href", `${repository}/blob/${sha}/lib/def.go#L2`);
});

for (const auth of ["token", "session", "anonymous"] as const) {
  const name = auth === "anonymous" ? "skips GitLab indexing without authorization"
    : `indexes a private GitLab source archive using its ${auth} in same-origin mode`;
  test(name, async ({ context, page }) => {
    await mockGitlab(context);
    await context.route(GITLAB_DIFF, (route) => route.fulfill({
      contentType: "text/plain; charset=utf-8",
      body: [
        "diff --git a/use.go b/use.go", "--- a/use.go", "+++ b/use.go", "@@ -1,1 +1,2 @@",
        " package demo", "+var x = y", "",
      ].join("\n"),
    }));
    const archive = tarGzip({ "go.mod": "module example.com/demo\n", "use.go": "package demo\nvar x = y\n", "value.go": "package demo\nconst y = 1\n" });
    const endpoint = `${HOST}/api/v4/projects/${encodeURIComponent(PROJECT)}/repository/archive.tar.gz?sha=${"1".repeat(40)}&include_lfs_blobs=false`;
    const requests: (string | undefined)[] = [];
    const credentials = (headers: Record<string, string>) =>
      auth === "token" ? headers["private-token"] : headers.cookie;
    await context.route(endpoint, (route) => {
      const headers = route.request().headers();
      requests.push(credentials(headers));
      return route.fulfill({ body: archive, contentType: "application/gzip" });
    });
    await context.route(`${HOST}/api/v4/user`, (route) => auth === "anonymous"
      ? route.fulfill({ status: 401, json: { message: "Unauthorized" } }) : route.fallback());
    if (auth === "token") {
      await seedToken(context, page, GITLAB_DIFF, TOKEN_HOST);
    } else {
      if (auth === "session") await context.addCookies([{ name: "_gitlab_session", value: "e2e-session", url: HOST }]);
      await page.goto(GITLAB_DIFF);
    }
    const settings = page.locator("#pt-settings");
    await settings.locator("summary").first().click();
    if (auth === "anonymous") {
      await expect(settings.getByRole("status")).toHaveText("Sign in to build a code index.");
      await expect(settings.getByRole("button", { name: "Index Go sources" })).toHaveCount(0);
      expect(requests).toEqual([]);
      return;
    }
    await settings.getByRole("button", { name: "Index Go sources" }).click();
    await expect(settings.getByRole("status")).toHaveText(/Indexed 11111111/);
    const credential = auth === "token" ? "e2e-token" : "_gitlab_session=e2e-session";
    expect(requests).toEqual([credential]);
  });
}

async function caretOn(cell: Locator, token: string) {
  await cell.evaluate((element, token) => {
    let offset = element.textContent!.indexOf(token);
    if (offset < 0) throw new Error(`Missing token ${token}`);
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent!.length;
      if (offset < length) {
        getSelection()!.collapse(node, offset);
        return;
      }
      offset -= length;
    }
    throw new Error(`Missing text for ${token}`);
  }, token);
}

const tsSources = {
  "tsconfig.base.json": '{ "compilerOptions": { "baseUrl": ".", "paths": { "@pkg/*": ["src/*"] } } }',
  "tsconfig.json": '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }',
  "tsconfig.app.json": '{ "extends": "./tsconfig.base.json", "compilerOptions": { "jsx": "preserve" } }',
  "src/math.ts": "export const pick = () => 1;\nexport const again = () => pick();\n",
  "src/other.ts": "export const pick = () => 2;\n",
  "src/entry.ts": 'export { pick as chosen } from "./math";\n',
  "src/widget.tsx": "export function Widget() { return <div />; }\n",
  "src/client.jsx": 'import { chosen } from "@pkg/entry";\nimport { Widget } from "./widget";\nexport const view = <Widget n={chosen()} />;\n',
  "src/main.js": 'import { chosen } from "@pkg/entry";\nimport { pick } from "./other";\nexport const values = [chosen(), pick()];\nexport const result = values;\n',
};
const clangSources = {
  "compile_commands.json": JSON.stringify([
    { directory: "/checkout/project/build", file: "../src/main.c",
      arguments: ["clang", "-I../inc", "-include", "config.h", "-DFEATURE=1", "-std=c17", "-c", "../src/main.c", "-o", "main.o"] },
    { directory: "/checkout/project/build", file: "../src/defs.c",
      command: "clang -I../inc -DFEATURE=1 -c ../src/defs.c -o defs.o" },
    { directory: "/checkout/project/build", file: "../src/main.cpp",
      command: "clang++ -std=c++20 -I../inc -c ../src/main.cpp -o cpp.o" },
  ]),
  "inc/config.h": "#if FEATURE\nstruct First { int value; };\nstruct Other { int value; };\nint get(void);\n#define PASS(x) (x)\n#endif\n",
  "src/defs.c": '#include "config.h"\nint get(void) { return 3; }\n',
  "src/missing.c": '#include "generated.h"\n',
  "src/main.c": '\nint consume(struct First v) { return PASS(v.value) + get(); }\n',
  "inc/overload.hpp": "inline int choose(int x) { return x; }\ninline int choose(double x) { return 0; }\n",
  "src/main.cpp": '#include "overload.hpp"\nint fromInt() { return choose(1); }\nint fromDouble() { return choose(1.0); }\nint local() { return fromInt(); }\n',
};

for (const [analyzer, changed, from, token, target, row, buildContext] of [
  ["JavaScript/TypeScript", ["src/main.js", "src/client.jsx"], "src/main.js", "chosen", "src/math.ts", 1],
  ["C/C++", ["src/main.c", "src/main.cpp"], "src/main.c", "value", "inc/config.h", 2],
  ["C/C++", ["src/main.c", "src/main.cpp"], "src/main.c", "value", "inc/config.h", 2, true],
] as const) {
  test(`indexes ${analyzer}${buildContext ? " with build context" : ""} in the extension and reopens its saved index`, async ({ context, page }) => {
    await mockGithub(context);
    const head = "1".repeat(40);
    const sources: Record<string, string> = analyzer === "C/C++" ? clangSources : tsSources;
    const diff = changed.map((path) => {
      const lines = sources[path].trimEnd().split("\n");
      return [`diff --git a/${path} b/${path}`, "--- /dev/null", `+++ b/${path}`,
        `@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`), ""].join("\n");
    }).join("");
    await context.route(DIFF_URL, (route) => route.fulfill({ body: diff, contentType: "text/plain; charset=utf-8" }));
    for (const [path, body] of Object.entries(sources))
      await context.route(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${head}`,
        (route) => route.fulfill({ body, contentType: "text/plain; charset=utf-8" }));
    await seedToken(context, page, DIFF_URL, "github.com");
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    await worker.evaluate(({ endpoint, archive }) => {
      const scope = globalThis as typeof globalThis & { archiveDownloads: number };
      scope.archiveDownloads = 0;
      const realFetch = fetch.bind(globalThis);
      globalThis.fetch = (input, init) => {
        if (input !== endpoint) return realFetch(input, init);
        scope.archiveDownloads++;
        return Promise.resolve(new Response(new Uint8Array(archive)));
      };
    }, { endpoint: `https://api.github.com/repos/${OWNER}/${REPO}/tarball/${head}`, archive: [...tarGzip(sources)] });

    const status = page.locator(".pt-set-row").filter({ hasText: "Code index" }).getByRole("status", { includeHidden: true });
    await expect(status).toBeAttached();
    const diffCell = (path: string, line: number) => page.locator(`section[data-path="${path}"] .pt-unified tr[data-new="${line}"] .pt-code`);
    const definitions = page.getByRole("dialog", { name: "Go to definition" });
    const goto = async (cell: Locator, name: string) => {
      await caretOn(cell, name);
      await page.keyboard.press("Control+Enter");
    };
    if (buildContext) {
      const settings = page.locator("#pt-settings");
      await settings.locator("summary").first().click();
      const upload = async (revision: string) => {
        const [picker] = await Promise.all([
          page.waitForEvent("filechooser"),
          settings.getByRole("button", { name: "Index with build context…" }).click(),
        ]);
        await picker.setFiles({
          name: "context.tar.gz",
          mimeType: "application/gzip",
          buffer: tarGzip({ ...sources, "patchtree-build-context.json": JSON.stringify({ revision }) }),
        });
      };
      const progress = settings.getByRole("progressbar", { name: "C/C++ indexing progress" });
      await upload("2".repeat(40));
      await expect(status).toHaveText(/Build context belongs to a different revision/);
      await expect(progress).toBeHidden();
      await upload(head);
      await expect(progress).toBeVisible();
      await expect(status).toHaveText("Indexed 11111111");
      await expect(progress).toBeHidden();
      await settings.locator("summary").first().click();
    }
    const coldStart = Date.now();
    await goto(diffCell(from, analyzer === "C/C++" ? 2 : 3), token);
    await expect(definitions.getByRole("button", { name: `${target}:${row}`, exact: true })).toBeFocused({ timeout: 30_000 });
    console.log(`${analyzer} cold goto: ${Date.now() - coldStart} ms`);
    await definitions.getByRole("button", { name: `${target}:${row}`, exact: true }).press("Enter");
    const viewer = page.getByRole("dialog", { name: target });
    const current = (file: Locator) => file.locator('[aria-current="location"] code');
    await expect(current(viewer)).toHaveAttribute("data-line", String(row));
    const definitionName = analyzer === "C/C++" ? "value" : "pick";
    await caretOn(current(viewer), definitionName);
    await page.keyboard.press("Shift+F12");
    await viewer.getByRole("region", { name: `References for ${definitionName}` })
      .getByRole("button", { name: new RegExp(`^${from}:`) }).last().click();
    const other = page.getByRole("dialog", { name: from });
    await expect(current(other)).toBeVisible();
    await goto(current(other), token);
    await expect(current(viewer)).toHaveAttribute("data-line", String(row));
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(current(other)).toBeVisible();
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(current(viewer)).toHaveAttribute("data-line", String(row));
    await viewer.getByRole("button", { name: "Close file" }).click();
    await expect(viewer).toHaveCount(0);

    const usage = diffCell(from, analyzer === "C/C++" ? 2 : 3);
    await usage.scrollIntoViewIfNeeded();
    await caretOn(usage, token);
    const point = await usage.evaluate(() => {
      const range = getSelection()!.getRangeAt(0);
      range.setEnd(range.startContainer, range.startOffset + 1);
      const { x, y, width, height } = range.getBoundingClientRect();
      getSelection()!.collapseToStart();
      return { x: x + width / 2, y: y + height / 2 };
    });
    await page.mouse.click(point.x, point.y, { button: "right" });
    const refs = page.getByRole("dialog", { name: "Find references" });
    await expect(refs.locator(".pt-reference-row")).not.toHaveCount(0);
    await page.keyboard.press("Escape");
    if (analyzer === "C/C++") {
      if (!buildContext) {
        const settings = page.locator("#pt-settings");
        await settings.locator("summary").first().click();
        await expect(status).toHaveText(/Partially indexed/);
        await settings.getByText("Indexing limitations", { exact: true }).click();
        await expect(settings.getByText(/generated\.h.*file not found/)).toBeVisible();
        await settings.locator("summary").first().click();
      }
      for (const [line, destination] of [[2, 1], [3, 2]]) {
        await goto(diffCell("src/main.cpp", line), "choose");
        await expect(definitions.getByRole("button", { name: `inc/overload.hpp:${destination}` })).toBeFocused();
        await page.keyboard.press("Escape");
      }
      for (const [name, path] of [["PASS", "inc/config.h:5"], ["get", "src/defs.c:2"]]) {
        await goto(diffCell(from, 2), name);
        await expect(definitions.getByRole("button", { name: path })).toBeFocused();
        await page.keyboard.press("Escape");
      }
      await goto(diffCell("src/main.cpp", 4), "fromInt");
      await expect(diffCell("src/main.cpp", 2).locator("..")).toHaveClass(/pt-flash/);
    } else {
      await goto(diffCell("src/client.jsx", 3), "Widget");
      await expect(definitions.getByRole("button", { name: "src/widget.tsx:1" })).toBeFocused();
      await page.keyboard.press("Escape");
      await goto(diffCell(from, 3), "pick");
      await expect(definitions.getByRole("button", { name: "src/other.ts:1" })).toBeFocused();
      await page.keyboard.press("Escape");
      await goto(diffCell(from, 4), "values");
      await expect(diffCell(from, 3).locator("..")).toHaveClass(/pt-flash/);
    }
    const warmStart = Date.now();
    await page.reload();
    await expect(status).toHaveText(/Indexed 11111111/i);
    await goto(diffCell(from, analyzer === "C/C++" ? 2 : 3), token);
    await expect(definitions.getByRole("button", { name: `${target}:${row}`, exact: true })).toBeFocused();
    console.log(`${analyzer} reload + cached goto: ${Date.now() - warmStart} ms`);
    if (buildContext) {
      await page.keyboard.press("Escape");
      const settings = page.locator("#pt-settings");
      await settings.locator("summary").first().click();
      await settings.getByText("Cache storage", { exact: true }).click();
      await settings.getByRole("button", { name: "Clear indexes", exact: true }).click();
      await expect(status).toBeEmpty();
      await settings.getByRole("button", { name: "Index C/C++ sources" }).click();
      await expect(status).toHaveText("Indexed 11111111");
    }
    expect(await worker.evaluate(() => (globalThis as typeof globalThis & { archiveDownloads: number }).archiveDownloads)).toBe(buildContext ? 0 : 1);
  });
}

test("reuses C/C++ analysis across merge requests and invalidates changed includes", async ({ context, page }) => {
  await mockGitlab(context);
  const source = [
    '#if __has_include("alternative.h")', '#include "alternative.h"', "#else",
    '#include "bridge.h"', "#endif", "int use(void) { return answer(); }",
  ];
  const sources = {
    "compile_commands.json": JSON.stringify(["main", "other"].map((name) => ({
      directory: "/project", file: `src/${name}.c`, arguments: ["clang", "-Iinc", `src/${name}.c`],
    }))),
    "src/main.c": `${source.join("\n")}\n`,
    "src/other.c": "int independent(void) { return 2; }\n",
    "inc/bridge.h": '#include "leaf.h"\n',
    "inc/leaf.h": "static inline int answer(void) { return 1; }\n",
  };
  const heads = ["1", "2", "3"].map((digit) => digit.repeat(40));
  const urls = heads.map((_, i) => `${HOST}/${PROJECT}/-/merge_requests/${201 + i}.diff`);
  for (const [i, url] of urls.entries()) {
    await context.route(url, (route) => route.fulfill({
      contentType: "text/plain; charset=utf-8",
      body: ["diff --git a/src/main.c b/src/main.c", "--- /dev/null", "+++ b/src/main.c",
        "@@ -0,0 +1,6 @@", ...source.map((line) => `+${line}`), ""].join("\n"),
    }));
    await context.route(`**/merge_requests/${201 + i}`, (route) => route.fulfill({ json: {
      title: "C++ review", state: "opened", source_project_id: 42,
      diff_refs: { head_sha: heads[i], base_sha: "0".repeat(40), start_sha: "0".repeat(40) },
    } }));
  }
  await context.addCookies([{ name: "_gitlab_session", value: "e2e-session", url: HOST }]);
  const oldChunk = "patchtree-index-chunks-v1-0-test-eviction";
  for (const [i, url] of urls.entries()) {
    if (i === 2) {
      const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
      await worker.evaluate(async (chunk) => {
        const indexes = await caches.open("patchtree-index-v4");
        await caches.open(chunk);
        for (let n = 0; n < 8; n++) {
          const headers = new Headers({ "X-Patchtree-Expires": String(Date.now() + 86400_000), "X-Patchtree-Size": "1" });
          if (n === 0) headers.set("X-Patchtree-Chunk-Cache", chunk);
          await indexes.put(`https://gitlab.example.com/older-index/${n}`, new Response("0", { headers }));
        }
      }, oldChunk);
    }
    await page.goto(url);
    const settings = page.locator("#pt-settings");
    const status = settings.locator(".pt-code-index-row [role=status]");
    await settings.locator("summary").first().click();
    const [picker] = await Promise.all([
      page.waitForEvent("filechooser"),
      settings.getByRole("button", { name: "Index with build context…" }).click(),
    ]);
    await picker.setFiles({
      name: "context.tar.gz", mimeType: "application/gzip",
      buffer: tarGzip({
        ...sources,
        "inc/leaf.h": i ? `\n${sources["inc/leaf.h"]}` : sources["inc/leaf.h"],
        ...(i === 2 ? { "inc/alternative.h": "static inline int answer(void) { return 3; }\n" } : {}),
        "patchtree-build-context.json": JSON.stringify({ revision: heads[i] }),
      }),
    });
    await expect(status).toHaveText(`Indexed ${heads[i].slice(0, 8)}`);
    if (i) await expect(settings.getByText("Reused 1/2 C/C++ translation units")).toBeVisible();
    await settings.locator("summary").first().click();

    await caretOn(page.locator('.pt-unified tr[data-new="6"] .pt-code'), "answer");
    await page.keyboard.press("Control+Enter");
    await expect(page.getByRole("dialog", { name: "Go to definition" }).getByRole("button", {
      name: ["inc/leaf.h:1", "inc/leaf.h:2", "inc/alternative.h:1"][i], exact: true,
    })).toBeFocused();
    await page.keyboard.press("Escape");
  }
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  expect(await worker.evaluate(async ({ chunk, head }) => {
    const storage = await caches.open("patchtree-index-v4");
    const keys = await storage.keys();
    const current = await storage.match(keys.find((item) => item.url.includes(head))!);
    const size = Number(current?.headers.get("X-Patchtree-Size"));
    const body = await current!.blob();
    return {
      indexes: keys.length, oldChunk: await caches.has(chunk),
      countedOnce: size === body.size + (JSON.parse(await body.text()) as { bytes: number }).bytes,
    };
  }, { chunk: oldChunk, head: heads[2] })).toEqual({ indexes: 8, oldChunk: false, countedOnce: true });
  const settings = page.locator("#pt-settings");
  await settings.locator("summary").first().click();
  await settings.getByText("Cache storage", { exact: true }).click();
  const reusable = settings.getByText(/Reusable analysis/);
  await expect(reusable).toContainText("2 entries");
  await settings.getByRole("button", { name: "Clear indexes", exact: true }).click();
  await expect(reusable).toBeHidden();
});

test("reuses Go importers after a function body edit and updates moved definitions", async ({ context, page }) => {
  await mockGitlab(context);
  const call = "var result = shared.Value()";
  const heads = ["1", "2", "3"].map((digit) => digit.repeat(40));
  const reviews = heads.map((_, i) => `${HOST}/${PROJECT}/-/merge_requests/${301 + i}.diff`);
  const archives = heads.map((_, i) => tarGzip({
    "go.mod": "module example.com/demo\n",
    "use.go": `package demo\nimport "example.com/demo/shared"\n${call}\n`,
    "shared/def.go": `package shared\n${i === 2 ? "\n" : ""}func Value() int { return ${i ? 2 : 1} }\n`,
    "other/value.go": "package other\nconst Independent = 1\n",
  }));
  await context.route(`${HOST}/api/v4/projects/**/repository/archive.tar.gz?**`, (route) => {
    const sha = new URL(route.request().url()).searchParams.get("sha") ?? "";
    return route.fulfill({ body: archives[heads.indexOf(sha)], contentType: "application/gzip" });
  });
  for (const [i, review] of reviews.entries()) {
    await context.route(review, (route) => route.fulfill({
      contentType: "text/plain",
      body: `diff --git a/use.go b/use.go\n--- a/use.go\n+++ b/use.go\n@@ -1,2 +1,3 @@\n package demo\n import "example.com/demo/shared"\n+${call}\n`,
    }));
    await context.route(`**/merge_requests/${301 + i}`, (route) => route.fulfill({ json: {
      title: "Go review", state: "opened", source_project_id: 42,
      diff_refs: { head_sha: heads[i], base_sha: "0".repeat(40), start_sha: "0".repeat(40) },
    } }));
  }
  await context.addCookies([{ name: "_gitlab_session", value: "e2e-session", url: HOST }]);
  for (const [i, review] of reviews.entries()) {
    await page.goto(review);
    const settings = page.locator("#pt-settings");
    await settings.locator("summary").first().click();
    await settings.getByRole("button", { name: "Index Go sources" }).click();
    await expect(settings.locator(".pt-code-index-row [role=status]")).toHaveText(`Indexed ${heads[i].slice(0, 8)}`);
    if (i) await expect(settings.getByText(`Reused ${3 - i}/3 Go package variants`)).toBeVisible();
    await settings.locator("summary").first().click();
    await caretOn(page.locator('.pt-unified tr[data-new="3"] .pt-code'), "Value");
    await page.keyboard.press("Control+Enter");
    await expect(page.getByRole("dialog", { name: "Go to definition" }).getByRole("button", {
      name: `shared/def.go:${i === 2 ? 3 : 2}`,
    })).toBeFocused();
    await page.keyboard.press("Escape");
  }
});
