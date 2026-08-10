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

# Fetch bundled web fonts from pinned upstream releases and verify every
# download against its pinned sha256 — a moved tag or re-uploaded release
# asset fails loudly instead of shipping different bytes. After a version
# bump, PRINT_SUMS=1 FORCE=1 prints the new pins to paste below.
# Every bundled font comes from the Nerd Fonts release and is converted to
# woff2 with the ttf2woff2 npm package — one upstream for all of them.
set -euo pipefail
cd "$(dirname "$0")/.."

NERD=v3.4.0
TTF2WOFF2=8.0.1

SUMS=(
  "JetBrainsMono.tar.xz ef552a3e638f25125c6ad4c51176a6adcdce295ab1d2ffacf0db060caf8c1582"
  "FiraCode.tar.xz d83fb093e0e05a531cd6f19886a6ceb884a4fa5ea3b53cf099fc1f30c5b3e47d"
  "Hack.tar.xz 1d00a1435638084174516975840854368a45ac30bb0bad2c0c49db713b5925f0"
  "Meslo.tar.xz a57936d96aefb5cfff0660f3294210ee04705529af6cf811e2274b0923a03939"
  "Iosevka.tar.xz 213ee24cda99ca84d0a8326de133e7e8b2baf9ba23659ce829f589f771d357d2"
)

# download $1 into $tmp/$2 and require the pinned sha256
fetch_checked() {
  local url=$1 name=$2 want="" got e
  curl -sfL "$url" -o "$tmp/$name"
  got=$(shasum -a 256 "$tmp/$name" | awk '{print $1}')
  if [ "${PRINT_SUMS:-}" = 1 ]; then
    echo "  \"$name $got\""
    return
  fi
  for e in "${SUMS[@]}"; do [ "${e%% *}" = "$name" ] && want=${e#* }; done
  if [ "$got" != "$want" ]; then
    echo "sha256 mismatch for $name: expected ${want:-<no pin>}, got $got" >&2
    exit 1
  fi
}

EXPECTED=(
  JetBrainsMonoNerdFontMono-Regular JetBrainsMonoNerdFontMono-Italic JetBrainsMonoNerdFontMono-Bold
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

echo "Nerd Fonts $NERD"
for family in JetBrainsMono FiraCode Hack Meslo Iosevka; do
  fetch_checked "https://github.com/ryanoasis/nerd-fonts/releases/download/$NERD/$family.tar.xz" "$family.tar.xz"
  mkdir -p "$tmp/$family"
  tar xf "$tmp/$family.tar.xz" -C "$tmp/$family"
done
for ttf in \
  JetBrainsMono/JetBrainsMonoNerdFontMono-Regular JetBrainsMono/JetBrainsMonoNerdFontMono-Italic \
  JetBrainsMono/JetBrainsMonoNerdFontMono-Bold \
  FiraCode/FiraCodeNerdFontMono-Regular FiraCode/FiraCodeNerdFontMono-Bold \
  Hack/HackNerdFontMono-Regular Hack/HackNerdFontMono-Bold \
  Meslo/MesloLGSNerdFontMono-Regular Meslo/MesloLGSNerdFontMono-Bold \
  Iosevka/IosevkaNerdFontMono-Regular Iosevka/IosevkaNerdFontMono-Bold; do
  base=$(basename "$ttf")
  echo "  $base.woff2"
  npx --yes "ttf2woff2@$TTF2WOFF2" < "$tmp/$ttf.ttf" > "assets/fonts/$base.woff2"
done
echo "assets/fonts/ done"
