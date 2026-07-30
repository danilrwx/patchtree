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

// Built-in base16 palettes plus the CSS-variable mapping that drives theming.

export const BASE16: Record<string, string> = {
  "Gruvbox Dark": "1d2021 3c3836 504945 665c54 bdae93 d5c4a1 ebdbb2 fbf1c7 fb4934 fe8019 fabd2f b8bb26 8ec07c 83a598 d3869b d65d0e",
  Nord: "2e3440 3b4252 434c5e 4c566a d8dee9 e5e9f0 eceff4 8fbcbb bf616a d08770 ebcb8b a3be8c 88c0d0 81a1c1 b48ead 5e81ac",
  Dracula: "282a36 363948 44475a 6272a4 9ea8c7 f8f8f2 f8f8f2 ffffff ff5555 ffb86c f1fa8c 50fa7b 8be9fd 61bfff bd93f9 ff79c6",
  "One Dark": "282c34 353b45 3e4451 545862 565c64 abb2bf b6bdca c8ccd4 e06c75 d19a66 e5c07b 98c379 56b6c2 61afef c678dd be5046",
  "Tomorrow Night": "1d1f21 282a2e 373b41 969896 b4b7b4 c5c8c6 e0e0e0 ffffff cc6666 de935f f0c674 b5bd68 8abeb7 81a2be b294bb a3685a",
  "Solarized Dark": "002b36 073642 586e75 657b83 839496 93a1a1 eee8d5 fdf6e3 dc322f cb4b16 b58900 859900 2aa198 268bd2 6c71c4 d33682",
  "Solarized Light": "fdf6e3 eee8d5 93a1a1 839496 657b83 586e75 073642 002b36 dc322f cb4b16 b58900 859900 2aa198 268bd2 6c71c4 d33682",
  "Default Dark": "181818 282828 383838 585858 b8b8b8 d8d8d8 e8e8e8 f8f8f8 ab4642 dc9656 f7ca88 a1b56c 86c1b9 7cafc2 ba8baf a16946",
};

function hexRgba(hex: string, a: number) {
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function luma(hex: string) {
  const n = parseInt(hex, 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

function mix(a: string, b: string, t: number) {
  const x = parseInt(a, 16);
  const y = parseInt(b, 16);
  const ch = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

// Schemes auto-converted from terminal palettes often carry terminal blacks in
// base01/base02 and near-invisible grays in base03/base04, which breaks UI
// surfaces (a black toolbar on a light page). When a slot's contrast against
// the background falls outside the plausible band for its role, derive the
// color from a bg→fg blend instead of trusting the palette.
const THEME_VARS = (c: string[]): Record<string, string> => {
  const bgL = luma(c[0]);
  const light = bgL > 0.5;
  const surface = (i: number, lo: number, hi: number, t: number) => {
    const d = Math.abs(luma(c[i]) - bgL);
    return d >= lo && d <= hi ? `#${c[i]}` : mix(c[0], c[5], t);
  };
  const readable = (i: number, lo: number, t: number) =>
    Math.abs(luma(c[i]) - bgL) >= lo ? `#${c[i]}` : mix(c[5], c[0], t);
  const muted = readable(4, 0.25, 0.35);
  return {
    bg: `#${c[0]}`,
    fg: `#${c[5]}`,
    muted,
    border: surface(2, 0.02, 0.35, 0.18),
    "header-bg": surface(1, 0.008, 0.15, 0.06),
    "add-bg": hexRgba(c[11], light ? 0.2 : 0.14),
    "add-no-bg": hexRgba(c[11], light ? 0.42 : 0.35),
    "del-bg": hexRgba(c[8], light ? 0.16 : 0.12),
    "del-no-bg": hexRgba(c[8], light ? 0.36 : 0.3),
    "hunk-bg": hexRgba(c[13], light ? 0.15 : 0.12),
    "hunk-fg": muted,
    "word-add": light ? mix(c[0], c[11], 0.3) : hexRgba(c[11], 0.38),
    "word-del": light ? mix(c[0], c[8], 0.3) : hexRgba(c[8], 0.38),
    success: `#${c[11]}`,
    danger: `#${c[8]}`,
    warning: `#${c[10]}`,
    accent: `#${c[13]}`,
    "tab-mark": `#${c[9]}`,
    btn: `#${c[11]}`,
    "btn-hover": mix(c[11], light ? "000000" : "ffffff", 0.15),
    "btn-fg": luma(c[11]) > 0.5 ? "#1a1d21" : "#ffffff",
    keyword: `#${c[14]}`,
    string: `#${c[11]}`,
    comment: readable(3, 0.18, 0.5),
    function: `#${c[13]}`,
    type: `#${c[10]}`,
    constant: `#${c[9]}`,
    number: `#${c[9]}`,
    variable: `#${c[8]}`,
    property: `#${c[13]}`,
    operator: `#${c[5]}`,
    tag: `#${c[8]}`,
    attribute: `#${c[10]}`,
    punctuation: muted,
    embedded: `#${c[15]}`,
    escape: `#${c[12]}`,
    label: `#${c[10]}`,
    module: `#${c[10]}`,
  };
};

export function applySettings(s: any, customThemes: Record<string, string>) {
  const st = document.documentElement.style;
  if (s.uiFont) st.setProperty("--pt-ui", `"${s.uiFont}", system-ui, sans-serif`);
  else st.removeProperty("--pt-ui");
  if (s.codeFont) st.setProperty("--pt-mono", `"${s.codeFont}", ui-monospace, monospace`);
  else st.removeProperty("--pt-mono");
  st.setProperty("--pt-tab", s.tabSize || 4);
  st.setProperty("--pt-size", `${s.fontSize || 14}px`);
  st.setProperty("--pt-ui-size", `${s.uiFontSize || 14}px`);
  st.setProperty("--pt-comment-style", s.noItalic ? "normal" : "italic");
  st.setProperty("--pt-liga", s.noLigatures ? '"calt" 0, "liga" 0' : "normal");

  const palette = BASE16[s.theme] || customThemes[s.theme] || s.themePalette;
  const vars = palette ? THEME_VARS(palette.split(" ")) : null;
  for (const k of Object.keys(THEME_VARS(BASE16["Default Dark"].split(" ")))) {
    if (vars) st.setProperty(`--pt-${k}`, vars[k]);
    else st.removeProperty(`--pt-${k}`);
  }
}

// tinted-theming base16 yaml: base00..base0F hex values + scheme/name field
export function parseBase16Yaml(text: string) {
  const colors = [];
  for (let i = 0; i < 16; i++) {
    const key = `base0${i.toString(16).toUpperCase()}`;
    const m = new RegExp(`${key}:\\s*["']?#?([0-9a-fA-F]{6})`).exec(text);
    if (!m) return null;
    colors.push(m[1].toLowerCase());
  }
  const name = /(?:scheme|name):\s*["']?([^"'\n]+)/.exec(text)?.[1]?.trim() || "custom scheme";
  return { name, colors: colors.join(" ") };
}
