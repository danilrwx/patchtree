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
import { createSignal, batch } from "solid-js";
import { unwrap, reconcile } from "solid-js/store";
import { FileTree } from "./components/FileTree";
import { FileFilter } from "./components/FileFilter";
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
  setActiveFile,
  type FileStatus,
} from "./store";
import { makeProvider } from "./providers";
import { initReview, type PtView } from "./review";
import { octicon, SVG_GEAR, icons } from "./icons";
import type { Provider } from "./types";

// Highlighting is skipped for sides bigger than this to keep the page responsive.
const MAX_HIGHLIGHT_CHARS = 300 * 1024;

let viewedSet = new Set<string>();
let saveViewed = () => {};
// resolved provider (null for a local/non-provider page) and the progress
// updater — module-scoped because top-level helpers reference them
let provider: Provider | null = null;
let updateProgress: () => void = () => {};
// user-added base16 palettes (name → space-joined hex), loaded in main()
let customThemes: Record<string, string> = {};

// the first few files mount their rows eagerly; the rest mount as their section
// scrolls near the viewport, so a large diff paints without building every row
const EAGER_FILES = 6;
const mountSetters = new WeakMap<Element, () => void>();
const mountObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries)
      if (e.isIntersecting) {
        mountSetters.get(e.target)?.();
        mountObserver.unobserve(e.target);
      }
  },
  { rootMargin: "1500px 0px" }
);

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

function buildFileView(file: any, index: number) {
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

  // Give content-visibility a per-file height estimate instead of the fixed
  // 600px default. A large (pt-full) file otherwise collapses to 600px when it
  // scrolls out of view, jumping the scroll position and dragging the sticky
  // header with it.
  const estRows = model.segments.reduce((a, s) => a + s.pairs.length + 1, 0);
  section.style.setProperty("contain-intrinsic-height", `auto ${44 + estRows * 20}px`);

  const status: FileStatus = file.isDeleted
    ? "deleted"
    : file.isNew
      ? "added"
      : file.isRenamed
        ? "renamed"
        : "modified";

  const view = {
    section,
    path,
    adds,
    dels,
    status,
    texts: { old: model.oldText, new: model.newText },
    lang: resolveLang(path, `${model.newText}\n${model.oldText}`),
  };

  const setFolded = (f: boolean) => section.classList.toggle("pt-folded", f);
  const gaps = [...model.segments.map((s) => s.gap), model.trailingGap].filter(Boolean);

  // the first few files mount + highlight eagerly; the rest wait until their
  // section scrolls near the viewport (shared mountObserver)
  const eager = index < EAGER_FILES;
  const [mounted, setMounted] = createSignal(eager);
  const activate = () => {
    setMounted(true);
    highlightFile(view);
  };
  if (eager) highlightFile(view);
  else {
    mountSetters.set(section, activate);
    mountObserver.observe(section);
  }

  const initiallyViewed = viewedSet.has(path);
  render(
    () =>
      DiffFile({
        model,
        adds,
        dels,
        generated,
        binary: !!file.binary,
        renamed: status === "renamed",
        status,
        oldPath: file.oldPath,
        newPath: file.newPath,
        image: provider ? (side) => provider!.imageDataUrl(path, side) : undefined,
        viewed: () => !!viewed[path],
        mount: mounted,
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

// Highlight both sides of a file in one round-trip, then write all rows in a
// single reactive batch so the mounted cells re-render once, not per line.
async function highlightFile(v: { lang: string | null; texts: { old: string; new: string }; path: string }) {
  if (!v.lang) return;
  const fits = (t: string) => t && t.length <= MAX_HIGHLIGHT_CHARS;
  const oldT = fits(v.texts.old) ? v.texts.old : "";
  const newT = fits(v.texts.new) ? v.texts.new : "";
  if (!oldT && !newT) return;
  let resp: any;
  try {
    resp = await chrome.runtime.sendMessage({ type: "highlight", lang: v.lang, old: oldT, new: newT });
  } catch {
    return;
  }
  if (!resp) return;
  batch(() => {
    for (const [row, ranges] of Object.entries(resp.new || {}))
      setHighlights(hlKey(v.path, "new", +row), ranges as any);
    for (const [row, ranges] of Object.entries(resp.old || {}))
      setHighlights(hlKey(v.path, "old", +row), ranges as any);
  });
}

function looksLikeDiff(text: string) {
  return /^(diff --git |From [0-9a-f]{40} |--- )/m.test(text.slice(0, 4096));
}


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

  const palette = BASE16[s.theme] || customThemes[s.theme] || s.themePalette;
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
  const scrollKey = `scroll:${location.host}${location.pathname}`;
  // Start every persisted-state read up front and in parallel. The UI paints
  // without awaiting them, so the raw diff is replaced immediately instead of
  // after a chain of storage round-trips; state is layered on as it arrives.
  const localP = chrome.storage.local.get([viewedKey, scrollKey]);
  const syncP = chrome.storage.sync.get([
    "treeWidth",
    "sidebarHidden",
    "view",
    "settings",
    "customThemes",
  ]);
  saveViewed = () => chrome.storage.local.set({ [viewedKey]: [...viewedSet] });
  let lastActive = "";
  const saveActive = (p: string) => {
    if (p && p !== lastActive) {
      lastActive = p;
      chrome.storage.local.set({ [scrollKey]: p });
    }
  };

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
  const head = document.createElement("div");
  head.id = "pt-tree-head";
  const filterHost = document.createElement("span");
  filterHost.id = "pt-filter-host";
  head.append(filter, filterHost);
  tree.append(head, treeList);
  root.appendChild(tree);
  filter.addEventListener("input", () => setFilter(filter.value));
  render(FileTree, treeList);
  render(FileFilter, filterHost);

  const splitter = document.createElement("div");
  splitter.id = "pt-splitter";
  root.appendChild(splitter);

  const main = document.createElement("div");
  main.id = "pt-main";
  root.appendChild(main);

  const collapse = document.createElement("button");
  collapse.id = "pt-collapse";
  collapse.type = "button";
  collapse.title = "Toggle file tree";
  collapse.innerHTML = icons.sidebar;
  collapse.addEventListener("click", () => {
    const h = !root.classList.contains("pt-tree-hidden");
    root.classList.toggle("pt-tree-hidden", h);
    chrome.storage.sync.set({ sidebarHidden: h });
  });
  bar.insertBefore(collapse, bar.firstChild);
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
        status: v.status,
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
    // highlighting is kicked off per file when it mounts (see buildFileView)
  }

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
  applyMode("unified");

  // Paint now: swap the raw text for our shell + diff before any storage read
  // resolves. Appearance falls back to the CSS default theme until settings
  // arrive a moment later — a brief default frame beats a long raw diff.
  history.scrollRestoration = "manual";
  const oldBody = document.body;
  oldBody.textContent = "";
  oldBody.appendChild(rawPre);
  oldBody.appendChild(root);
  document.documentElement.classList.add("pt-on");
  setCanExpand(!!provider);
  renderDiff(raw);

  // The bar is a sticky top:0 header; publish its measured height so the
  // sticky file headers / tree stick flush under it (no gap that leaks the
  // diff below, no overlap that clips the header) at any font size.
  let barHeight = 44;
  const setBarH = () => {
    barHeight = Math.round(bar.getBoundingClientRect().height);
    document.documentElement.style.setProperty("--pt-bar-h", `${barHeight}px`);
  };
  requestAnimationFrame(setBarH);
  document.fonts?.ready.then(setBarH);
  addEventListener("resize", () => requestAnimationFrame(setBarH));

  // ---- viewed state + reload scroll restore (chrome.storage.local) ----
  const stored = await localP;
  viewedSet = new Set(stored[viewedKey] || []);
  const restoreTo: string = stored[scrollKey] || "";
  for (const v of views)
    if (viewedSet.has(v.path)) {
      v.section.classList.add("pt-folded");
      setViewed(v.path, true);
    }
  updateProgress();

  // Return to the file the user was on before a reload. The browser's own
  // scroll restoration lands on the wrong file: we rebuild the body and lazy
  // placeholders mis-estimate heights, so the remembered scrollY points at
  // different content. Drive it ourselves off the last active file instead.
  {
    const idx = restoreTo ? views.findIndex((v) => v.path === restoreTo) : -1;
    if (idx > 0) {
      // give every file above the target its real height so the offset is exact
      for (let i = 0; i <= idx; i++) {
        mountSetters.get(views[i].section)?.();
        mountObserver.unobserve(views[i].section);
      }
      // Converge over a few frames: scrolling reveals more sections whose
      // content-visibility height then resolves (and the web font swaps line
      // metrics), each shifting the target. Re-pin until it stops moving.
      let tries = 0;
      const goTo = () => {
        const want = Math.max(0, views[idx].section.getBoundingClientRect().top + window.scrollY - 52);
        if (Math.abs(window.scrollY - want) > 1) window.scrollTo({ top: want });
        if (tries++ < 20) requestAnimationFrame(goTo);
      };
      requestAnimationFrame(goTo);
      document.fonts?.ready.then(() => requestAnimationFrame(goTo));
    }
  }

  // ---- appearance + layout (chrome.storage.sync) ----
  const sync = await syncP;
  if (sync.treeWidth) tree.style.width = `${sync.treeWidth}px`;
  root.classList.toggle("pt-tree-hidden", !!sync.sidebarHidden);
  applyMode(sync.view || "unified");
  customThemes = sync.customThemes || {};
  setSettings(sync.settings || {});
  applySettings(sync.settings || {});

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

  // scroll-spy: mark the file whose section sits at the top of the viewport so
  // the tree can highlight it and follow along; also flag the file whose sticky
  // header is currently pinned so its top corners go square — a rounded corner
  // would leak the diff scrolling behind it (see .pt-stuck in the CSS)
  let spyPending = 0;
  let stuckSection: HTMLElement | null = null;
  const updateActive = () => {
    spyPending = 0;
    let cur = "";
    let curSection: HTMLElement | null = null;
    for (const v of views) {
      if (!v.section.offsetParent) continue;
      if (v.section.getBoundingClientRect().top <= 70) {
        cur = v.path;
        curSection = v.section;
      } else break;
    }
    const active = cur || views[0]?.path || "";
    setActiveFile(active);
    saveActive(active);

    const stuck = curSection && curSection.getBoundingClientRect().top < barHeight ? curSection : null;
    if (stuck !== stuckSection) {
      stuckSection?.classList.remove("pt-stuck");
      stuck?.classList.add("pt-stuck");
      stuckSection = stuck;
    }
  };
  document.addEventListener(
    "scroll",
    () => {
      if (!spyPending) spyPending = requestAnimationFrame(updateActive);
    },
    { passive: true }
  );
  updateActive();

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
      case "e":
        collapse.click();
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