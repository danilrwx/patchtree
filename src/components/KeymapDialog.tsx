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

// Keyboard shortcuts overlay, opened from the gear menu or with "?".
import { For } from "solid-js";
import { onEscape } from "../a11y";

const KEYS: [keys: string[], what: string][] = [
  [["j", "k"], "next / previous file"],
  [["n", "p"], "next / previous thread"],
  [["v"], "toggle viewed on the current file"],
  [["x"], "fold / unfold the current file"],
  [["s"], "switch inline / side-by-side"],
  [["e"], "toggle the file tree"],
  [["/"], "focus the file filter"],
  [["?"], "this help"],
];

const MOUSE: [what: string, how: string][] = [
  ["comment on a line", "click its line number"],
  ["comment on a range", "shift-click or drag over line numbers"],
  ["copy a permalink to a line", "alt-click its line number"],
];

export function KeymapDialog(props: { onClose: () => void }) {
  onEscape(props.onClose);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; click-outside is a mouse convenience, Escape and the Close button close it for keyboard
    // biome-ignore lint/a11y/useKeyWithClickEvents: see above — Escape handles the keyboard path
    <div id="pt-keymap-dialog" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="pt-dialog pt-keymap">
        <div class="pt-gallery-head">
          <h3>Keyboard shortcuts</h3>
        </div>
        <table class="pt-keys">
          <tbody>
            <For each={KEYS}>
              {([keys, what]) => (
                <tr>
                  <td>
                    <For each={keys}>{(k, i) => (
                      <>
                        {i() > 0 && <span class="pt-key-sep">/</span>}
                        <kbd>{k}</kbd>
                      </>
                    )}</For>
                  </td>
                  <td>{what}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <h4>Mouse</h4>
        <table class="pt-keys pt-keys-mouse">
          <tbody>
            <For each={MOUSE}>
              {([what, how]) => (
                <tr>
                  <td>{what}</td>
                  <td>{how}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
        <div class="pt-form-actions">
          <button type="button" class="pt-primary" onClick={props.onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
