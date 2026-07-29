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
