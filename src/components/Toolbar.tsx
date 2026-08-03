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

import { Show } from "solid-js";
import { anyExpanded, treeFiles, viewMode, viewedDone, viewedTotal } from "../store";
import { icons } from "../icons";

const SVG_ROWS =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1.75" y="2.75" width="12.5" height="4.1" rx="1.4"/><rect x="1.75" y="9.15" width="12.5" height="4.1" rx="1.4"/></svg>';
const SVG_COLS =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1.75" y="2.75" width="5.1" height="10.5" rx="1.4"/><rect x="9.15" y="2.75" width="5.1" height="10.5" rx="1.4"/></svg>';

export function Toolbar(props: {
  onSetMode: (mode: "unified" | "split") => void;
  onFoldAll: (folded: boolean) => void;
  onClearViewed: () => void;
}) {
  const done = () => viewedTotal() > 0 && viewedDone() === viewedTotal();
  const files = () => treeFiles();
  const adds = () => files().reduce((n, f) => n + f.adds, 0);
  const dels = () => files().reduce((n, f) => n + f.dels, 0);
  return (
    <>
      <span
        id="pt-diffstat"
        title={`${files().length} ${files().length === 1 ? "file" : "files"} changed`}
      >
        <Show when={files().length > 0}>
          <span class="pt-adds">+{adds()}</span> <span class="pt-dels">−{dels()}</span>
        </Show>
      </span>
      <span
        id="pt-progress"
        classList={{ "pt-done": done() }}
        title={`${viewedDone()} of ${viewedTotal()} files viewed`}
      >
        <Show when={viewedTotal() > 0}>{`· ${viewedDone()}/${viewedTotal()}`}</Show>
        <Show when={viewedDone() > 0}>
          <button
            type="button"
            id="pt-clear-viewed"
            title="Clear viewed"
            innerHTML={icons.sync}
            onClick={() => props.onClearViewed()}
          />
        </Show>
      </span>
      <div class="pt-seg">
        <button
          type="button"
          id="pt-fold-toggle"
          title={anyExpanded() ? "Collapse all files" : "Expand all files"}
          innerHTML={anyExpanded() ? icons.fold : icons.unfold}
          onClick={() => props.onFoldAll(anyExpanded())}
        />
        <button
          type="button"
          id="pt-view-toggle"
          title={viewMode() === "split" ? "Switch to inline" : "Switch to side-by-side"}
          innerHTML={viewMode() === "split" ? SVG_ROWS : SVG_COLS}
          onClick={() => props.onSetMode(viewMode() === "split" ? "unified" : "split")}
        />
      </div>
    </>
  );
}
