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

import { indexCacheRevisionsKey, type CacheGroup, type CacheRevisions, type CacheSelection, type CacheStats } from "./index-cache-state";

const groups = [["indexes", "Indexes"], ["sources", "Source snapshots"]] as const;

function formatSize(bytes: number) {
  const size = bytes / (1024 * 1024);
  return `${bytes > 0 && size < 0.01 ? "<0.01" : size.toFixed(2)} MiB`;
}

export function addIndexCacheControls(parent: HTMLElement, invalidateIndexes: () => void) {
  const details = document.createElement("details");
  details.className = "pt-index-cache";
  const summary = document.createElement("summary");
  summary.textContent = "Cache storage";
  const rows = document.createElement("dl");
  rows.className = "pt-index-cache-rows";
  const controls = document.createElement("div");
  controls.className = "pt-index-cache-actions";
  const notice = document.createElement("small");
  notice.setAttribute("aria-live", "polite");
  const size = document.createElement("small");
  size.textContent = "Stored entry size in MiB";
  const reusable = document.createElement("small");
  reusable.hidden = true;
  details.append(summary, size, rows, reusable, controls, notice);
  parent.append(details);

  let busy = false;
  let refreshPending = false;
  let stats: CacheStats | undefined;
  let lastClear: string | undefined;
  const readouts = new Map<CacheGroup, HTMLElement>();
  const buttons = new Map<CacheSelection, HTMLButtonElement>();

  function observeClear(revisions: CacheRevisions | undefined) {
    if (!revisions?.indexes || revisions.indexes === lastClear) return;
    lastClear = revisions.indexes;
    invalidateIndexes();
  }

  function updateButtons() {
    for (const [kind, button] of buttons) {
      const indexes = (stats?.indexes.entries ?? 0) + (stats?.reusable.entries ?? 0);
      const sources = stats?.sources.entries ?? 0;
      const count = kind === "all" ? indexes + sources : kind === "indexes" ? indexes : sources;
      button.disabled = busy || !count;
    }
  }

  function refresh() {
    if (!details.open) return;
    if (busy) refreshPending = true;
    else void update();
  }

  async function update(clear?: CacheSelection) {
    const knownClear = lastClear;
    busy = true;
    updateButtons();
    try {
      const reply = await chrome.runtime.sendMessage({ type: "codeIndexCaches", clear });
      if (!reply?.stats) throw new Error("Could not access the code index caches.");
      if (lastClear === knownClear && (clear === "indexes" || clear === "all")) observeClear(reply.revisions);
      stats = reply.stats as CacheStats;
      for (const [group, readout] of readouts) {
        const { entries, bytes } = stats[group];
        readout.textContent = `${entries} ${entries === 1 ? "entry" : "entries"} (${formatSize(bytes)})`;
      }
      reusable.hidden = !stats.reusable.entries;
      reusable.textContent = `Reusable analysis in ${stats.reusable.entries} entries (${formatSize(stats.reusable.bytes)})`;
      if (clear) notice.textContent = clear === "all" ? "Both caches cleared." :
        clear === "indexes" ? "Indexes cleared." : "Source snapshots cleared.";
      else if (notice.classList.contains("pt-error")) notice.textContent = "";
      notice.classList.remove("pt-error");
    } catch {
      notice.textContent = "Could not access the code index caches.";
      notice.classList.add("pt-error");
    } finally {
      busy = false;
      updateButtons();
      if (refreshPending) {
        refreshPending = false;
        refresh();
      }
    }
  }

  function addButton(kind: CacheSelection, label: string) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.disabled = true;
    // The reviewed page shares this DOM, so require a user activation to clear data.
    button.addEventListener("click", (event) => { if (event.isTrusted && !busy) void update(kind); });
    controls.append(button);
    buttons.set(kind, button);
  }

  for (const [kind, label] of groups) {
    const term = document.createElement("dt");
    term.textContent = label;
    const readout = document.createElement("dd");
    readout.textContent = "…";
    rows.append(term, readout);
    readouts.set(kind, readout);
    addButton(kind, `Clear ${label.toLowerCase()}`);
  }
  addButton("all", "Clear both caches");
  details.addEventListener("toggle", refresh);
  parent.closest<HTMLDetailsElement>("#pt-settings")?.addEventListener("toggle", (event) => {
    if ((event.currentTarget as HTMLDetailsElement).open) refresh();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    const change = changes[indexCacheRevisionsKey];
    if (area !== "local" || !change) return;
    const previous = change.oldValue as CacheRevisions | undefined;
    const next = change.newValue as CacheRevisions | undefined;
    if (previous?.indexes !== next?.indexes) observeClear(next);
    refresh();
  });
  return refresh;
}
