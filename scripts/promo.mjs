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

// Renders the Chrome Web Store promo images (small tile 440x280 and marquee
// 1400x560) from an HTML template, using the extension's own fonts and a real
// screenshot. Output is JPEG because the store rejects PNGs with an alpha
// channel. Usage: node scripts/promo.mjs (after scripts/scenes.mjs).
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "docs/store");

const dataUrl = (rel, mime) =>
  `data:${mime};base64,${readFileSync(path.join(root, rel)).toString("base64")}`;

const mono = dataUrl("assets/fonts/JetBrainsMono-Regular.woff2", "font/woff2");
const monoBold = dataUrl("assets/fonts/JetBrainsMono-Bold.woff2", "font/woff2");
const icon = dataUrl("assets/icons/icon128.png", "image/png");
const shot = dataUrl("docs/store/01-overview.png", "image/png");

// the marquee has room for a screenshot; at 440x280 a screenshot is unreadable,
// so the small tile is type plus a stylised diff strip instead
const page = (scale, compact) => `<!doctype html>
<meta charset="utf-8">
<style>
  @font-face { font-family: JB; src: url("${mono}") format("woff2"); font-weight: 400 }
  @font-face { font-family: JB; src: url("${monoBold}") format("woff2"); font-weight: 700 }
  * { margin: 0; box-sizing: border-box }
  html, body { width: 100%; height: 100% }
  body {
    font-family: JB, ui-monospace, monospace;
    background: linear-gradient(135deg, #ffffff 0%, #eef3f8 55%, #dfe9f3 100%);
    display: flex;
    align-items: center;
    gap: ${5 * scale}px;
    padding: ${8 * scale}px ${10 * scale}px;
    overflow: hidden;
  }
  .copy { flex: 0 0 auto; width: ${118 * scale}px }
  .brand { display: flex; align-items: center; gap: ${2.6 * scale}px }
  .brand img { width: ${11 * scale}px; height: ${11 * scale}px }
  .brand b { font-size: ${11.5 * scale}px; font-weight: 700; color: #1f2328; letter-spacing: -.02em }
  .tag {
    margin-top: ${3.4 * scale}px;
    font-size: ${5.1 * scale}px;
    line-height: 1.45;
    color: #384049;
  }
  .tag em { font-style: normal; color: #108548; font-weight: 700 }
  .hosts {
    margin-top: ${3.4 * scale}px;
    font-size: ${4.1 * scale}px;
    color: #59636e;
  }
  .shot {
    flex: 1 1 auto;
    height: 100%;
    border: 1px solid #cbd5e1;
    border-radius: ${2.4 * scale}px;
    box-shadow: 0 ${1.4 * scale}px ${4 * scale}px rgba(15, 23, 42, .18);
    background: url("${shot}") left top / auto ${118 * scale}px no-repeat #fff;
  }

  /* compact tile: one column, wider copy, a diff strip standing in for the UI */
  body.compact { flex-direction: column; align-items: stretch; justify-content: center; gap: ${5 * scale}px }
  body.compact .copy { width: auto }
  body.compact .tag { font-size: ${5.6 * scale}px }
  .strip {
    border: 1px solid #cbd5e1;
    border-radius: ${2 * scale}px;
    overflow: hidden;
    font-size: ${4.6 * scale}px;
    line-height: 1.75;
    background: #fff;
  }
  .strip div { padding: 0 ${2.4 * scale}px; white-space: nowrap }
  .strip .a { background: #dafbe1 }
  .strip .d { background: #ffebe9 }
  .k { color: #cf222e }
  .s { color: #0a3069 }
  .f { color: #8250df }
</style>
<div class="copy">
  <div class="brand"><img src="${icon}" alt=""><b>patchtree</b></div>
  <div class="tag">Raw <b>.diff</b> pages become a real code review UI — with
    <em>tree-sitter</em> syntax highlighting.</div>
  <div class="hosts">GitLab · GitHub · local patches</div>
</div>
${
  compact
    ? `<div class="strip">
         <div class="d">- <span class="k">func</span> <span class="f">Count</span>(m <span class="k">map</span>[<span class="k">string</span>]<span class="k">int</span>) <span class="k">int</span> {</div>
         <div class="a">+ <span class="k">func</span> <span class="f">Count</span>[T <span class="k">any</span>](m <span class="k">map</span>[<span class="k">string</span>]T) <span class="k">int</span> {</div>
         <div>&nbsp;&nbsp;&nbsp;<span class="k">return</span> <span class="f">len</span>(m)</div>
       </div>`
    : `<div class="shot"></div>`
}
`;

const browser = await chromium.launch();
for (const [w, h, scale, name, compact] of [
  [440, 280, 3.1, "promo-small-440x280", true],
  [1400, 560, 5, "promo-marquee-1400x560", false],
]) {
  const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await p.setContent(page(scale, compact));
  if (compact) await p.evaluate(() => document.body.classList.add("compact"));
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: path.join(out, `${name}.jpg`), type: "jpeg", quality: 92 });
  console.log(`${name}.jpg ${w}x${h}`);
  await p.close();
}
await browser.close();
