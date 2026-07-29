// Copyright (c) 2026 Daniil Antoshin. MIT License (see LICENSE).
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
