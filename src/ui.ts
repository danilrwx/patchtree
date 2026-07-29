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

import { render } from "solid-js/web";
import type { JSX } from "solid-js";

// Shared imperative DOM helpers used by both content.ts and review.ts.

// Mount a Solid dialog into a fresh full-screen host appended to <body>,
// replacing any prior host with the same id. `factory` receives a `close`
// callback that disposes the render and removes the host.
export function mountDialog(id: string, factory: (close: () => void) => JSX.Element) {
  document.getElementById(id)?.remove();
  const host = document.createElement("div");
  host.id = id;
  let dispose: () => void;
  const close = () => {
    dispose?.();
    host.remove();
  };
  dispose = render(() => factory(close), host);
  document.body.appendChild(host);
}

// A <details> dropdown with a summary and an empty menu container.
export function makeDropdown(labelHTML: string) {
  const dd = document.createElement("details");
  dd.className = "pt-dd";
  const sum = document.createElement("summary");
  sum.innerHTML = labelHTML;
  const menu = document.createElement("div");
  menu.className = "pt-dd-menu";
  dd.append(sum, menu);
  return { dd, sum, menu };
}

// Append a clickable item to a dropdown menu.
export function menuItem(
  menu: HTMLElement,
  html: string,
  onClick: (item: HTMLElement) => void
) {
  const item = document.createElement("div");
  item.className = "pt-dd-item";
  item.innerHTML = html;
  item.addEventListener("click", () => onClick(item));
  menu.appendChild(item);
  return item;
}

// Wrap the textarea's selection in `before`/`after` (a Markdown toolbar action).
export function surround(ta: HTMLTextAreaElement, before: string, after: string = before) {
  const s = ta.selectionStart;
  const e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || "text";
  ta.setRangeText(before + sel + after, s, e);
  ta.focus();
  ta.selectionStart = s + before.length;
  ta.selectionEnd = s + before.length + sel.length;
}

// Prefix each selected line via `prefixFor(index)` (list/heading toolbar actions).
export function prefixLines(ta: HTMLTextAreaElement, prefixFor: (i: number) => string) {
  const v = ta.value;
  const start = v.lastIndexOf("\n", ta.selectionStart - 1) + 1;
  let end = v.indexOf("\n", ta.selectionEnd);
  if (end === -1) end = v.length;
  const block = v
    .slice(start, end)
    .split("\n")
    .map((line, i) => prefixFor(i) + line)
    .join("\n");
  ta.setRangeText(block, start, end);
  ta.focus();
  ta.selectionStart = start;
  ta.selectionEnd = start + block.length;
}

// Scroll an element to the viewport center and briefly flash it.
export function flashCenter(el: Element | null | undefined) {
  if (!el) return;
  el.scrollIntoView({ block: "center" });
  el.classList.add("pt-flash");
  setTimeout(() => el.classList.remove("pt-flash"), 1200);
}
