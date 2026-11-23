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

function tarGzip(files: Record<string, string>) {
  const blocks: Buffer[] = [];
  for (const [name, source] of Object.entries(files)) {
    const data = Buffer.from(source);
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
  await page.goto(DIFF_URL);
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

  const cacheKey = `${repository}/.patchtree-index/${head}`;
  await worker.evaluate(async (key) => {
    const cache = await caches.open("patchtree-go-index-v3");
    const saved = await cache.match(key);
    if (!saved) throw new Error("Missing cached index");
    const expires = Number(saved.headers.get("X-Patchtree-Expires"));
    if (expires - Date.now() < 29 * 24 * 60 * 60 * 1000) throw new Error("Index TTL is too short");
    await cache.put(key, new Response(saved.body, { headers: { "X-Patchtree-Expires": "1" } }));
  }, cacheKey);
  await page.reload();
  await expect(status).not.toHaveText(/Indexed/);
  expect(await downloads()).toBe(1);
  await clickSymbol("Label");
  await expect.poll(downloads).toBe(2);
  await worker.evaluate(() => (globalThis as typeof globalThis & { releaseArchive: () => void }).releaseArchive());
  await expect(dialog.locator("pre .pt-keyword").first()).toHaveText("func");
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
  await page.goto(url);
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
  await page.goto(diffURL);
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
  const encoding = await worker.evaluate(async (key) => {
    const cache = await caches.open("patchtree-go-index-v3");
    return (await cache.match(key))?.headers.get("X-Patchtree-Index-Encoding");
  }, `${repository}/.patchtree-index/${sha}`);
  expect(encoding).toBe("gzip");
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

test("indexes a GitLab source archive through the MR origin", async ({ context, page }) => {
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
  let token: string | undefined;
  await context.route(endpoint, (route) => {
    token = route.request().headers()["private-token"];
    return route.fulfill({ body: archive, contentType: "application/gzip" });
  });
  await seedToken(context, page, GITLAB_DIFF, TOKEN_HOST);
  const settings = page.locator("#pt-settings");
  await settings.locator("summary").first().click();
  await settings.getByRole("button", { name: "Index Go sources" }).click();
  await expect(settings.getByRole("status")).toHaveText(/Indexed 11111111/);
  expect(token).toBe("e2e-token");
});
