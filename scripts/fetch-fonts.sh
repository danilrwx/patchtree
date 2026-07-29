#!/usr/bin/env bash
# Copyright 2026 Daniil Antoshin
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

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
  for f in "${EXPECTED[@]}"; do [ -s "assets/fonts/$f.woff2" ] || missing=1; done
  if [ "$missing" = 0 ]; then
    echo "assets/fonts/ up to date (FORCE=1 to refetch)"
    exit 0
  fi
fi

mkdir -p assets/fonts
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "JetBrains Mono $JB"
for f in JetBrainsMono-Regular JetBrainsMono-Italic JetBrainsMono-Bold; do
  curl -sfL "$RAW/JetBrains/JetBrainsMono/$JB/fonts/webfonts/$f.woff2" -o "assets/fonts/$f.woff2"
done

echo "Inter $INTER"
for f in InterVariable InterVariable-Italic; do
  curl -sfL "$RAW/rsms/inter/$INTER/docs/font-files/$f.woff2" -o "assets/fonts/$f.woff2"
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
  npx --yes ttf2woff2 < "$tmp/$ttf.ttf" > "assets/fonts/$base.woff2"
done
echo "assets/fonts/ done"
