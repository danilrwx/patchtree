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
import { viewMode, viewedDone, viewedTotal } from "../store";

const SVG_ROWS =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1.75" y="2.75" width="12.5" height="4.1" rx="1.4"/><rect x="1.75" y="9.15" width="12.5" height="4.1" rx="1.4"/></svg>';
const SVG_COLS =
  '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1.75" y="2.75" width="5.1" height="10.5" rx="1.4"/><rect x="9.15" y="2.75" width="5.1" height="10.5" rx="1.4"/></svg>';

export function Toolbar(props: { onSetMode: (mode: "unified" | "split") => void }) {
  const done = () => viewedTotal() > 0 && viewedDone() === viewedTotal();
  return (
    <>
      <span id="pt-progress" classList={{ "pt-done": done() }}>
        <Show when={viewedTotal() > 0}>{`${viewedDone()}/${viewedTotal()} viewed`}</Show>
      </span>
      <div class="pt-seg">
        <button
          title="Inline"
          classList={{ "pt-active": viewMode() !== "split" }}
          innerHTML={SVG_ROWS}
          onClick={() => props.onSetMode("unified")}
        />
        <button
          title="Side-by-side"
          classList={{ "pt-active": viewMode() === "split" }}
          innerHTML={SVG_COLS}
          onClick={() => props.onSetMode("split")}
        />
      </div>
    </>
  );
}
