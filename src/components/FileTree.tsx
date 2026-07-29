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

import { For, createMemo, createEffect } from "solid-js";
import { icons } from "../icons";
import {
  treeFiles,
  filter,
  viewed,
  counts,
  activeFile,
  hiddenExts,
  showViewed,
  showDeleted,
  extOf,
  type TreeFile,
} from "../store";

interface Node {
  dirs: Map<string, Node>;
  files: TreeFile[];
}

function build(files: TreeFile[]): Node {
  const root: Node = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
      node = node.dirs.get(part)!;
    }
    node.files.push(f);
  }
  return root;
}

// collapse single-child directory chains (foo → foo/bar → …) into one label
function mergeChain(name: string, node: Node): [string, Node] {
  while (node.dirs.size === 1 && node.files.length === 0) {
    const [subName, subChild] = node.dirs.entries().next().value!;
    name += `/${subName}`;
    node = subChild;
  }
  return [name, node];
}

function collectFiles(node: Node, out: TreeFile[] = []): TreeFile[] {
  out.push(...node.files);
  for (const child of node.dirs.values()) collectFiles(child, out);
  return out;
}

function isVisible(f: TreeFile, q: string): boolean {
  if (hiddenExts[extOf(f.path)]) return false;
  if (!showViewed() && viewed[f.path]) return false;
  if (!showDeleted() && f.status === "deleted") return false;
  if (!q) return true;
  if (f.path.toLowerCase().includes(q)) return true;
  return q.length >= 3 && f.textLower().includes(q);
}

function TreeNode(props: { node: Node }) {
  const dirs = createMemo(() =>
    [...props.node.dirs]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, child]) => mergeChain(name, child))
  );
  const files = createMemo(() =>
    props.node.files.slice().sort((a, b) => a.path.localeCompare(b.path))
  );
  const q = () => filter().trim().toLowerCase();

  return (
    <>
      <For each={dirs()}>
        {([name, child]) => {
          const inside = collectFiles(child);
          const anyVisible = () => inside.some((f) => isVisible(f, q()));
          return (
            <details open style={{ display: anyVisible() ? "" : "none" }}>
              <summary>{name}</summary>
              <TreeNode node={child} />
            </details>
          );
        }}
      </For>
      <For each={files()}>
        {(f) => (
          <button
            type="button"
            class="pt-tree-file"
            classList={{ "pt-viewed-file": !!viewed[f.path], [`pt-st-${f.status}`]: true }}
            data-path={f.path}
            style={{ display: isVisible(f, q()) ? "" : "none" }}
            onClick={(e) => {
              if ((e.target as Element).closest(".pt-tree-cmt")) f.selectComment();
              else f.select();
            }}
          >
            <span class="pt-tree-name">{f.path.split("/").pop()}</span>
            <span
              class="pt-tree-cmt"
              innerHTML={
                counts[f.path]
                  ? (icons.comment ?? "") + counts[f.path]
                  : ""
              }
            />
            <span class="pt-tree-stats">
              <span class="pt-adds">+{f.adds}</span> <span class="pt-dels">−{f.dels}</span>
            </span>
          </button>
        )}
      </For>
    </>
  );
}

export function FileTree() {
  const root = createMemo(() => build(treeFiles()));

  // highlight the file under the viewport and keep it in view inside the nav;
  // one effect toggles the class imperatively so every row need not subscribe
  let marked: HTMLElement | null = null;
  createEffect(() => {
    const p = activeFile();
    const nav = document.getElementById("pt-tree");
    if (!nav) return;
    marked?.classList.remove("pt-active");
    const el = p
      ? (nav.querySelector(`.pt-tree-file[data-path="${CSS.escape(p)}"]`) as HTMLElement | null)
      : null;
    marked = el;
    if (!el?.offsetParent) return;
    el.classList.add("pt-active");
    // centre the active row in the scroll area below the sticky filter head
    const er = el.getBoundingClientRect();
    const nr = nav.getBoundingClientRect();
    const headH = document.getElementById("pt-tree-head")?.offsetHeight ?? 0;
    const desiredTop = nr.top + headH + (nr.height - headH - er.height) / 2;
    nav.scrollTop += er.top - desiredTop;
  });

  return <TreeNode node={root()} />;
}
