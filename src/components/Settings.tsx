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

import { createSignal, Show } from "solid-js";
import { settings, themeOptions } from "../store";
import { clickable } from "../a11y";
import { Select } from "./Select";

const CODE_FONTS = [
  "JetBrains Mono",
  "JetBrainsMono Nerd Font Mono",
  "FiraCode Nerd Font Mono",
  "Hack Nerd Font Mono",
  "MesloLGS Nerd Font Mono",
  "Iosevka Nerd Font Mono",
];

export interface SettingsProps {
  // update a setting: mirror to the store, re-apply CSS vars and persist
  patch: (key: string, value: unknown) => void;
  onPickTheme: (value: string | number) => void;
  onOpenGallery: () => void;
}

function Row(props: { label: string; children: any }) {
  return (
    <div class="pt-set-row">
      <span>{props.label}</span>
      {props.children}
    </div>
  );
}

function FontControl(props: { field: string; bundled: string[]; patch: SettingsProps["patch"] }) {
  const cur = () => (settings[props.field] as string) || "";
  const isBundled = () => props.bundled.includes(cur());
  const [custom, setCustom] = createSignal(!!cur() && !isBundled());
  const options = () => [
    { value: "", label: "Default" },
    ...props.bundled.map((f) => ({ value: f, label: f })),
    { value: "__custom", label: "Custom…" },
  ];
  const selValue = () => (isBundled() ? cur() : cur() ? "__custom" : "");
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (
    <span class="pt-font-ctl">
      <Select
        options={options}
        value={selValue}
        styleFont
        onChange={(v) => {
          if (v === "__custom") setCustom(true);
          else {
            setCustom(false);
            props.patch(props.field, v);
          }
        }}
      />
      <Show when={custom()}>
        <input
          placeholder="system font name"
          value={cur()}
          onInput={(e) => {
            clearTimeout(timer);
            const val = e.currentTarget.value.trim();
            timer = setTimeout(() => props.patch(props.field, val), 400);
          }}
        />
      </Show>
    </span>
  );
}

export function Settings(props: SettingsProps) {
  const num = (field: string, dflt: number) => (e: Event & { currentTarget: HTMLInputElement }) => {
    const v = Math.max(9, Math.min(20, +e.currentTarget.value || dflt));
    e.currentTarget.value = String(v);
    props.patch(field, v);
  };
  return (
    <>
      <Row label="Theme">
        <Select
          options={themeOptions}
          value={() => (settings.theme as string) || ""}
          onChange={props.onPickTheme}
        />
      </Row>
      <div class="pt-dd-item" {...clickable(() => props.onOpenGallery())}>
        Theme gallery…
      </div>
      <Row label="UI font">
        <FontControl field="uiFont" bundled={["Inter"]} patch={props.patch} />
      </Row>
      <Row label="Code font">
        <FontControl field="codeFont" bundled={CODE_FONTS} patch={props.patch} />
      </Row>
      <Row label="Tab width">
        <Select
          options={() => [2, 4, 8].map((n) => ({ value: n, label: String(n) }))}
          value={() => (settings.tabSize as number) || 4}
          onChange={(v) => props.patch("tabSize", v)}
        />
      </Row>
      <Row label="Code font size">
        <input type="number" min={9} max={20} value={(settings.fontSize as number) || 14} onChange={num("fontSize", 14)} />
      </Row>
      <Row label="UI font size">
        <input type="number" min={9} max={20} value={(settings.uiFontSize as number) || 14} onChange={num("uiFontSize", 14)} />
      </Row>
      <Row label="Italic comments">
        <input type="checkbox" checked={!settings.noItalic} onChange={(e) => props.patch("noItalic", !e.currentTarget.checked)} />
      </Row>
      <Row label="Ligatures">
        <input type="checkbox" checked={!settings.noLigatures} onChange={(e) => props.patch("noLigatures", !e.currentTarget.checked)} />
      </Row>
    </>
  );
}
