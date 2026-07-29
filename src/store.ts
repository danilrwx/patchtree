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

// Reactive UI state shared between the (still imperative) content script and
// the Solid islands. content.js seeds these; the islands render from them.
import { createSignal } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import type { Range } from "./diff";

export interface TreeFile {
  path: string;
  adds: number;
  dels: number;
  // scroll the file's section into view
  select: () => void;
  // scroll to the file's first open thread (falls back to the section)
  selectComment: () => void;
  // combined old+new text, lowercased, for the content filter
  textLower: () => string;
}

export const [treeFiles, setTreeFiles] = createSignal<TreeFile[]>([]);
export const [filter, setFilter] = createSignal("");
export const [viewMode, setViewMode] = createSignal<"unified" | "split">("unified");
export const [viewedDone, setViewedDone] = createSignal(0);
export const [viewedTotal, setViewedTotal] = createSignal(0);

// appearance settings (mirrors the persisted `settings` object) and the theme
// picker options; the gear <Settings> renders from these, the theme gallery
// updates them
export const [settings, setSettings] = createStore<Record<string, any>>({});
export const [themeOptions, setThemeOptions] = createSignal<SelectOptionLike[]>([]);
export interface SelectOptionLike {
  value: string | number;
  label: string;
}
export const [viewed, setViewed] = createStore<Record<string, boolean>>({});
export const [counts, setCounts] = createStore<Record<string, number>>({});

// syntax highlight ranges per (path, side, row); the diff cells render from here
export const [highlights, setHighlights] = createStore<Record<string, Range[]>>({});
export const hlKey = (path: string, side: string, row: number) => `${path}\n${side}\n${row}`;

// expander state: fetched context lines, their highlight, full/error flags
export interface CtxLine {
  o: number;
  n: number;
  text: string;
}
export const [ctxLines, setCtxLines] = createStore<Record<string, CtxLine[]>>({});
export const [ctxHl, setCtxHl] = createStore<Record<string, Range[]>>({});
export const [gapFull, setGapFull] = createStore<Record<string, boolean>>({});
export const [gapErr, setGapErr] = createStore<Record<string, string>>({});
export const ctxKey = (gapId: string, row: number) => `${gapId}\n${row}`;

// clear per-diff state before rendering a new diff (e.g. a commit filter change)
export function resetDiffState(): void {
  setHighlights(reconcile({}));
  setCtxLines(reconcile({}));
  setCtxHl(reconcile({}));
  setGapFull(reconcile({}));
  setGapErr(reconcile({}));
}
