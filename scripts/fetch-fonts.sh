#!/usr/bin/env bash
# MIT License
#
# Copyright (c) 2026 Daniil Antoshin
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
# Fetch bundled web fonts from pinned upstream releases.
# Nerd Font ttf files are converted to woff2 with the ttf2woff2 npm package.
set -euo pipefail
cd "$(dirname "$0")/.."

JB=v2.304
INTER=v4.1
NERD=v3.4.0
RAW=https://raw.githubusercontent.com

EXPECTED=(
  JetBrainsMono-Regular JetBrainsMono-Italic JetBrainsMono-Bold
  InterVariable InterVariable-Italic
  JetBrainsMonoNerdFontMono-Regular JetBrainsMonoNerdFontMono-Bold
  FiraCodeNerdFontMono-Regular FiraCodeNerdFontMono-Bold
  HackNerdFontMono-Regular HackNerdFontMono-Bold
  MesloLGSNerdFontMono-Regular MesloLGSNerdFontMono-Bold
  IosevkaNerdFontMono-Regular IosevkaNerdFontMono-Bold
)
if [ "${FORCE:-}" != "1" ]; then
  missing=0
  for f in "${EXPECTED[@]}"; do [ -s "fonts/$f.woff2" ] || missing=1; done
  if [ "$missing" = 0 ]; then
    echo "fonts/ up to date (FORCE=1 to refetch)"
    exit 0
  fi
fi

mkdir -p fonts
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "JetBrains Mono $JB"
for f in JetBrainsMono-Regular JetBrainsMono-Italic JetBrainsMono-Bold; do
  curl -sfL "$RAW/JetBrains/JetBrainsMono/$JB/fonts/webfonts/$f.woff2" -o "fonts/$f.woff2"
done

echo "Inter $INTER"
for f in InterVariable InterVariable-Italic; do
  curl -sfL "$RAW/rsms/inter/$INTER/docs/font-files/$f.woff2" -o "fonts/$f.woff2"
done

echo "Nerd Fonts $NERD"
for family in JetBrainsMono FiraCode Hack Meslo Iosevka; do
  curl -sfL "https://github.com/ryanoasis/nerd-fonts/releases/download/$NERD/$family.tar.xz" \
    -o "$tmp/$family.tar.xz"
  mkdir -p "$tmp/$family"
  tar xf "$tmp/$family.tar.xz" -C "$tmp/$family"
done
for ttf in \
  JetBrainsMono/JetBrainsMonoNerdFontMono-Regular JetBrainsMono/JetBrainsMonoNerdFontMono-Bold \
  FiraCode/FiraCodeNerdFontMono-Regular FiraCode/FiraCodeNerdFontMono-Bold \
  Hack/HackNerdFontMono-Regular Hack/HackNerdFontMono-Bold \
  Meslo/MesloLGSNerdFontMono-Regular Meslo/MesloLGSNerdFontMono-Bold \
  Iosevka/IosevkaNerdFontMono-Regular Iosevka/IosevkaNerdFontMono-Bold; do
  base=$(basename "$ttf")
  echo "  $base.woff2"
  npx --yes ttf2woff2 < "$tmp/$ttf.ttf" > "fonts/$base.woff2"
done
echo "fonts/ done"
