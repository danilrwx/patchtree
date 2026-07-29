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

import { For, createMemo } from "solid-js";
import { icons } from "../icons";
import {
  treeFiles,
  extOf,
  hiddenExts,
  setHiddenExts,
  showViewed,
  setShowViewed,
  showDeleted,
  setShowDeleted,
} from "../store";

export function FileFilter() {
  // extensions present in the diff with their file counts, sorted by name
  const exts = createMemo(() => {
    const m = new Map<string, number>();
    for (const f of treeFiles()) m.set(extOf(f.path), (m.get(extOf(f.path)) ?? 0) + 1);
    return [...m].sort((a, b) => a[0].localeCompare(b[0]));
  });
  const active = createMemo(
    () => Object.values(hiddenExts).some(Boolean) || !showViewed() || !showDeleted()
  );

  return (
    <details class="pt-dd pt-dd-right pt-filter-dd">
      <summary
        classList={{ "pt-filter-active": active() }}
        title="Filter by file type"
        innerHTML={icons.filter}
      />
      <div class="pt-dd-menu">
        <div class="pt-filter-head">File extensions</div>
        <For each={exts()}>
          {([ext, count]) => (
            <label class="pt-filter-row">
              <input
                type="checkbox"
                checked={!hiddenExts[ext]}
                onChange={(e) => setHiddenExts(ext, !e.currentTarget.checked)}
              />
              <span class="pt-filter-name">{ext}</span>
              <span class="pt-filter-count">{count}</span>
            </label>
          )}
        </For>
        <div class="pt-dd-sep" />
        <label class="pt-filter-row">
          <input type="checkbox" checked={showDeleted()} onChange={(e) => setShowDeleted(e.currentTarget.checked)} />
          <span class="pt-filter-name">Deleted files</span>
        </label>
        <label class="pt-filter-row">
          <input type="checkbox" checked={showViewed()} onChange={(e) => setShowViewed(e.currentTarget.checked)} />
          <span class="pt-filter-name">Viewed files</span>
        </label>
      </div>
    </details>
  );
}
