// MIT License
//
// Copyright (c) 2026 Daniil Antoshin
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
import { For, createMemo } from "solid-js";
import { treeFiles, filter, viewed, counts, type TreeFile } from "../store";

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
    name += "/" + subName;
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
          <a
            class="pt-tree-file"
            href="#"
            classList={{ "pt-viewed-file": !!viewed[f.path] }}
            style={{ display: isVisible(f, q()) ? "" : "none" }}
            onClick={(e) => {
              e.preventDefault();
              if ((e.target as Element).closest(".pt-tree-cmt")) f.selectComment();
              else f.select();
            }}
          >
            <span class="pt-tree-name">{f.path.split("/").pop()}</span>
            <span
              class="pt-tree-cmt"
              innerHTML={
                counts[f.path]
                  ? ((window as any).ptIcons?.comment ?? "") + counts[f.path]
                  : ""
              }
            />
            <span class="pt-tree-stats">
              <span class="pt-adds">+{f.adds}</span> <span class="pt-dels">−{f.dels}</span>
            </span>
          </a>
        )}
      </For>
    </>
  );
}

export function FileTree() {
  const root = createMemo(() => build(treeFiles()));
  return <TreeNode node={root()} />;
}
