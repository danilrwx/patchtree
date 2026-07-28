#!/usr/bin/env bash
# Fetch bundled web fonts from pinned upstream releases.
# Nerd Font ttf files are converted to woff2 (requires python3 + fonttools + brotli).
set -euo pipefail
cd "$(dirname "$0")/.."

JB=v2.304
INTER=v4.1
NERD=v3.4.0
RAW=https://raw.githubusercontent.com

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
python3 -c "import fontTools, brotli" 2>/dev/null || {
  echo "fonttools+brotli required: python3 -m pip install fonttools brotli" >&2
  exit 1
}
for family in JetBrainsMono FiraCode Hack Meslo; do
  curl -sfL "https://github.com/ryanoasis/nerd-fonts/releases/download/$NERD/$family.tar.xz" \
    -o "$tmp/$family.tar.xz"
  mkdir -p "$tmp/$family"
  tar xf "$tmp/$family.tar.xz" -C "$tmp/$family"
done
for ttf in \
  JetBrainsMono/JetBrainsMonoNerdFontMono-Regular JetBrainsMono/JetBrainsMonoNerdFontMono-Bold \
  FiraCode/FiraCodeNerdFontMono-Regular FiraCode/FiraCodeNerdFontMono-Bold \
  Hack/HackNerdFontMono-Regular Hack/HackNerdFontMono-Bold \
  Meslo/MesloLGSNerdFontMono-Regular Meslo/MesloLGSNerdFontMono-Bold; do
  base=$(basename "$ttf")
  echo "  $base.woff2"
  python3 - "$tmp/$ttf.ttf" "fonts/$base.woff2" <<'EOF'
import sys
from fontTools.ttLib import TTFont
f = TTFont(sys.argv[1])
f.flavor = "woff2"
f.save(sys.argv[2])
EOF
done
echo "fonts/ done"
