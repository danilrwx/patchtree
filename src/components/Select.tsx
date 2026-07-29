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
// Styled replacement for a native <select>, ported from content.js makeSelect.
// The menu is positioned fixed on open so it isn't clipped by scrolling parents.
import { For, createSignal, type Accessor } from "solid-js";

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

  const onToggle = () => {
    if (!dd.open) {
      menu.style.cssText = "";
      return;
    }
    const r = sum.getBoundingClientRect();
    menu.style.position = "fixed";
    menu.style.left = `${r.left}px`;
    menu.style.top = `${r.bottom + 4}px`;
    menu.style.minWidth = `${r.width}px`;
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
              onClick={() => pick(o)}
            >
              {o.label}
            </div>
          )}
        </For>
      </div>
    </details>
  );
}
