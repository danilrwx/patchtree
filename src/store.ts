// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
// Reactive UI state shared between the (still imperative) content script and
// the Solid islands. content.js seeds these; the islands render from them.
import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";

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
export const [viewed, setViewed] = createStore<Record<string, boolean>>({});
export const [counts, setCounts] = createStore<Record<string, number>>({});
