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

// A plain unified diff served from a host with no provider (the same path a
// local file:// patch takes): it must still render, but the source-fetching
// controls — expand hidden lines and full file — must be absent.
import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect } from "./fixtures";

const diff = readFileSync(path.join(__dirname, "../fixtures/plain.diff"), "utf8");
const URL = "https://example.com/gpu.patch";

test("plain patch from a non-provider host renders without expand controls", async ({
  context,
  page,
}) => {
  await context.route(URL, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body: diff })
  );
  await page.goto(URL);

  // both files render
  await expect(page.locator(".pt-file-header")).toHaveCount(2);
  await expect(page.locator(".pt-path", { hasText: "pkg/gpu/gpu.go" })).toBeVisible();

  // no provider → no source fetching
  await expect(page.locator(".pt-expander")).toHaveCount(0);
  await expect(page.locator(".pt-fullfile")).toHaveCount(0);

  // the tree toggle stays pinned to the far left of the bar even here, where
  // there is no review layer to anchor it
  const bar = (await page.locator("#pt-bar").boundingBox())!;
  const toggle = (await page.locator("#pt-collapse").boundingBox())!;
  const seg = (await page.locator("#pt-bar .pt-seg").boundingBox())!;
  expect(toggle.x - bar.x).toBeLessThan(6);
  expect(toggle.x + toggle.width).toBeLessThan(seg.x);
});

// `diff -up dir1/file dir2/file` (suckless-style) has different --- / +++ paths
// for the *same* file — that is not a rename, only an explicit rename from/to is
test("a tool diff with differing --- / +++ paths is not treated as a rename", async ({
  context,
  page,
}) => {
  const body = readFileSync(path.join(__dirname, "../fixtures/difftool.diff"), "utf8");
  const url = "https://example.com/dwm.diff";
  await context.route(url, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body })
  );
  await page.goto(url);

  await expect(page.locator(".pt-file-header")).toHaveCount(2);
  await expect(page.locator(".pt-tree-file.pt-st-renamed")).toHaveCount(0);
  await expect(page.locator(".pt-rename")).toHaveCount(0);
  await expect(page.locator(".pt-namediff")).toHaveCount(0);
  await expect(page.locator(".pt-tree-file.pt-st-modified")).toHaveCount(2);
});

// a plain diff reveals a wholly-new file only through its `@@ -0,0 +… @@` hunk
// (no `new file mode` / `/dev/null`): it must render full width, not as a
// right-hand split column, and count as an addition
test("a plain-diff new file renders full width and counts as added", async ({
  context,
  page,
}) => {
  const body = readFileSync(path.join(__dirname, "../fixtures/plainnew.diff"), "utf8");
  const url = "https://example.com/plainnew.diff";
  await context.route(url, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body })
  );
  await page.goto(url);

  await expect(page.locator(".pt-file-header")).toHaveCount(2);
  // the new file is added + full width, the other is a normal modification
  await expect(page.locator(".pt-tree-file.pt-st-added")).toHaveCount(1);
  const added = page.locator("section.pt-file", { hasText: "upload_test.go" });
  await expect(added).toHaveClass(/pt-full/);
});

// after a reload we must land back on the file the user was viewing, not
// wherever the browser's height-estimate-based scroll restoration guesses
test("a reload returns to the file the user was on", async ({ context, page }) => {
  const body = readFileSync(path.join(__dirname, "../fixtures/manyfiles.diff"), "utf8");
  const url = "https://example.com/manyfiles.diff";
  await context.route(url, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body })
  );
  await page.setViewportSize({ width: 1200, height: 400 });
  await page.goto(url);
  await expect(page.locator("section.pt-file")).toHaveCount(10);

  // scroll a middle file to the top so it becomes the active file (and is saved)
  await page.evaluate(() => {
    document
      .querySelectorAll("section.pt-file")
      [6]?.scrollIntoView();
  });
  await expect(page.locator(".pt-tree-file.pt-active")).toHaveAttribute("data-path", /mod07/);
  await page.waitForTimeout(300); // let the async storage write settle

  await page.reload();

  const target = page.locator("section.pt-file", { hasText: "mod07/file.go" });
  await expect
    .poll(async () => (await target.boundingBox())?.y ?? 9999, { timeout: 5000 })
    .toBeLessThan(150);
});

// misc.diff bundles a format-patch preamble, a modified file, a deleted file,
// and a generated file (go.sum) — all rendered locally, no provider.
async function openMisc(context: any, page: any) {
  const body = readFileSync(path.join(__dirname, "../fixtures/misc.diff"), "utf8");
  const url = "https://example.com/misc.diff";
  await context.route(url, (route) =>
    route.fulfill({ contentType: "text/plain; charset=utf-8", body })
  );
  await page.goto(url);
  await expect(page.locator("section.pt-file")).toHaveCount(3);
}

test("a format-patch preamble renders above the files", async ({ context, page }) => {
  await openMisc(context, page);
  await expect(page.locator("#pt-preamble")).toContainText("rework the app and drop the legacy");
});

test("a generated file gets a badge and starts folded", async ({ context, page }) => {
  await openMisc(context, page);
  const gen = page.locator("section.pt-file", { hasText: "go.sum" });
  await expect(gen.locator(".pt-gen-badge")).toBeVisible();
  await expect(gen).toHaveClass(/pt-folded/);
});

test("the funnel can hide deleted files", async ({ context, page }) => {
  await openMisc(context, page);
  await expect(page.locator(".pt-tree-file.pt-st-deleted")).toHaveCount(1);

  await page.locator(".pt-filter-dd > summary").click();
  await page
    .locator(".pt-filter-row", { hasText: "Deleted files" })
    .locator("input")
    .evaluate((el: HTMLInputElement) => {
      el.checked = false;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  await expect(page.locator(".pt-tree-file.pt-st-deleted:visible")).toHaveCount(0);
});
