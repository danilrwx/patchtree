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

// Scroll an element to the viewport center and briefly flash it.
export function flashCenter(el: Element | null | undefined) {
  if (!el) return;
  el.scrollIntoView({ block: "center" });
  el.classList.add("pt-flash");
  setTimeout(() => el.classList.remove("pt-flash"), 1200);
}
