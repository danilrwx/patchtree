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

// @font-face lives here, not in the injected CSS: extension-resource URLs
// need runtime.getURL to work on both chrome-extension:// and moz-extension://
const FONT_FACES = [
  ["JetBrains Mono", "400", "normal", "JetBrainsMono-Regular.woff2"],
  ["JetBrains Mono", "400", "italic", "JetBrainsMono-Italic.woff2"],
  ["JetBrains Mono", "700", "normal", "JetBrainsMono-Bold.woff2"],
  ["Inter", "100 900", "normal", "InterVariable.woff2"],
  ["Inter", "100 900", "italic", "InterVariable-Italic.woff2"],
  ["JetBrainsMono Nerd Font Mono", "400", "normal", "JetBrainsMonoNerdFontMono-Regular.woff2"],
  ["JetBrainsMono Nerd Font Mono", "700", "normal", "JetBrainsMonoNerdFontMono-Bold.woff2"],
  ["FiraCode Nerd Font Mono", "400", "normal", "FiraCodeNerdFontMono-Regular.woff2"],
  ["FiraCode Nerd Font Mono", "700", "normal", "FiraCodeNerdFontMono-Bold.woff2"],
  ["Hack Nerd Font Mono", "400", "normal", "HackNerdFontMono-Regular.woff2"],
  ["Hack Nerd Font Mono", "700", "normal", "HackNerdFontMono-Bold.woff2"],
  ["MesloLGS Nerd Font Mono", "400", "normal", "MesloLGSNerdFontMono-Regular.woff2"],
  ["MesloLGS Nerd Font Mono", "700", "normal", "MesloLGSNerdFontMono-Bold.woff2"],
  ["Iosevka Nerd Font Mono", "400", "normal", "IosevkaNerdFontMono-Regular.woff2"],
  ["Iosevka Nerd Font Mono", "700", "normal", "IosevkaNerdFontMono-Bold.woff2"],
];

export function injectFonts() {
  const css = FONT_FACES.map(
    ([family, weight, style, file]) =>
      `@font-face{font-family:"${family}";font-weight:${weight};font-style:${style};` +
      `src:url("${chrome.runtime.getURL(`assets/fonts/${file}`)}") format("woff2");}`
  ).join("\n");
  const el = document.createElement("style");
  el.textContent = css;
  document.documentElement.appendChild(el);
}
