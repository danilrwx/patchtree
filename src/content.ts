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

"use strict";

import { resolveLang, parseDiff, esc, buildFileModel } from "./diff";
import { render } from "solid-js/web";
import { unwrap, reconcile } from "solid-js/store";
import { FileTree } from "./components/FileTree";
import { DiffFile } from "./components/DiffFile";
import { Toolbar } from "./components/Toolbar";
import { Settings } from "./components/Settings";
import { GeneralThreads } from "./components/Thread";
import { TokensDialog } from "./components/TokensDialog";
import { ThemeGallery } from "./components/ThemeGallery";
import {
  setTreeFiles,
  setFilter,
  setViewed,
  setCounts,
  viewed,
  setViewMode,
  setCanExpand,
  setViewedDone,
  setViewedTotal,
  settings,
  setSettings,
  setThemeOptions,
  setHighlights,
  hlKey,
  setCtxLines,
  setCtxHl,
  setGapFull,
  setGapErr,
  ctxKey,
  resetDiffState,
  setFileLines,
} from "./store";
import { makeProvider } from "./providers";
import { initReview, type PtView } from "./review";
import type { Provider } from "./types";

// Highlighting is skipped for sides bigger than this to keep the page responsive.
const MAX_HIGHLIGHT_CHARS = 300 * 1024;

let viewedSet = new Set<string>();
let saveViewed = () => {};
// resolved provider (null for a local/non-provider page) and the progress
// updater — module-scoped because top-level helpers reference them
let provider: Provider | null = null;
let updateProgress: () => void = () => {};

// Fetch the hidden lines a gap hides and publish them (plus their highlight)
// to the store; <DiffFile> renders the context rows and hides the now-redundant
// following hunk header when the gap is fully filled.
async function expandGap(view: any, gap: any) {
  if (gap.busy || gap.newTo == null) return;
  gap.busy = true;
  try {
    if (!provider?.fetchFile) throw new Error("file contents unavailable here");
    const lines = await provider.fetchFile(view.path);
    const to = Math.min(gap.newTo, lines.length);
    const arr: { o: number; n: number; text: string }[] = [];
    for (let n = gap.newFrom; n <= to; n++) {
      const o = gap.oldFrom + (n - gap.newFrom);
      arr.push({ o, n, text: lines[n - 1] ?? "" });
    }
    setCtxLines(gap.id, arr);
    // a fully expanded inter-hunk gap makes the following @@ header redundant
    if (to === gap.newTo) setGapFull(gap.id, true);
    if (view.lang && arr.length) {
      const resp: any = await chrome.runtime
        .sendMessage({ type: "highlight", lang: view.lang, text: arr.map((c) => c.text).join("\n") })
        .catch(() => null);
      if (resp?.rows)
        for (const [row, ranges] of Object.entries(resp.rows)) setCtxHl(ctxKey(gap.id, +row), ranges as any);
    }
  } catch (e: any) {
    gap.busy = false;
    setGapErr(gap.id, e.message);
  }
}

// @font-face lives here, not in the injected CSS: extension-resource URLs
// need runtime.getURL to work on both chrome-extension:// and moz-extension://
const FONT_FACES = [
  ["JetBrains Mono", "400", "normal", "JetBrainsMono-Regular.woff2"],
  ["JetBrains Mono", "400", "italic", "JetBrainsMono-Italic.woff2"],
  ["JetBrains Mono", "700", "normal", "JetBrainsMono-Bold.woff2"],
  ["Inter", "100 900", "normal", "InterVariable.woff2"],
  ["Inter", "100 900", "italic", "InterVariable-Italic.woff2"],
  ["JetBrainsMono Nerd Font Mono", "400", "normal", "JetBrainsMonoNerdFontMono-Regular.woff2"],
  ["JetBrainsMono Nerd Font Mono", "700", "normal", "JetBrainsMonoNerdFontMono-Bold.woff2"],
  ["FiraCode Nerd Font Mono", "400", "normal", "FiraCodeNerdFontMono-Regular.woff2"],
  ["FiraCode Nerd Font Mono", "700", "normal", "FiraCodeNerdFontMono-Bold.woff2"],
  ["Hack Nerd Font Mono", "400", "normal", "HackNerdFontMono-Regular.woff2"],
  ["Hack Nerd Font Mono", "700", "normal", "HackNerdFontMono-Bold.woff2"],
  ["MesloLGS Nerd Font Mono", "400", "normal", "MesloLGSNerdFontMono-Regular.woff2"],
  ["MesloLGS Nerd Font Mono", "700", "normal", "MesloLGSNerdFontMono-Bold.woff2"],
  ["Iosevka Nerd Font Mono", "400", "normal", "IosevkaNerdFontMono-Regular.woff2"],
  ["Iosevka Nerd Font Mono", "700", "normal", "IosevkaNerdFontMono-Bold.woff2"],
];

function injectFonts() {
  const css = FONT_FACES.map(
    ([family, weight, style, file]) =>
      `@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};` +
      `src:url("${chrome.runtime.getURL(`assets/fonts/${file}`)}") format("woff2");}`
  ).join("\n");
  const el = document.createElement("style");
  el.textContent = css;
  document.documentElement.appendChild(el);
}

const GENERATED_RE =
  /(^|\/)(go\.sum|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|composer\.lock|Gemfile\.lock|poetry\.lock)$|\.pb\.go$|zz_generated|\.generated\.|\.min\.(js|css)$|\.map$|(^|\/)vendor\//;

function buildFileView(file: any) {
  const section = document.createElement("section");
  section.className = "pt-file";

  const path = file.newPath || file.oldPath || "(unknown)";
  section.dataset.path = path;
  let adds = 0;
  let dels = 0;
  for (const h of file.hunks)
    for (const l of h.lines) {
      if (l.t === "+") adds++;
      else if (l.t === "-") dels++;
    }

  const generated = GENERATED_RE.test(path);
  const model = buildFileModel(file);
  if (model.full) section.classList.add("pt-full");

  const view = {
    section,
    path,
    adds,
    dels,
    texts: { old: model.oldText, new: model.newText },
    lang: resolveLang(path, `${model.newText}\n${model.oldText}`),
  };

  const setFolded = (f: boolean) => section.classList.toggle("pt-folded", f);
  const gaps = [...model.segments.map((s) => s.gap), model.trailingGap].filter(Boolean);

  const initiallyViewed = viewedSet.has(path);
  render(
    () =>
      DiffFile({
        model,
        adds,
        dels,
        generated,
        binary: !!file.binary,
        oldPath: file.oldPath,
        newPath: file.newPath,
        viewed: () => !!viewed[path],
        onCopy: () => navigator.clipboard.writeText(path),
        onToggleFold: () => setFolded(!section.classList.contains("pt-folded")),
        onToggleFull: (checked) => {
          section.classList.toggle("pt-exp-hide", !checked);
          section.classList.toggle("pt-hunks-hidden", checked);
          if (checked) for (const g of gaps) expandGap(view, g);
        },
        onToggleViewed: (checked) => {
          if (checked) viewedSet.add(path);
          else viewedSet.delete(path);
          saveViewed();
          setFolded(checked);
          setViewed(path, checked);
          updateProgress();
        },
        onExpand: (gap) => expandGap(view, gap),
      }),
    section
  );
  if (initiallyViewed || generated) setFolded(true);
  return view;
}

async function highlightSide(lang: string | null, text: string, path: string, side: string) {
  if (!lang || !text || text.length > MAX_HIGHLIGHT_CHARS) return;
  let resp: any;
  try {
    resp = await chrome.runtime.sendMessage({ type: "highlight", lang, text });
  } catch {
    return;
  }
  if (!resp?.rows) return;
  for (const [row, ranges] of Object.entries(resp.rows)) setHighlights(hlKey(path, side, +row), ranges as any);
}

function looksLikeDiff(text: string) {
  return /^(diff --git |From [0-9a-f]{40} |--- )/m.test(text.slice(0, 4096));
}

const SVG_GEAR =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63.27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294.016.257.016.515 0 .772-.01.147.038.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.102-.302c-.067-.019-.177-.011-.3.071a5.909 5.909 0 0 1-.668.386c-.133.066-.194.158-.211.224l-.29 1.106c-.168.646-.715 1.196-1.458 1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.458-1.26l-.289-1.106c-.018-.066-.079-.158-.212-.224a5.738 5.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.363-1.891l.815-.806c.05-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.038-.246-.088-.294l-.815-.806C.635 6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.102.302c.067.019.177.011.3-.071.214-.143.437-.272.668-.386.133-.066.194-.158.211-.224l.29-1.106C6.009.645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 1.105c-.147.561-.549.967-.998 1.189-.173.086-.34.183-.5.29-.417.278-.97.423-1.529.27l-1.103-.303c-.109-.03-.175.016-.195.045-.22.312-.412.644-.573.99-.014.031-.021.11.059.19l.815.806c.411.406.562.957.53 1.456a4.709 4.709 0 0 0 0 .582c.032.499-.119 1.05-.53 1.456l-.815.806c-.081.08-.073.159-.059.19.162.346.353.677.573.989.02.03.085.076.195.046l1.102-.303c.56-.153 1.113-.008 1.53.27.161.107.328.204.501.29.447.222.85.629.997 1.189l.289 1.105c.029.109.101.143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.036.137-.146l.289-1.105c.147-.561.549-.967.998-1.189.173-.086.34-.183.5-.29.417-.278.97-.423 1.529-.27l1.103.303c.109.029.175-.016.195-.045.22-.313.411-.644.573-.99.014-.031.021-.11-.059-.19l-.815-.806c-.411-.406-.562-.957-.53-1.456a4.709 4.709 0 0 0 0-.582c-.032-.499.119-1.05.53-1.456l.815-.806c.081-.08.073-.159.059-.19a6.464 6.464 0 0 0-.573-.989c-.02-.03-.085-.076-.195-.046l-1.102.303c-.56.153-1.113.008-1.53-.27a4.44 4.44 0 0 0-.501-.29c-.447-.222-.85-.629-.997-1.189l-.289-1.105c-.029-.11-.101-.143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3.001.001A1.5 1.5 0 0 0 9.5 8Z"/></svg>';

const octicon = (path: string, size = 14) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`;

window.ptIcons = {
  bold: octicon(
    "M4 2h4.5a3.501 3.501 0 0 1 2.852 5.53A3.499 3.499 0 0 1 9.5 14H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm1 7v3h4.5a1.5 1.5 0 0 0 0-3Zm3.5-2a1.5 1.5 0 0 0 0-3H5v3Z"
  ),
  italic: octicon(
    "M6 2.75A.75.75 0 0 1 6.75 2h6.5a.75.75 0 0 1 0 1.5h-2.505l-3.858 9H9.25a.75.75 0 0 1 0 1.5h-6.5a.75.75 0 0 1 0-1.5h2.505l3.858-9H6.75A.75.75 0 0 1 6 2.75Z"
  ),
  heading: octicon(
    "M3.75 2a.75.75 0 0 1 .75.75V7h7V2.75a.75.75 0 0 1 1.5 0v10.5a.75.75 0 0 1-1.5 0V8.5h-7v4.75a.75.75 0 0 1-1.5 0V2.75A.75.75 0 0 1 3.75 2Z"
  ),
  code: octicon(
    "m11.28 3.22 4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.275-.326.749.749 0 0 1 .215-.734L13.94 8l-3.72-3.72a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215Zm-6.56 0a.751.751 0 0 1 1.042.018.751.751 0 0 1 .018 1.042L2.06 8l3.72 3.72a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L.47 8.53a.75.75 0 0 1 0-1.06Z"
  ),
  ul: octicon(
    "M5.75 2.5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Zm0 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5Zm0 5h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1 0-1.5ZM2 14a1 1 0 1 1 0-2 1 1 0 0 1 0 2Zm1-6a1 1 0 1 1-2 0 1 1 0 0 1 2 0ZM2 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"
  ),
  ol: octicon(
    "M5 3.25a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 5 3.25Zm0 5a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5A.75.75 0 0 1 5 8.25Zm0 5a.75.75 0 0 1 .75-.75h8.5a.75.75 0 0 1 0 1.5h-8.5a.75.75 0 0 1-.75-.75ZM.924 10.32a.5.5 0 0 1-.851-.525l.001-.001.001-.002.002-.004.007-.011a2 2 0 0 1 .348-.384c.228-.19.588-.392 1.068-.392.468 0 .858.181 1.126.484.259.294.377.673.377 1.038 0 .987-.686 1.495-1.156 1.845l-.047.035c-.303.225-.522.4-.654.597h1.357a.5.5 0 0 1 0 1H.5a.5.5 0 0 1-.5-.5c0-1.005.692-1.52 1.167-1.875l.035-.025c.531-.396.798-.625.798-1.077a.57.57 0 0 0-.128-.376C1.806 10.068 1.695 10 1.5 10a.658.658 0 0 0-.429.163.835.835 0 0 0-.144.153ZM2.003 2.5V6h.503a.5.5 0 0 1 0 1H.5a.5.5 0 0 1 0-1h.503V3.308l-.28.14a.5.5 0 0 1-.446-.895l1.003-.5a.5.5 0 0 1 .723.447Z"
  ),
  diff: octicon(
    "M8.75 1.75V5H12a.75.75 0 0 1 0 1.5H8.75v3.25a.75.75 0 0 1-1.5 0V6.5H4A.75.75 0 0 1 4 5h3.25V1.75a.75.75 0 0 1 1.5 0Zm-6.5 12h11.5a.75.75 0 0 1 0 1.5H2.25a.75.75 0 0 1 0-1.5Z"
  ),
  unfold: octicon(
    "m8.177.677 2.896 2.896a.25.25 0 0 1-.177.427H8.75v1.25a.75.75 0 0 1-1.5 0V4H5.104a.25.25 0 0 1-.177-.427L7.823.677a.25.25 0 0 1 .354 0ZM7.25 10.75a.75.75 0 0 1 1.5 0V12h2.146a.25.25 0 0 1 .177.427l-2.896 2.896a.25.25 0 0 1-.354 0l-2.896-2.896A.25.25 0 0 1 5.104 12H7.25v-1.25Zm-5-2a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM6 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 6 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5ZM12 8a.75.75 0 0 1-.75.75h-.5a.75.75 0 0 1 0-1.5h.5A.75.75 0 0 1 12 8Zm2.25.75a.75.75 0 0 0 0-1.5h-.5a.75.75 0 0 0 0 1.5h.5Z",
    12
  ),
  chevron: octicon(
    "M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z",
    12
  ),
  commit: octicon(
    "M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.75a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z"
  ),
  reply: octicon(
    "M6.78 1.97a.75.75 0 0 1 0 1.06L3.81 6h6.44A4.75 4.75 0 0 1 15 10.75v2.5a.75.75 0 0 1-1.5 0v-2.5a3.25 3.25 0 0 0-3.25-3.25H3.81l2.97 2.97a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L1.97 7.78a.75.75 0 0 1 0-1.06l3.75-3.75a.751.751 0 0 1 1.06 0Z",
    12
  ),
  comment: octicon(
    "M1 2.75C1 1.784 1.784 1 2.75 1h10.5c.966 0 1.75.784 1.75 1.75v7.5A1.75 1.75 0 0 1 13.25 12H9.06l-2.573 2.573A1.458 1.458 0 0 1 4 13.543V12H2.75A1.75 1.75 0 0 1 1 10.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h4.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z",
    11
  ),
  check: octicon(
    "M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z",
    12
  ),
};

window.ptIcons.copy =
  '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>';
window.ptIcons.external =
  '<svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.854-1h4.146a.25.25 0 0 1 .25.25v4.146a.25.25 0 0 1-.427.177L13.03 4.03 9.28 7.78a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042l3.75-3.75-1.543-1.543A.25.25 0 0 1 10.604 1Z"/></svg>';

function makeDropdown(labelHTML: string) {
  const dd = document.createElement("details");
  dd.className = "pt-dd";
  const sum = document.createElement("summary");
  sum.innerHTML = labelHTML;
  const menu = document.createElement("div");
  menu.className = "pt-dd-menu";
  dd.append(sum, menu);
  return { dd, sum, menu };
}

function menuItem(menu: HTMLElement, html: string, onClick: (item: HTMLElement) => void) {
  const item = document.createElement("div");
  item.className = "pt-dd-item";
  item.innerHTML = html;
  item.addEventListener("click", () => onClick(item));
  menu.appendChild(item);
  return item;
}

// base16 palettes, base00..base0F
const BASE16: Record<string, string> = {
  "Gruvbox Dark": "1d2021 3c3836 504945 665c54 bdae93 d5c4a1 ebdbb2 fbf1c7 fb4934 fe8019 fabd2f b8bb26 8ec07c 83a598 d3869b d65d0e",
  Nord: "2e3440 3b4252 434c5e 4c566a d8dee9 e5e9f0 eceff4 8fbcbb bf616a d08770 ebcb8b a3be8c 88c0d0 81a1c1 b48ead 5e81ac",
  Dracula: "282a36 363948 44475a 6272a4 9ea8c7 f8f8f2 f8f8f2 ffffff ff5555 ffb86c f1fa8c 50fa7b 8be9fd 61bfff bd93f9 ff79c6",
  "One Dark": "282c34 353b45 3e4451 545862 565c64 abb2bf b6bdca c8ccd4 e06c75 d19a66 e5c07b 98c379 56b6c2 61afef c678dd be5046",
  "Tomorrow Night": "1d1f21 282a2e 373b41 969896 b4b7b4 c5c8c6 e0e0e0 ffffff cc6666 de935f f0c674 b5bd68 8abeb7 81a2be b294bb a3685a",
  "Solarized Dark": "002b36 073642 586e75 657b83 839496 93a1a1 eee8d5 fdf6e3 dc322f cb4b16 b58900 859900 2aa198 268bd2 6c71c4 d33682",
  "Solarized Light": "fdf6e3 eee8d5 93a1a1 839496 657b83 586e75 073642 002b36 dc322f cb4b16 b58900 859900 2aa198 268bd2 6c71c4 d33682",
  "Default Dark": "181818 282828 383838 585858 b8b8b8 d8d8d8 e8e8e8 f8f8f8 ab4642 dc9656 f7ca88 a1b56c 86c1b9 7cafc2 ba8baf a16946",
};

function hexRgba(hex: string, a: number) {
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

const THEME_VARS = (c: string[]): Record<string, string> => ({
  bg: `#${c[0]}`,
  fg: `#${c[5]}`,
  muted: `#${c[4]}`,
  border: `#${c[2]}`,
  "header-bg": `#${c[1]}`,
  "add-bg": hexRgba(c[11], 0.14),
  "add-no-bg": hexRgba(c[11], 0.35),
  "del-bg": hexRgba(c[8], 0.12),
  "del-no-bg": hexRgba(c[8], 0.3),
  "hunk-bg": hexRgba(c[13], 0.12),
  "hunk-fg": `#${c[4]}`,
  "word-add": hexRgba(c[11], 0.38),
  "word-del": hexRgba(c[8], 0.38),
  keyword: `#${c[14]}`,
  string: `#${c[11]}`,
  comment: `#${c[3]}`,
  function: `#${c[13]}`,
  type: `#${c[10]}`,
  constant: `#${c[9]}`,
  number: `#${c[9]}`,
  variable: `#${c[8]}`,
  property: `#${c[13]}`,
  operator: `#${c[5]}`,
  tag: `#${c[8]}`,
  attribute: `#${c[10]}`,
  punctuation: `#${c[4]}`,
  embedded: `#${c[15]}`,
  escape: `#${c[12]}`,
  label: `#${c[10]}`,
  module: `#${c[10]}`,
});

function applySettings(s: any) {
  const st = document.documentElement.style;
  if (s.uiFont) st.setProperty("--pt-ui", `"${s.uiFont}", system-ui, sans-serif`);
  else st.removeProperty("--pt-ui");
  if (s.codeFont) st.setProperty("--pt-mono", `"${s.codeFont}", ui-monospace, monospace`);
  else st.removeProperty("--pt-mono");
  st.setProperty("--pt-tab", s.tabSize || 4);
  st.setProperty("--pt-size", `${s.fontSize || 14}px`);
  st.setProperty("--pt-ui-size", `${s.uiFontSize || 14}px`);
  st.setProperty("--pt-comment-style", s.noItalic ? "normal" : "italic");
  st.setProperty("--pt-liga", s.noLigatures ? '"calt" 0, "liga" 0' : "normal");

  const palette = BASE16[s.theme] || window.ptCustomThemes?.[s.theme] || s.themePalette;
  const vars = palette ? THEME_VARS(palette.split(" ")) : null;
  for (const k of Object.keys(THEME_VARS(BASE16["Default Dark"].split(" ")))) {
    if (vars) st.setProperty(`--pt-${k}`, vars[k]);
    else st.removeProperty(`--pt-${k}`);
  }
}

async function main() {
  if (document.contentType !== "text/plain") return;
  const raw = document.body.innerText;
  if (!looksLikeDiff(raw)) return;
  if (parseDiff(raw).files.length === 0) return;

  provider = makeProvider();

  injectFonts();

  const viewedKey = `viewed:${location.host}${location.pathname}`;
  const stored = await chrome.storage.local.get(viewedKey);
  viewedSet = new Set(stored[viewedKey] || []);
  saveViewed = () => chrome.storage.local.set({ [viewedKey]: [...viewedSet] });

  const root = document.createElement("div");
  root.id = "pt-root";

  const bar = document.createElement("div");
  bar.id = "pt-bar";
  root.appendChild(bar);

  const tree = document.createElement("nav");
  tree.id = "pt-tree";
  const filter = document.createElement("input");
  filter.id = "pt-filter";
  filter.type = "search";
  filter.placeholder = "Filter files…";
  const treeList = document.createElement("div");
  treeList.id = "pt-tree-list";
  tree.append(filter, treeList);
  root.appendChild(tree);
  filter.addEventListener("input", () => setFilter(filter.value));
  render(FileTree, treeList);

  const splitter = document.createElement("div");
  splitter.id = "pt-splitter";
  root.appendChild(splitter);

  const main = document.createElement("div");
  main.id = "pt-main";
  root.appendChild(main);

  const { treeWidth } = await chrome.storage.sync.get("treeWidth");
  if (treeWidth) tree.style.width = `${treeWidth}px`;
  splitter.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const left = tree.getBoundingClientRect().left;
    document.body.style.userSelect = "none";
    let pending = 0;
    const move = (ev: MouseEvent) => {
      const w = Math.max(160, Math.min(800, ev.clientX - left));
      if (pending) return;
      pending = requestAnimationFrame(() => {
        pending = 0;
        tree.style.width = `${w}px`;
      });
    };
    const up = () => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
      chrome.storage.sync.set({ treeWidth: tree.getBoundingClientRect().width });
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });

  const rawPre = document.createElement("pre");
  rawPre.id = "pt-raw";
  rawPre.style.display = "none";

  let views: any[] = [];

  // general (non-line) discussion, rendered reactively from the threads store;
  // review.js fills the store. The box survives renderDiff, which clears main.
  const gthreadsBox = document.createElement("div");
  render(GeneralThreads, gthreadsBox);

  function renderDiff(text: string) {
    const parsed = parseDiff(text);
    rawPre.textContent = text;
    main.textContent = "";
    resetDiffState();
    main.appendChild(gthreadsBox);

    if (parsed.preamble) {
      const pre = document.createElement("pre");
      pre.id = "pt-preamble";
      pre.textContent = parsed.preamble;
      main.appendChild(pre);
    }

    views = parsed.files.map(buildFileView);

    // new-side line text by number, for <Suggestion> to show replaced lines
    const fl: Record<string, Record<number, string>> = {};
    for (const f of parsed.files) {
      const p = f.newPath || f.oldPath || "(unknown)";
      const map: Record<number, string> = {};
      for (const h of f.hunks) {
        let n = h.newStart;
        for (const l of h.lines)
          if (l.t === "+" || l.t === " ") map[n++] = l.s;
      }
      fl[p] = map;
    }
    setFileLines(fl);

    setTreeFiles(
      views.map((v) => ({
        path: v.path,
        adds: v.adds,
        dels: v.dels,
        select: () => v.section.scrollIntoView(),
        selectComment: () => {
          const row = [...v.section.querySelectorAll(".pt-comments-row")].find((r) => (r as HTMLElement).offsetParent);
          if (row) {
            row.scrollIntoView({ block: "center" });
            row.classList.add("pt-flash");
            setTimeout(() => row.classList.remove("pt-flash"), 1200);
          } else v.section.scrollIntoView();
        },
        textLower: () => (`${v.texts?.new || ""}\n${v.texts?.old || ""}`).toLowerCase(),
      }))
    );
    for (const v of views) setViewed(v.path, viewedSet.has(v.path));
    for (const v of views) main.appendChild(v.section);
    updateProgress();

    for (const v of views) {
      if (!v.lang) continue;
      highlightSide(v.lang, v.texts.new, v.path, "new");
      highlightSide(v.lang, v.texts.old, v.path, "old");
    }
  }

  const { view: savedView = "unified" } = await chrome.storage.sync.get("view");

  updateProgress = () => {
    setViewedDone(views.filter((v) => viewedSet.has(v.path)).length);
    setViewedTotal(views.length);
  };

  const applyMode = (mode: string) => {
    setViewMode(mode as "unified" | "split");
    root.classList.toggle("pt-mode-split", mode === "split");
    root.classList.toggle("pt-mode-unified", mode !== "split");
  };
  render(
    () =>
      Toolbar({
        onSetMode: (m) => {
          applyMode(m);
          chrome.storage.sync.set({ view: m });
        },
      }),
    bar
  );
  applyMode(savedView);

  // Load appearance settings + custom themes before the first paint so the diff
  // renders with the user's theme and fonts (no flash). Then paint the diff
  // before building the rest of the chrome (gear, settings, theme picker) and
  // before any provider/network work, so a GitHub diff shows as fast as a local
  // one; provider requests run later, on pt-rendered.
  const { settings: loaded = {} } = await chrome.storage.sync.get("settings");
  const { customThemes = {} } = await chrome.storage.sync.get("customThemes");
  window.ptCustomThemes = customThemes;
  setSettings(loaded);
  applySettings(loaded);

  const oldBody = document.body;
  oldBody.textContent = "";
  oldBody.appendChild(rawPre);
  oldBody.appendChild(root);
  document.documentElement.classList.add("pt-on");
  setCanExpand(!!provider);
  renderDiff(raw);

  const gear = makeDropdown(SVG_GEAR);
  gear.dd.classList.add("pt-dd-right");
  gear.dd.id = "pt-settings";
  gear.sum.title = "Settings";
  bar.appendChild(gear.dd);

  const saveSettings = () => chrome.storage.sync.set({ settings: unwrap(settings) });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "sync" && ch.settings) {
      setSettings(reconcile(ch.settings.newValue || {}));
      applySettings(ch.settings.newValue || {});
    }
  });

  const buildRow = (labelText: string, control: HTMLElement) => {
    const row = document.createElement("label");
    row.className = "pt-set-row";
    const span = document.createElement("span");
    span.textContent = labelText;
    row.append(span, control);
    return row;
  };

  const computeThemeOptions = () => {
    const names = ["GitHub", ...Object.keys(BASE16), ...Object.keys(customThemes)];
    if (settings.theme && settings.themePalette && !names.includes(settings.theme))
      names.push(settings.theme);
    return names.map((n) => ({ value: n === "GitHub" ? "" : n, label: n }));
  };
  setThemeOptions(computeThemeOptions());

  const patch = (key: string, value: unknown) => {
    setSettings(key, value);
    applySettings(unwrap(settings));
    saveSettings();
  };

  // tinted-theming base16 yaml: base00..base0F hex values + scheme/name field
  const parseBase16Yaml = (text: string) => {
    const colors = [];
    for (let i = 0; i < 16; i++) {
      const key = `base0${i.toString(16).toUpperCase()}`;
      const m = new RegExp(`${key}:\\s*["']?#?([0-9a-fA-F]{6})`).exec(text);
      if (!m) return null;
      colors.push(m[1].toLowerCase());
    }
    const name =
      /(?:scheme|name):\s*["']?([^"'\n]+)/.exec(text)?.[1]?.trim() || "custom scheme";
    return { name, colors: colors.join(" ") };
  };

  const applyTheme = (name: string, palette: string) => {
    setSettings("theme", name);
    setSettings("themePalette", palette);
    applySettings(unwrap(settings));
    saveSettings();
    setThemeOptions(computeThemeOptions());
  };

  const openThemesDialog = () => {
    document.getElementById("pt-themes-host")?.remove();
    const host = document.createElement("div");
    host.id = "pt-themes-host";
    const dispose = render(
      () =>
        ThemeGallery({
          current: () => settings.theme || "",
          onApply: (name, palette) => applyTheme(name, palette),
          onAddCustom: async (yaml) => {
            const parsed = parseBase16Yaml(yaml);
            if (!parsed) return "could not find all base00…base0F colors";
            customThemes[parsed.name] = parsed.colors;
            await chrome.storage.sync.set({ customThemes });
            applyTheme(parsed.name, parsed.colors);
            return null;
          },
          onClose: () => {
            dispose();
            host.remove();
          },
        }),
      host
    );
    document.body.appendChild(host);
  };

  render(
    () =>
      Settings({
        patch,
        onPickTheme: (v) => {
          setSettings("themePalette", "");
          patch("theme", v);
        },
        onOpenGallery: () => {
          gear.dd.open = false;
          openThemesDialog();
        },
      }),
    gear.menu
  );

  const sep = document.createElement("div");
  sep.className = "pt-dd-sep";
  gear.menu.appendChild(sep);

  let showingRaw = false;
  const rawItem = menuItem(gear.menu, "Raw view", () => {
    showingRaw = !showingRaw;
    rawItem.classList.toggle("pt-active", showingRaw);
    rawPre.style.display = showingRaw ? "" : "none";
    main.style.display = showingRaw ? "none" : "";
    tree.style.display = showingRaw ? "none" : "";
    splitter.style.display = showingRaw ? "none" : "";
    gear.dd.open = false;
  });
  menuItem(gear.menu, "Clear viewed", () => {
    gear.dd.open = false;
    for (const cb of document.querySelectorAll(".pt-viewed:not(.pt-fullfile) input:checked")) {
      (cb as HTMLInputElement).checked = false;
      cb.dispatchEvent(new Event("change"));
    }
    updateProgress();
  });
  const openTokensDialog = () => {
    document.getElementById("pt-tokens-host")?.remove();
    const host = document.createElement("div");
    host.id = "pt-tokens-host";
    const dispose = render(
      () =>
        TokensDialog({
          onClose: () => {
            dispose();
            host.remove();
          },
        }),
      host
    );
    document.body.appendChild(host);
  };

  menuItem(gear.menu, "Access tokens…", () => {
    gear.dd.open = false;
    openTokensDialog();
  });

  const sep2 = document.createElement("div");
  sep2.className = "pt-dd-sep";
  gear.menu.appendChild(sep2);
  const star = octicon(
    "M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z",
    13
  );
  menuItem(gear.menu, `${star}<span>Enjoying it? Star patchtree on GitHub</span>`, () => {
    gear.dd.open = false;
    window.open("https://github.com/danilrwx/patchtree", "_blank", "noopener");
  }).classList.add("pt-star-item");

  document.addEventListener("click", (e) => {
    for (const d of document.querySelectorAll("details.pt-dd[open], details#pt-review[open]"))
      if (!d.contains(e.target as Node)) (d as HTMLDetailsElement).open = false;
  });

  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
    const sections = views.map((v) => v.section).filter((s) => s.offsetParent);
    const threads = [...document.querySelectorAll(".pt-comments-row")].filter((r) => (r as HTMLElement).offsetParent);
    const top = (el: any) => el.getBoundingClientRect().top;
    const currentIdx = (els: any[], limit = 61) => {
      let idx = -1;
      for (let i = 0; i < els.length; i++) if (top(els[i]) <= limit) idx = i;
      return idx;
    };
    const go = (el: any) => el && window.scrollTo({ top: window.scrollY + top(el) - 56 });
    const goCenter = (el: any) => {
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.classList.add("pt-flash");
      setTimeout(() => el.classList.remove("pt-flash"), 1200);
    };
    const mid = window.innerHeight / 2;
    const cur = () => sections[Math.max(0, currentIdx(sections))];
    switch (e.key) {
      case "j":
        go(sections[Math.min(sections.length - 1, currentIdx(sections) + 1)]);
        break;
      case "k":
        go(sections[Math.max(0, currentIdx(sections) - 1)]);
        break;
      case "n":
        goCenter(threads[Math.min(threads.length - 1, currentIdx(threads, mid) + 1)]);
        break;
      case "p":
        goCenter(threads[Math.max(0, currentIdx(threads, mid) - 1)]);
        break;
      case "v":
        cur()?.querySelector(".pt-viewed:not(.pt-fullfile) input")?.click();
        break;
      case "x":
        cur()?.classList.toggle("pt-folded");
        break;
      case "/":
        e.preventDefault();
        filter.focus();
        break;
    }
  });

  const view: PtView = {
    bar,
    root,
    renderDiff,
    initialRaw: raw,
    makeDropdown,
    menuItem,
    esc,
    addSettingRow: (labelText: string, control: HTMLElement) => {
      const row = buildRow(labelText, control);
      const sep = gear.menu.querySelector(".pt-dd-sep");
      if (sep) gear.menu.insertBefore(row, sep);
      else gear.menu.appendChild(row);
    },
    addMenuItem: (html: string, fn: (item: HTMLElement) => void) => menuItem(gear.menu, html, fn),
    markCommented: (counts: Map<string, number>) => {
      for (const v of views) setCounts(v.path, counts.get(v.path) || 0);
    },
  };

  // start the review layer after the diff has painted (a macrotask), so no
  // network request blocks the first paint; skipped without a provider
  if (provider) setTimeout(() => initReview(provider!, view), 0);
}

main();