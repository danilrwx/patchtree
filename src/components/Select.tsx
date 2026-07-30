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

// Styled replacement for a native <select>, ported from content.js makeSelect.
// The menu is positioned fixed on open so it isn't clipped by scrolling parents.
import { For, createSignal, onCleanup, type Accessor } from "solid-js";
import { clickable } from "../a11y";

export interface SelectOption {
  value: string | number;
  label: string;
}

export function Select(props: {
  options: Accessor<SelectOption[]>;
  value: Accessor<string | number>;
  onChange: (value: string | number) => void;
  styleFont?: boolean;
}) {
  let dd!: HTMLDetailsElement;
  let sum!: HTMLElement;
  let menu!: HTMLDivElement;
  const [kbd, setKbd] = createSignal(-1);

  const opts = () => props.options();
  const current = () => opts().find((o) => o.value === props.value()) ?? opts()[0];
  const fontOf = (v: string | number) => (props.styleFont && v ? `"${v}"` : "");

  const pick = (o: SelectOption) => {
    dd.open = false;
    props.onChange(o.value);
  };

  // the menu may be parked under <body> when the component unmounts
  onCleanup(() => menu.remove());

  // While open, the menu lives under document.body: a position:fixed menu
  // nested in a scrollable dropdown loses real clicks in Chromium when the
  // scroller is on the main-thread path (classic scrollbars on Linux) — the
  // input hit test resolves to the scroller even though elementFromPoint
  // returns the item.
  const onToggle = () => {
    if (!dd.open) {
      menu.style.cssText = "";
      dd.appendChild(menu);
      return;
    }
    const r = sum.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.left = `${r.left}px`;
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.minWidth = `${Math.max(r.width, 150)}px`;
    menu.style.font = getComputedStyle(sum).font;
    document.body.appendChild(menu);
    const m = menu.getBoundingClientRect();
    if (m.bottom > window.innerHeight)
      menu.style.top = `${Math.max(8, window.innerHeight - m.height - 8)}px`;
    if (m.right > window.innerWidth)
      menu.style.left = `${Math.max(8, window.innerWidth - m.width - 8)}px`;
    setKbd(opts().findIndex((o) => o.value === props.value()));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!dd.open) return;
    const list = opts();
    let idx = kbd();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (idx < 0) idx = list.findIndex((o) => o.value === props.value());
      idx = e.key === "ArrowDown" ? Math.min(list.length - 1, idx + 1) : Math.max(0, idx - 1);
      setKbd(idx);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const o = list[idx] ?? current();
      if (o) pick(o);
    } else if (e.key === "Escape") {
      dd.open = false;
    }
  };

  return (
    <details class="pt-dd pt-select" ref={dd} onToggle={onToggle}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: <summary> is a native, focusable disclosure control; onKeyDown only adds arrow-key navigation */}
      <summary ref={sum} onKeyDown={onKeyDown} style={{ "font-family": fontOf(current()?.value ?? "") }}>
        <span class="pt-dd-label">{current()?.label ?? ""}</span>
      </summary>
      <div class="pt-dd-menu" ref={menu}>
        <For each={opts()}>
          {(o, i) => (
            <div
              class="pt-dd-item"
              classList={{ "pt-active": o.value === props.value(), "pt-kbd": kbd() === i() }}
              style={{ "font-family": fontOf(o.value) }}
              {...clickable(() => pick(o))}
            >
              {o.label}
            </div>
          )}
        </For>
      </div>
    </details>
  );
}
