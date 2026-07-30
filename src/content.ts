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

import { resolveLang, parseDiff, buildFileModel } from "./diff";
import { flashCenter, mountDialog, makeDropdown, menuItem } from "./ui";
import { injectFonts } from "./fonts";
import { BASE16, applySettings, parseBase16Yaml } from "./theme";
import { render } from "solid-js/web";
import { batch } from "solid-js";
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

// Every file's rows are in the DOM from the start (no lazy mounting) so scroll
// and jump-to-thread are exact. Only syntax highlighting stays lazy — it just
// colours existing rows, so it never affects layout or scroll position.
const highlightSetters = new WeakMap<Element, () => void>();
const highlightObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries)
      if (e.isIntersecting) {
        highlightSetters.get(e.target)?.();
        highlightObserver.unobserve(e.target);
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

  // rows render immediately; highlighting runs when the section nears the
  // viewport (colours existing rows, so no layout/scroll effect)
  highlightSetters.set(section, () => highlightFile(view));
  highlightObserver.observe(section);

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
          if (row) flashCenter(row);
          else v.section.scrollIntoView();
        },
        textLower: () => (`${v.texts?.new || ""}\n${v.texts?.old || ""}`).toLowerCase(),
      }))
    );
    for (const v of views) setViewed(v.path, viewedSet.has(v.path));
    for (const v of views) main.appendChild(v.section);
    updateProgress();
    pinIntrinsicSizes();
    // highlighting is kicked off per file when it mounts (see buildFileView)
  }

  // With the whole diff in the DOM, window/splitter resize would re-wrap every
  // file. Enable content-visibility to skip off-screen files — but only after
  // pinning each file's real rendered height as contain-intrinsic-size, so the
  // skipped placeholder matches reality and scroll/jump offsets stay exact.
  const pinIntrinsicSizes = () => {
    main.classList.remove("pt-cv");
    const measure = () => {
      const hs = views.map((v) => v.section.offsetHeight);
      views.forEach((v, i) => {
        if (hs[i]) v.section.style.containIntrinsicSize = `auto ${hs[i]}px`;
      });
      main.classList.add("pt-cv");
    };
    // measure after the web font swaps line metrics, so heights are final
    (document.fonts?.ready ?? Promise.resolve()).then(() => requestAnimationFrame(measure));
  };

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

  // Return to the file the user was on before a reload. Drive it off the last
  // active file rather than the browser's remembered scrollY, which it restores
  // before our body is rebuilt. All rows are in the DOM, so the offset is exact.
  {
    const idx = restoreTo ? views.findIndex((v) => v.path === restoreTo) : -1;
    if (idx > 0) {
      const goTo = () => {
        const want = Math.max(0, views[idx].section.getBoundingClientRect().top + window.scrollY - 52);
        window.scrollTo({ top: want });
      };
      goTo();
      // the web font swaps line metrics after load — re-pin once it's ready
      document.fonts?.ready.then(goTo);
    }
  }

  // ---- appearance + layout (chrome.storage.sync) ----
  const sync = await syncP;
  if (sync.treeWidth) tree.style.width = `${sync.treeWidth}px`;
  root.classList.toggle("pt-tree-hidden", !!sync.sidebarHidden);
  applyMode(sync.view || "unified");
  customThemes = sync.customThemes || {};
  setSettings(sync.settings || {});
  applySettings(sync.settings || {}, customThemes);

  const gear = makeDropdown(SVG_GEAR);
  gear.dd.classList.add("pt-dd-right");
  gear.dd.id = "pt-settings";
  gear.sum.title = "Settings";
  bar.appendChild(gear.dd);

  const saveSettings = () => chrome.storage.sync.set({ settings: unwrap(settings) });
  chrome.storage.onChanged.addListener((ch, area) => {
    if (area === "sync" && ch.settings) {
      setSettings(reconcile(ch.settings.newValue || {}));
      applySettings(ch.settings.newValue || {}, customThemes);
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
    applySettings(unwrap(settings), customThemes);
    saveSettings();
  };

  const applyTheme = (name: string, palette: string) => {
    setSettings("theme", name);
    setSettings("themePalette", palette);
    applySettings(unwrap(settings), customThemes);
    saveSettings();
    setThemeOptions(computeThemeOptions());
  };

  const openThemesDialog = () =>
    mountDialog("pt-themes-host", (close) =>
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
        onClose: close,
      })
    );

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

  const addSep = () => {
    const s = document.createElement("div");
    s.className = "pt-dd-sep";
    gear.menu.appendChild(s);
  };
  addSep();

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
  const foldAll = (folded: boolean) => {
    for (const v of views) v.section.classList.toggle("pt-folded", folded);
    gear.dd.open = false;
  };
  menuItem(gear.menu, "Collapse all files", () => foldAll(true));
  menuItem(gear.menu, "Expand all files", () => foldAll(false));
  const openTokensDialog = () =>
    mountDialog("pt-tokens-host", (close) => TokensDialog({ onClose: close }));

  menuItem(gear.menu, "Access tokens…", () => {
    gear.dd.open = false;
    openTokensDialog();
  });

  addSep();
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
    const goCenter = flashCenter;
    const mid = window.innerHeight / 2;
    const cur = () => sections[Math.max(0, currentIdx(sections))];
    // key off the physical key (e.code), not e.key, so the shortcuts work on
    // non-Latin layouts (e.g. Cyrillic) where the same key yields another char
    const key = /^Key[A-Z]$/.test(e.code)
      ? e.code.slice(3).toLowerCase()
      : e.code === "Slash"
        ? "/"
        : e.key;
    switch (key) {
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
    addSettingRow: (labelText: string, control: HTMLElement) => {
      const row = buildRow(labelText, control);
      const sep = gear.menu.querySelector(".pt-dd-sep");
      if (sep) gear.menu.insertBefore(row, sep);
      else gear.menu.appendChild(row);
    },
    markCommented: (counts: Map<string, number>) => {
      for (const v of views) setCounts(v.path, counts.get(v.path) || 0);
    },
  };

  // start the review layer after the diff has painted (a macrotask), so no
  // network request blocks the first paint; skipped without a provider
  if (provider) setTimeout(() => initReview(provider!, view), 0);
}

main();