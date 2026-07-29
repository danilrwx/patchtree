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

const THEME_VARS = (c: string[]): Record<string, string> => ({
  bg: `#${c[0]}`,
  fg: `#${c[5]}`,
  muted: `#${c[4]}`,
  border: `#${c[2]}`,
  "header-bg": `#${c[1]}`,
  "add-bg": hexRgba(c[11], 0.14),
  "add-no-bg": hexRgba(c[11], 0.35),
  "del-bg": hexRgba(c[8], 0.12),
  "del-no-bg": hexRgba(c[8], 0.3),
  "hunk-bg": hexRgba(c[13], 0.12),
  "hunk-fg": `#${c[4]}`,
  "word-add": hexRgba(c[11], 0.38),
  "word-del": hexRgba(c[8], 0.38),
  keyword: `#${c[14]}`,
  string: `#${c[11]}`,
  comment: `#${c[3]}`,
  function: `#${c[13]}`,
  type: `#${c[10]}`,
  constant: `#${c[9]}`,
  number: `#${c[9]}`,
  variable: `#${c[8]}`,
  property: `#${c[13]}`,
  operator: `#${c[5]}`,
  tag: `#${c[8]}`,
  attribute: `#${c[10]}`,
  punctuation: `#${c[4]}`,
  embedded: `#${c[15]}`,
  escape: `#${c[12]}`,
  label: `#${c[10]}`,
  module: `#${c[10]}`,
});

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
