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

// Theme gallery overlay: a searchable grid of scheme previews plus a custom
// base16/base24 yaml paste. 500+ styled previews freeze layout if drawn at
// once, so the grid renders in batches as a sentinel scrolls into view.
import { For, Show, createMemo, createEffect, createSignal, onMount } from "solid-js";
import { esc } from "../diff";
import { clickable } from "../a11y";
import { Select } from "./Select";

interface Theme {
  name: string;
  palette: string;
  variant: string;
  system?: string;
}

const BATCH = 48;

function sampleHtml(palette: string): string {
  const c = palette.split(" ");
  const span = (color: string, text: string) => `<span style="color:#${color}">${esc(text)}</span>`;
  return (
    `<pre class="pt-theme-sample" style="background:#${c[0]};color:#${c[5]}">` +
    `${span(c[3], "// load and apply a scheme")}\n` +
    `${span(c[14], "fn")} ${span(c[13], "apply")}(${span(c[8], "name")}: ${span(c[10], "&str")}) {\n` +
    `  ${span(c[14], "let")} theme = scheme.${span(c[13], "with_base")}(${span(c[9], "16")});\n` +
    `  ${span(c[13], "println!")}(${span(c[11], '"applied: {}"')}, name);\n` +
    `}</pre>`
  );
}

export function ThemeGallery(props: {
  current: () => string;
  onApply: (name: string, palette: string) => void;
  onAddCustom: (yaml: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [all, setAll] = createSignal<Theme[]>([]);
  const [q, setQ] = createSignal("");
  const [variant, setVariant] = createSignal<string | number>("all");
  const [rendered, setRendered] = createSignal(BATCH);
  const [custom, setCustom] = createSignal("");
  const [err, setErr] = createSignal("");
  let sentinel!: HTMLDivElement;

  const filtered = createMemo(() => {
    const query = q().trim().toLowerCase();
    const v = variant();
    return all().filter(
      (t) => (!query || t.name.toLowerCase().includes(query)) && (v === "all" || t.variant === v)
    );
  });
  const visible = () => filtered().slice(0, rendered());
  // reset the batch window whenever the filter narrows/changes the result set
  createEffect(() => {
    filtered();
    setRendered(BATCH);
  });

  onMount(async () => {
    const list = ((await chrome.runtime.sendMessage({ type: "themes" })) || []) as Theme[];
    setAll(list.filter((t) => t?.palette && t?.name));
    new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && rendered() < filtered().length)
          setRendered((n) => n + BATCH);
      },
      { rootMargin: "300px" }
    ).observe(sentinel);
  });

  return (
    <div id="pt-themes-dialog" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="pt-dialog pt-gallery">
        <div class="pt-gallery-head">
          <h3>Theme gallery</h3>
          <input type="search" placeholder="Search themes…" onInput={(e) => setQ(e.currentTarget.value)} />
          <Select
            options={() => ["all", "dark", "light"].map((v) => ({ value: v, label: v }))}
            value={variant}
            onChange={setVariant}
          />
          <button type="button" onClick={() => props.onClose()}>
            Close
          </button>
        </div>

        <div class="pt-theme-grid">
          <Show when={all().length} fallback={<span>themes.json missing — run make themes and reload</span>}>
            <For each={visible()}>
              {(t) => (
                <div
                  class="pt-theme-card"
                  classList={{ "pt-active": props.current() === t.name }}
                  data-name={t.name.toLowerCase()}
                  data-variant={t.variant}
                  {...clickable(() => props.onApply(t.name, t.palette))}
                >
                  <div innerHTML={sampleHtml(t.palette)} />
                  <div class="pt-theme-meta">
                    <b>{t.name}</b>
                    <span class="pt-theme-badges">
                      <Show when={t.system === "base24"}>
                        <i>BASE24</i>
                      </Show>
                      <i>{t.variant.toUpperCase()}</i>
                    </span>
                  </div>
                </div>
              )}
            </For>
          </Show>
          <div class="pt-gallery-sentinel" ref={sentinel} />
        </div>

        <details class="pt-gallery-custom">
          <summary>Paste a custom scheme yaml (base16/base24)</summary>
          <p>
            Any{" "}
            <a href="https://github.com/tinted-theming/schemes" target="_blank" rel="noopener">
              tinted-theming
            </a>
            -format scheme works.
          </p>
          <textarea
            rows={6}
            placeholder={'name: "My Scheme"\nbase00: "131513"\n…'}
            value={custom()}
            onInput={(e) => setCustom(e.currentTarget.value)}
          />
          <Show when={err()}>
            <p class="pt-dialog-err">{err()}</p>
          </Show>
          <button
            type="button"
            class="pt-primary"
            onClick={async () => {
              const e = await props.onAddCustom(custom());
              setErr(e || "");
              if (!e) setCustom("");
            }}
          >
            Add and apply
          </button>
        </details>
      </div>
    </div>
  );
}
