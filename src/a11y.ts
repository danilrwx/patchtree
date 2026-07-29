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

// Keyboard access for non-button elements that carry a click action.

import { onCleanup } from "solid-js";

/** Run `fn` on Escape while mounted; auto-removes the listener on cleanup. */
export function onEscape(fn: () => void) {
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && fn();
  document.addEventListener("keydown", onKey);
  onCleanup(() => document.removeEventListener("keydown", onKey));
}

/** Enter/Space handler mirroring a click, for elements given role="button". */
export function onActivate(fn: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fn();
    }
  };
}

/** Prop bag that makes a static element a keyboard-accessible button. */
export function clickable(fn: () => void) {
  return { role: "button", tabindex: 0, onClick: fn, onKeyDown: onActivate(fn) } as const;
}
