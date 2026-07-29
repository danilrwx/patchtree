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
